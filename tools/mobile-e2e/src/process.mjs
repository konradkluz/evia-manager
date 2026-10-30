// @ts-check
/**
 * Wiring of the smoke test to the real machine (EVM-009 AC4): files, child processes, the registry, the scenario server. No logic of
 * its own. Child processes get an array of arguments and never a shell (CWE-78); the environment passed to them is built by
 * commands.mjs from an allow-list, and nothing here prints an environment.
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel, receiveMessageOnPort, Worker } from 'node:worker_threads';

const MAX_OUTPUT = 64 * 1024 * 1024;
const FILE_SYSTEM_KEY = String.raw`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem`;

/**
 * The scenario server runs in a worker thread: spawnSync blocks this thread while Maestro runs, and the app needs answers meanwhile.
 * Requests come back on a channel read with receiveMessageOnPort, which works synchronously.
 * @param {number} port
 * @param {URL} [workerUrl] the worker module; tests pass a fixture that ends early
 * @returns {Promise<import('./stub-api.mjs').StubApi>}
 */
export async function startStubInWorker(port, workerUrl = new URL('./stub-worker.mjs', import.meta.url)) {
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(workerUrl, { workerData: { port, channel: port2 }, transferList: [port2] });
  /** @type {import('./stub-api.mjs').RecordedRequest[]} */
  const recorded = [];
  const drain = () => {
    for (let next = receiveMessageOnPort(port1); next !== undefined; next = receiveMessageOnPort(port1)) {
      const message = /** @type {unknown} */ (next.message);
      recorded.push(/** @type {import('./stub-api.mjs').RecordedRequest} */ (message));
    }
  };
  let exited = false;
  worker.on('exit', () => {
    exited = true;
    drain();
    port1.close();
  });
  /** @type {Promise<number>} */
  const listening = new Promise((resolve, reject) => {
    worker.once('message', (/** @type {{ port: number }} */ message) => {
      resolve(message.port);
    });
    worker.once('error', reject);
    worker.once('exit', () => {
      reject(new Error('stub worker exited'));
    });
  });
  return {
    port: await listening,
    setMode: (mode) => {
      worker.postMessage({ mode });
    },
    requests: () => {
      if (!exited) drain();
      return [...recorded];
    },
    close: () =>
      new Promise((resolve) => {
        if (exited) {
          resolve();
          return;
        }
        worker.once('exit', () => {
          resolve();
        });
        worker.postMessage({ close: true });
      }),
  };
}

/**
 * Gathers the screenshots of Maestro (<source>/<timestamp>/<flow>/takeScreenshot/*.png) flat into every target directory. The
 * traversal is in name order and the timestamps sort in time order, so a later run of a flow overwrites an earlier one.
 * @param {string} source
 * @param {string[]} targets
 * @returns {string[]} the sorted file names that were copied
 */
export function collectScreenshots(source, targets) {
  /** @type {Map<string, string>} */
  const found = new Map();
  /** @param {string} directory @param {boolean} inScreenshots */
  const walk = (directory, inScreenshots) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path, entry.name === 'takeScreenshot');
      else if (inScreenshots && entry.name.endsWith('.png')) found.set(entry.name, path);
    }
  };
  walk(source, false);
  for (const target of targets) {
    mkdirSync(target, { recursive: true });
    for (const [name, path] of found) copyFileSync(path, join(target, name));
  }
  return [...found.keys()].sort();
}

/** @param {string} text the registry answer for LongPathsEnabled */
export function parseLongPathsEnabled(text) {
  return /LongPathsEnabled\s+REG_DWORD\s+0x1\b/i.test(text);
}

/** @param {string} source the text of apps/mobile/plugins/expo-config.ts */
export function parseAppVersion(source) {
  return /APP_VERSION\s*=\s*'([^']+)'/.exec(source)?.[1] ?? 'unknown';
}

/**
 * @param {string} repoRoot
 * @returns {import('./run.mjs').Host}
 */
export function realHost(repoRoot) {
  return {
    repoRoot,
    platform: process.platform,
    env: process.env,
    homedir: homedir(),
    execPath: process.execPath,
    exists: existsSync,
    writeText: (path, text) => {
      writeFileSync(path, text);
    },
    readBytes: (path) => (existsSync(path) ? readFileSync(path) : null),
    removeFile: (path) => {
      rmSync(path, { force: true });
    },
    makeDirectory: (path) => {
      mkdirSync(path, { recursive: true });
    },
    resetDirectory: (path) => {
      rmSync(path, { recursive: true, force: true });
      mkdirSync(path, { recursive: true });
    },
    collectScreenshots,
    run: (command, args, { cwd, env, stream = false } = {}) => {
      const result = spawnSync(command, args, {
        ...(cwd === undefined ? {} : { cwd }),
        ...(env === undefined ? {} : { env }),
        encoding: 'utf8',
        stdio: stream ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        maxBuffer: MAX_OUTPUT,
        windowsHide: true,
      });
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    },
    startDetached: (command, args, { env } = {}) => {
      const child = spawn(command, args, { ...(env === undefined ? {} : { env }), detached: true, stdio: 'ignore' });
      child.unref();
    },
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
    now: () => Date.now(),
    longPathsEnabled: () => {
      if (process.platform !== 'win32') return null;
      const answer = spawnSync('reg.exe', ['query', FILE_SYSTEM_KEY, '/v', 'LongPathsEnabled'], { encoding: 'utf8', windowsHide: true });
      return parseLongPathsEnabled(answer.stdout);
    },
    resolveExpoCli: (directory) => createRequire(join(directory, 'package.json')).resolve('expo/bin/cli'),
    readAppVersion: (directory) => parseAppVersion(readFileSync(join(directory, 'plugins', 'expo-config.ts'), 'utf8')),
    startStub: startStubInWorker,
    log: (line) => {
      process.stdout.write(`${line}\n`);
    },
    today: () => new Date().toISOString().slice(0, 10),
  };
}

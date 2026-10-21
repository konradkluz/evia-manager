// @ts-check
/**
 * Wiring of the smoke test to the real machine (EVM-009 AC4): files, child processes, the registry, the scenario server. No logic of
 * its own. Child processes get an array of arguments and never a shell (CWE-78); the environment passed to them is built by
 * commands.mjs from an allow-list, and nothing here prints an environment.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
 * @returns {Promise<import('./stub-api.mjs').StubApi>}
 */
async function startStubInWorker(port) {
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(new URL('./stub-worker.mjs', import.meta.url), { workerData: { port, channel: port2 }, transferList: [port2] });
  /** @type {Promise<number>} */
  const listening = new Promise((resolve, reject) => {
    worker.once('message', (/** @type {{ port: number }} */ message) => {
      resolve(message.port);
    });
    worker.once('error', reject);
  });
  /** @type {import('./stub-api.mjs').RecordedRequest[]} */
  const recorded = [];
  return {
    port: await listening,
    setMode: (mode) => {
      worker.postMessage({ mode });
    },
    requests: () => {
      for (let next = receiveMessageOnPort(port1); next !== undefined; next = receiveMessageOnPort(port1)) {
        const message = /** @type {unknown} */ (next.message);
        recorded.push(/** @type {import('./stub-api.mjs').RecordedRequest} */ (message));
      }
      return [...recorded];
    },
    close: () =>
      new Promise((resolve) => {
        worker.once('exit', () => {
          port1.close();
          resolve();
        });
        worker.postMessage({ close: true });
      }),
  };
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
    makeDirectory: (path) => {
      mkdirSync(path, { recursive: true });
    },
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

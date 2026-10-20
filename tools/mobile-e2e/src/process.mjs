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
import { startStubApi } from './stub-api.mjs';

const MAX_OUTPUT = 64 * 1024 * 1024;
const FILE_SYSTEM_KEY = String.raw`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem`;

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
    startStub: (port) => startStubApi({ port }),
    log: (line) => {
      process.stdout.write(`${line}\n`);
    },
    today: () => new Date().toISOString().slice(0, 10),
  };
}

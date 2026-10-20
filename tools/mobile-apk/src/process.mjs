// @ts-check
/**
 * Wiring of the APK verification to the real machine (EVM-009): files and child processes. No logic of its own. Child processes get
 * an array of arguments and never a shell (CWE-78).
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const MAX_OUTPUT = 256 * 1024 * 1024;

/** @returns {import('./main.mjs').Host} */
export function realHost() {
  return {
    env: process.env,
    platform: process.platform,
    readFile: (path) => readFileSync(path),
    appendFile: (path, text) => {
      appendFileSync(path, text);
    },
    run: (command, args, { binary = false } = {}) => {
      const result = spawnSync(command, args, {
        encoding: binary ? 'latin1' : 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
        maxBuffer: MAX_OUTPUT,
        windowsHide: true,
      });
      return { status: result.status, stdout: result.stdout };
    },
    log: (line) => {
      process.stdout.write(`${line}\n`);
    },
  };
}

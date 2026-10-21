// @ts-check
/**
 * Wiring of the APK verification to the real machine (EVM-009): files and child processes. No logic of its own. Child processes get
 * an array of arguments and never a shell (CWE-78).
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { childEnv } from './env.mjs';

/** @param {unknown} value */
const text = (value) => (typeof value === 'string' ? value : '');

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
    cwd: () => process.cwd(),
    exists: (path) => existsSync(path),
    realpath: (path) => realpathSync.native(path),
    listDir: (path) => (existsSync(path) ? readdirSync(path) : []),
    remove: (path) => {
      rmSync(path, { force: true });
    },
    run: (command, args, { binary = false, quiet = false, interactive = false, env } = {}) => {
      const result = spawnSync(command, args, {
        encoding: binary ? 'latin1' : 'utf8',
        // interactive: the terminal is inherited for the prompt of apksigner; quiet: nothing reaches the terminal
        stdio: interactive ? 'inherit' : ['ignore', 'pipe', quiet ? 'pipe' : 'inherit'],
        maxBuffer: MAX_OUTPUT,
        // a process gets the allow-list unless the caller passes its own environment (only apksigner sign gets the passwords)
        env: env ?? childEnv(process.env),
        windowsHide: true,
      });
      return { status: result.status, stdout: text(result.stdout), stderr: text(result.stderr) };
    },
    log: (line) => {
      process.stdout.write(`${line}\n`);
    },
  };
}

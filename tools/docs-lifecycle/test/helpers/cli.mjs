// @ts-check
/** Test helpers: run `main` in-process (captured output) or the real CLI in a child process. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../../lib/main.mjs';

export const CLI = fileURLToPath(new URL('../../cli.mjs', import.meta.url));

/** Default clock of the tests: 2026-10-02 12:00 in Warsaw. */
export const NOW = () => new Date('2026-10-02T10:00:00Z');

/**
 * @param {string[]} argv
 * @param {{ cwd: string, env: NodeJS.ProcessEnv, now?: () => Date }} options
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
export function runMain(argv, { cwd, env, now = NOW }) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const code = main(argv, {
    cwd,
    env,
    now,
    stdout: { write: (chunk) => out.push(String(chunk)) },
    stderr: { write: (chunk) => err.push(String(chunk)) },
  });
  return { code, stdout: out.join(''), stderr: err.join('') };
}

/**
 * Real process (`process.execPath`, no shell) — real exit codes and stdout bytes decoded as UTF-8.
 * @param {string[]} argv
 * @param {{ cwd: string, env: NodeJS.ProcessEnv }} options
 * @returns {{ code: number | null, stdout: string, stderr: string }}
 */
export function runCli(argv, { cwd, env }) {
  const result = spawnSync(process.execPath, [CLI, ...argv], { cwd, env, encoding: 'utf8', windowsHide: true });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

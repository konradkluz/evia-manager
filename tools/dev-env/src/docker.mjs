// @ts-check
/**
 * The only place that starts Docker for the local environment (EVM-077; Konrad 2026-10-09; SR-SUPPLY-09, TM-60, TM-61):
 * exactly four command lines for compose.dev.yaml — never `docker run`, `docker compose run`, another `exec`, another file
 * or extra flags. tools/repo-policy compares COMMANDS with the frozen list and rejects every other form. The `exec`
 * inherits the terminal (stdio inherit, no -T): the activation link goes to the terminal only, never to a file or a log.
 */
import { spawn } from 'node:child_process';

const FILE = ['compose', '-f', 'compose.dev.yaml'];

export const COMMANDS = Object.freeze({
  up: Object.freeze([...FILE, 'up', '-d', '--wait', '--build']),
  down: Object.freeze([...FILE, 'down']),
  downVolumes: Object.freeze([...FILE, 'down', '-v']),
  adminExec: Object.freeze([...FILE, 'exec', 'api', 'node', 'dist/src/cli/bootstrap-admin.js']),
});

/**
 * @typedef {keyof typeof COMMANDS} CommandName
 * @typedef {{ status: number | null, stderr: string, error: Error | undefined }} DockerResult
 * @typedef {(name: CommandName) => Promise<DockerResult>} Docker
 */

/**
 * @param {{ cwd: string, env: NodeJS.ProcessEnv, spawnProcess?: typeof spawn, stderr?: { write(chunk: Buffer | string): unknown } }} options
 * @returns {Docker}
 */
export function dockerRunner({ cwd, env, spawnProcess = spawn, stderr = process.stderr }) {
  return (name) =>
    new Promise((resolve) => {
      const args = COMMANDS[name];
      // Only `up` captures stderr (shown live, kept to explain the failure); the terminal command inherits everything.
      const capture = name === 'up';
      const child = spawnProcess('docker', [...args], {
        cwd,
        env,
        windowsHide: true,
        stdio: capture ? ['ignore', 'inherit', 'pipe'] : 'inherit',
      });
      let collected = '';
      child.stderr?.on('data', (/** @type {Buffer} */ chunk) => {
        collected = (collected + chunk.toString('utf8')).slice(-20_000);
        stderr.write(chunk);
      });
      child.on('error', (error) => {
        resolve({ status: null, stderr: collected, error });
      });
      child.on('close', (status) => {
        resolve({ status, stderr: collected, error: undefined });
      });
    });
}

/**
 * What went wrong with `up`, from the output of Docker (no value of a variable is ever included).
 * @param {DockerResult} result
 * @returns {'no-docker' | 'daemon' | 'port' | 'other'}
 */
export function classifyUpFailure({ error, stderr }) {
  if (error !== undefined) return /** @type {{ code?: string }} */ (error).code === 'ENOENT' ? 'no-docker' : 'other';
  if (/cannot connect to the docker daemon|error during connect|pipe\/docker|docker daemon is not running/i.test(stderr)) return 'daemon';
  if (/port is already allocated|address already in use|ports are not available|bind for .* failed/i.test(stderr)) return 'port';
  return 'other';
}

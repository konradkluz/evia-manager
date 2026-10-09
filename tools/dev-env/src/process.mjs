// @ts-check
/**
 * Wiring of the commands to the real process (EVM-077): files, Docker, child processes, the terminal. No logic of its own;
 * the host (streams, spawn, file access) is a parameter, so each connection is tested with fakes.
 * Child processes never go through turbo, a shell, a file or a pipe that keeps output: the activation link is printed by the
 * `docker compose exec` child directly to the terminal. The panel is started with Node and the Vite binary — no shell.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { dockerRunner } from './docker.mjs';
import { parseDotenv } from './dotenv.mjs';

/**
 * @typedef {{
 *   env: NodeJS.ProcessEnv,
 *   execPath: string,
 *   stdin: NodeJS.ReadStream,
 *   stdout: NodeJS.WriteStream,
 *   stderr: NodeJS.WriteStream,
 *   readFile: (path: string) => string,
 *   spawn: typeof spawn,
 *   spawnSync: typeof spawnSync,
 *   createInterface: typeof createInterface,
 *   resolve: (directory: string, request: string) => string,
 * }} Host
 */

/** @returns {Host} */
export function realHost() {
  return {
    env: process.env,
    execPath: process.execPath,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    readFile: (path) => readFileSync(path, 'utf8'),
    spawn,
    spawnSync,
    createInterface,
    resolve: (directory, request) => createRequire(join(directory, 'package.json')).resolve(request),
  };
}

/**
 * @param {string} root repository root
 * @param {Host} [host]
 * @returns {import('./commands.mjs').Deps}
 */
export function processDeps(root, host = realHost()) {
  const api = join(root, 'apps', 'api');
  const tool = join(api, '.dev-build', 'dev', 'cli.js');
  const readDotenv = () => {
    try {
      return host.readFile(join(root, '.env'));
    } catch {
      return null;
    }
  };
  return {
    root,
    env: host.env,
    stdinIsTTY: host.stdin.isTTY,
    stdoutIsTTY: host.stdout.isTTY,
    out: (text) => void host.stdout.write(text),
    err: (text) => void host.stderr.write(text),
    ask: async (prompt) => {
      const terminal = host.createInterface({ input: host.stdin, output: host.stdout });
      try {
        return await terminal.question(prompt);
      } finally {
        terminal.close();
      }
    },
    readDotenv,
    docker: (name) => {
      // CURSOR_KEY reaches the container as a bare name (compose.dev.yaml): the value comes from this process only.
      const { CURSOR_KEY } = parseDotenv(readDotenv() ?? '');
      const env = { ...host.env, ...(CURSOR_KEY === undefined ? {} : { CURSOR_KEY }) };
      return dockerRunner({ cwd: root, env, spawnProcess: host.spawn, stderr: host.stderr })(name);
    },
    buildTools: (env) =>
      host.spawnSync(host.execPath, [host.resolve(api, 'typescript/bin/tsc'), '-p', 'tsconfig.dev.json'], {
        cwd: api,
        env,
        stdio: 'inherit',
        windowsHide: true,
      }).status ?? 1,
    runTool: (command, env) => {
      // stdout is null when the process could not be started
      const result = /** @type {{ status: number | null, stdout: string | null }} */ (
        host.spawnSync(host.execPath, [tool, command], {
          cwd: api,
          env,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'inherit'],
          windowsHide: true,
        })
      );
      return { status: result.status, stdout: result.stdout ?? '' };
    },
    runPanel: (env) =>
      new Promise((resolve) => {
        const web = join(root, 'apps', 'web');
        const vite = join(dirname(host.resolve(web, 'vite/package.json')), 'bin', 'vite.js');
        const child = host.spawn(host.execPath, [vite], { cwd: web, env, stdio: 'inherit', windowsHide: true });
        child.on('close', (status) => {
          resolve(status ?? 0);
        });
        child.on('error', () => {
          resolve(1);
        });
      }),
  };
}

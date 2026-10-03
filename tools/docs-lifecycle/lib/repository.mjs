// @ts-check
/**
 * The only I/O of the tool — read-only (finding F):
 * - git runs without a shell and only with an allow-list of read-only commands;
 * - the file set comes from git (tracked + untracked not ignored), never from walking the disk;
 * - only `.md` files from that set are read, without following symbolic links;
 * - paths found inside documents are never opened (finding E).
 */
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { errorMessage, ToolError } from './errors.mjs';

const ALLOWED_GIT_COMMANDS = new Set(['rev-parse', 'ls-files', 'check-ignore']);
const MAX_BUFFER = 64 * 1024 * 1024;

/** @typedef {{ status: number, stdout: string, stderr: string }} GitResult */
/** @typedef {(args: string[], options: { cwd: string, env: NodeJS.ProcessEnv }) => GitResult} GitRunner */

/**
 * Runs an allowed read-only git command; a non-zero exit status is returned, not thrown.
 * @param {string[]} args
 * @param {{ cwd: string, env: NodeJS.ProcessEnv }} options
 * @returns {GitResult}
 */
export function runGit(args, { cwd, env }) {
  if (!ALLOWED_GIT_COMMANDS.has(args[0])) {
    throw new ToolError(`niedozwolone polecenie git: ${args[0]} (narzędzie tylko czyta repozytorium)`);
  }
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      env,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = /** @type {{ status?: number | null, stdout?: string, stderr?: string }} */ (error);
    if (typeof failure.status === 'number') {
      return { status: failure.status, stdout: String(failure.stdout), stderr: String(failure.stderr) };
    }
    throw new ToolError(`nie można uruchomić git (${errorMessage(error)}) — sprawdź instalację gita i katalog roboczy`);
  }
}

/**
 * @param {string} stderr
 * @returns {string}
 */
function firstLine(stderr) {
  return stderr.trim().split('\n')[0];
}

/**
 * @param {string} output NUL-separated list (`git ls-files -z`)
 * @returns {string[]}
 */
function splitNul(output) {
  return output.split('\0').filter((path) => path !== '');
}

/**
 * Reads a regular file; symbolic links and other non-regular entries are not followed (→ null).
 * @param {string} absolutePath
 * @param {string} path repository-relative path (for messages)
 * @param {{ lstatSync: typeof lstatSync, readFileSync: typeof readFileSync }} [fs]
 * @returns {string | null}
 */
export function readRegularFile(absolutePath, path, fs = { lstatSync, readFileSync }) {
  try {
    if (!fs.lstatSync(absolutePath).isFile()) return null;
    return fs.readFileSync(absolutePath, 'utf8');
  } catch (error) {
    throw new ToolError(`nie można odczytać pliku ${path}: ${errorMessage(error)}`);
  }
}

/**
 * @typedef {object} LoadedRepository
 * @property {string} root absolute path of the repository root
 * @property {string[]} paths files visible to git, repository-relative with `/`, unique
 * @property {(path: string) => string | null} read content of a file from the set
 * @property {boolean} scratchIgnored whether git ignores the scratch directory
 */

/**
 * @param {{ cwd: string, env: NodeJS.ProcessEnv, config: import('./config.mjs').Config, git?: GitRunner }} options
 * @returns {LoadedRepository}
 */
export function loadRepository({ cwd, env, config, git = runGit }) {
  const top = git(['rev-parse', '--show-toplevel'], { cwd, env });
  if (top.status !== 0) {
    throw new ToolError(
      `brak repozytorium git w katalogu ${cwd} — uruchom polecenie w katalogu repozytorium (${firstLine(top.stderr)})`,
    );
  }
  const root = resolve(top.stdout.trim());
  /** @param {string[]} args */
  const run = (args) => {
    const result = git(args, { cwd: root, env });
    if (result.status > (args[0] === 'check-ignore' ? 1 : 0)) {
      throw new ToolError(`git ${args[0]} zakończył się błędem: ${firstLine(result.stderr)}`);
    }
    return result;
  };
  const visible = splitNul(run(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).stdout);
  const deleted = new Set(splitNul(run(['ls-files', '-z', '--deleted']).stdout));
  // `--no-index` + a probe path inside the directory: works whether or not the directory exists (finding F).
  const probe = run(['check-ignore', '-q', '--no-index', `${config.scratchDir}/probe.md`]);
  return {
    root,
    paths: [...new Set(visible)].filter((path) => !deleted.has(path)),
    read: (path) => readRegularFile(join(root, ...path.split('/')), path),
    scratchIgnored: probe.status === 0,
  };
}

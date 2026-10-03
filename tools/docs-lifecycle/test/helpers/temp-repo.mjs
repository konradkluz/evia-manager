// @ts-check
/**
 * Test helper: a throw-away git repository in the OS temp directory (EVM-012).
 * Git runs isolated from the user's configuration (finding G): empty global config,
 * no system config, no inherited GIT_* variables, no XDG ignore file, autocrlf off.
 * Files become "tracked" via `git add -f` — no commits are needed.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

/** Default `.gitignore` of a fixture repository (mirrors the real one for `.scratch/`). */
export const DEFAULT_GITIGNORE = '.scratch/\n';

/**
 * Environment for git (and for the validator under test) isolated from the developer's setup.
 * @param {string} base directory owned by the test (config files are created inside it)
 * @returns {NodeJS.ProcessEnv}
 */
export function isolatedEnv(base) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^GIT_/i.test(key)) delete env[key];
  }
  const globalConfig = join(base, 'gitconfig-global');
  writeFileSync(globalConfig, '');
  env.GIT_CONFIG_GLOBAL = globalConfig;
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CEILING_DIRECTORIES = base;
  env.XDG_CONFIG_HOME = join(base, 'xdg');
  return env;
}

/**
 * @typedef {object} TempRepo
 * @property {string} base temp directory (repository lives in `base/repo`)
 * @property {string} root repository root
 * @property {NodeJS.ProcessEnv} env isolated environment
 * @property {(...args: string[]) => string} git runs git in the repository root
 * @property {(path: string, content: string | Buffer) => void} write writes a file (repo-relative path with `/`)
 * @property {(...paths: string[]) => void} track `git add -f` for the given paths
 * @property {() => void} cleanup removes the temp directory
 */

/**
 * @param {{ files?: Record<string, string | Buffer>, tracked?: string[], gitignore?: string | null, init?: boolean }} [options]
 * @returns {TempRepo}
 */
export function createTempRepo({ files = {}, tracked = [], gitignore = DEFAULT_GITIGNORE, init = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'evm-012-'));
  const root = join(base, 'repo');
  mkdirSync(root);
  const env = isolatedEnv(base);
  /** @param {string[]} args */
  const git = (...args) =>
    execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'init.defaultBranch=main', ...args], {
      cwd: root,
      env,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  /** @type {TempRepo['write']} */
  const write = (path, content) => {
    const abs = join(root, ...path.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  };
  if (init) git('init', '-q');
  if (gitignore !== null) write('.gitignore', gitignore);
  for (const [path, content] of Object.entries(files)) write(path, content);
  /** @param {string[]} paths */
  const track = (...paths) => {
    git('add', '-f', '--', ...paths);
  };
  if (tracked.length > 0) track(...tracked);
  return {
    base,
    root,
    env,
    git,
    write,
    track,
    cleanup: () => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  };
}

/**
 * Snapshot of the working tree (without `.git/`): path, size, mtime and SHA-256 of every file,
 * plus `git status --porcelain`. Used to prove that the tool changes nothing (EVM-012 AC5).
 * @param {TempRepo} repo
 * @returns {{ files: string[], status: string }}
 */
export function snapshotRepo(repo) {
  /** @type {string[]} */
  const files = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = relative(repo.root, abs).split(sep).join('/');
      if (rel === '.git') continue;
      if (entry.isDirectory()) {
        files.push(`${rel}/`);
        walk(abs);
      } else {
        const stat = statSync(abs);
        const hash = createHash('sha256').update(readFileSync(abs)).digest('hex');
        files.push(`${rel} ${stat.size} ${stat.mtimeMs} ${hash}`);
      }
    }
  };
  walk(repo.root);
  files.sort();
  return { files, status: repo.git('status', '--porcelain', '--untracked-files=all') };
}

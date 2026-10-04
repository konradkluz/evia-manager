// @ts-check
/**
 * Entry point logic of the backend-tests container (ADR-0015 M3, EVM-006 p. 4, W3b, W10).
 * The repository is mounted read-only under /src (allow-listed paths only); writable state lives in the named
 * volume /work: the working copy /work/repo (with Linux node_modules), the pnpm store /work/pnpm-store (same file
 * system — hard links) and the cache XDG_CACHE_HOME=/work/cache set in the image (pnpm verifies the lockfile against
 * minimumReleaseAge with cached package metadata, also offline). Flow:
 *   install          → sync /src → /work/repo, `pnpm install --frozen-lockfile` (network)
 *   <command …>      → sync, `pnpm install --offline --frozen-lockfile`, run the command, export lcov to /out
 * Deletes only inside the working copy, never follows symbolic links, never touches node_modules or the store.
 */
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/** Generated directories: never copied from /src and never deleted in the working copy. */
export const SKIPPED = new Set(['node_modules', '.turbo', 'dist', 'coverage', '.git']);
const WORKSPACE_ROOTS = ['apps', 'packages', 'services', 'tools'];
const USAGE = 'Użycie: sync.mjs install | sync.mjs <polecenie> [argumenty…] (punkt wejścia kontenera backend-tests)';

/**
 * @param {string} root
 * @param {string} target
 * @returns {string} the resolved target, guaranteed to be strictly inside root
 */
export function assertInside(root, target) {
  const base = resolve(root);
  const path = resolve(target);
  if (!path.startsWith(base + sep)) throw new Error(`refusing to modify a path outside ${base}: ${path}`);
  return path;
}

/** @param {string} path */
function entries(path) {
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** @param {string} path */
function stat(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/**
 * Removes a file, a symbolic link (the link itself) or a directory tree inside root.
 * @param {string} root
 * @param {string} path
 */
function remove(root, path) {
  const target = assertInside(root, path);
  const info = stat(target);
  if (info === null) return;
  if (info.isDirectory()) rmSync(target, { recursive: true, force: true });
  else unlinkSync(target);
}

/**
 * Mirrors src into dest: copies new and changed regular files (compared by content), removes entries that
 * no longer exist in src. Generated directories (SKIPPED) are ignored on both sides; symbolic links in src are skipped.
 * @param {string} src
 * @param {string} dest
 * @returns {{ copied: number, removed: number, unchanged: number }}
 */
export function syncTree(src, dest) {
  const stats = { copied: 0, removed: 0, unchanged: 0 };
  const root = resolve(dest);
  /** @param {string} from @param {string} to */
  const walk = (from, to) => {
    const wanted = new Set();
    for (const entry of entries(from)) {
      if (SKIPPED.has(entry.name) || entry.isSymbolicLink()) continue;
      const source = join(from, entry.name);
      const target = assertInside(root, join(to, entry.name));
      const existing = stat(target);
      if (entry.isDirectory()) {
        wanted.add(entry.name);
        if (existing !== null && !existing.isDirectory()) remove(root, target);
        mkdirSync(target, { recursive: true });
        walk(source, target);
      } else if (entry.isFile()) {
        wanted.add(entry.name);
        if (existing?.isFile() && existing.size === lstatSync(source).size && readFileSync(target).equals(readFileSync(source))) {
          stats.unchanged += 1;
          continue;
        }
        if (existing !== null) remove(root, target);
        copyFileSync(source, target);
        stats.copied += 1;
      }
    }
    for (const entry of entries(to)) {
      if (SKIPPED.has(entry.name) || wanted.has(entry.name)) continue;
      remove(root, join(to, entry.name));
      stats.removed += 1;
    }
  };
  mkdirSync(root, { recursive: true });
  walk(resolve(src), root);
  return stats;
}

/**
 * Copies `<apps|packages|services|tools>/<workspace>/coverage/lcov.info` from the working copy to out, after
 * clearing out (no stale report may survive — W3b).
 * @param {string} repo
 * @param {string} out
 * @returns {string[]} exported repository paths
 */
export function exportCoverage(repo, out) {
  mkdirSync(out, { recursive: true });
  for (const entry of entries(out)) remove(out, join(out, entry.name));
  const exported = [];
  for (const dir of WORKSPACE_ROOTS) {
    for (const workspace of entries(join(repo, dir))) {
      if (!workspace.isDirectory()) continue;
      const report = join(repo, dir, workspace.name, 'coverage', 'lcov.info');
      if (!stat(report)?.isFile()) continue;
      const path = relative(repo, report).split(sep).join('/');
      const target = assertInside(out, join(out, path));
      mkdirSync(join(target, '..'), { recursive: true });
      copyFileSync(report, target);
      exported.push(path);
    }
  }
  return exported.sort();
}

/**
 * @typedef {object} Context
 * @property {string} src read-only sources (/src)
 * @property {string} repo working copy (/work/repo)
 * @property {string} store pnpm store (/work/pnpm-store)
 * @property {string} out coverage output (/out, mounted at coverage/backend-tests)
 * @property {(command: string, args: string[], cwd: string) => number} spawn
 * @property {(line: string) => void} log
 */

/**
 * @param {string[]} argv
 * @param {Context} context
 * @returns {number} exit code
 */
export function main(argv, { src, repo, store, out, spawn, log }) {
  const [command, ...args] = argv;
  if (command === undefined) {
    log(USAGE);
    return 2;
  }
  const stats = syncTree(src, repo);
  log(`backend-tests: synchronizacja źródeł — skopiowano ${stats.copied}, usunięto ${stats.removed}, bez zmian ${stats.unchanged}`);
  if (command === 'install') return spawn('pnpm', ['install', '--frozen-lockfile', '--store-dir', store], repo);
  const installed = spawn('pnpm', ['install', '--offline', '--frozen-lockfile', '--store-dir', store], repo);
  if (installed !== 0) {
    log('backend-tests: brak zależności w wolumenie — najpierw uruchom: docker compose -f compose.yaml run --rm backend-install');
    return installed;
  }
  const status = spawn(command, args, repo);
  const exported = exportCoverage(repo, out);
  log(`backend-tests: raporty pokrycia → coverage/backend-tests (${exported.length})`);
  return status;
}

// @ts-check
/**
 * Git hooks (lefthook) — installation from the root `prepare` script and the check at the start of `pnpm run gate`
 * (EVM-006 AC5, W1, security B7). Runs without installed dependencies (only node:*).
 *   install  → skipped in CI and outside a git work tree (backend-tests container, `pnpm install` without .git);
 *              otherwise `lefthook install` (the package's own postinstall is disabled: allowBuilds lefthook: false)
 *   check    → the pre-commit and pre-push hooks exist and are lefthook hooks, core.hooksPath does not bypass them
 * Local hooks can always be skipped (LEFTHOOK=0, --no-verify); the binding gates are in CI.
 */
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const USAGE = 'Użycie: node tools/git-hooks/cli.mjs install | check';
const HOOKS = ['pre-commit', 'pre-push'];

/**
 * @typedef {object} Io
 * @property {string} cwd
 * @property {NodeJS.ProcessEnv} env
 * @property {(line: string) => void} stdout
 * @property {(line: string) => void} stderr
 * @property {(args: string[], cwd: string) => { status: number, stdout: string }} git
 * @property {(args: string[], cwd: string) => number} lefthook runs the lefthook CLI of the repository
 */

/** @param {string | undefined} value */
const enabled = (value) => value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false';

/**
 * @param {string[]} argv
 * @param {Io} io
 * @returns {number}
 */
export function main(argv, io) {
  if (argv.length !== 1 || (argv[0] !== 'install' && argv[0] !== 'check')) {
    io.stderr(USAGE);
    return 2;
  }
  const top = io.git(['rev-parse', '--show-toplevel'], io.cwd);
  if (argv[0] === 'install') {
    if (enabled(io.env['CI'])) {
      io.stdout('git-hooks: pominięto instalację hooków (CI — bramki wiążące działają w workflowach)');
      return 0;
    }
    if (top.status !== 0) {
      io.stdout('git-hooks: pominięto instalację hooków (brak repozytorium git, np. kontener backend-tests)');
      return 0;
    }
    return io.lefthook(['install'], top.stdout.trim());
  }
  if (top.status !== 0) {
    io.stderr('git-hooks: brak repozytorium git — bramka lokalna działa w klonie repozytorium');
    return 1;
  }
  return check(top.stdout.trim(), io);
}

/**
 * @param {string} root
 * @param {Io} io
 */
function check(root, io) {
  const hooksPath = io.git(['config', '--get', 'core.hooksPath'], root);
  if (hooksPath.status === 0 && hooksPath.stdout.trim() !== '') {
    io.stderr(
      `git-hooks: ustawione core.hooksPath (${hooksPath.stdout.trim()}) — hooki lefthook są pomijane; usuń: git config --unset core.hooksPath`,
    );
    return 1;
  }
  const dir = io.git(['rev-parse', '--git-path', 'hooks'], root).stdout.trim();
  const hooksDir = resolve(root, dir);
  const missing = HOOKS.filter((hook) => !isLefthookHook(join(hooksDir, hook)));
  if (missing.length > 0) {
    io.stderr(`git-hooks: brak hooków ${missing.join(', ')} (lefthook) — uruchom pnpm install albo pnpm exec lefthook install`);
    return 1;
  }
  io.stdout('git-hooks: hooki pre-commit i pre-push zainstalowane (lefthook)');
  return 0;
}

/** @param {string} path */
function isLefthookHook(path) {
  try {
    return lstatSync(path).isFile() && readFileSync(path, 'utf8').includes('lefthook');
  } catch {
    return false;
  }
}

/** @type {Io['git']} */
export function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return { status: result.status ?? 1, stdout: result.stdout };
}

/** @type {Io['lefthook']} */
export function lefthook(args, cwd) {
  const bin = join(cwd, 'node_modules', 'lefthook', 'bin', 'index.js');
  return spawnSync(process.execPath, [bin, ...args], { cwd, stdio: 'inherit' }).status ?? 1;
}

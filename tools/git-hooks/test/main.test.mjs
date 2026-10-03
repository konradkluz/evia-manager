// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { git, lefthook, main } from '../lib/main.mjs';

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));

/** @type {string} */
let root;

/**
 * @param {string[]} argv
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string, lefthookStatus?: number }} [options]
 */
function run(argv, { env = {}, cwd = root, lefthookStatus = 0 } = {}) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const calls = [];
  const status = main(argv, {
    cwd,
    env,
    stdout: (line) => out.push(line),
    stderr: (line) => out.push(`ERR ${line}`),
    git,
    lefthook: (args, dir) => {
      calls.push(`lefthook ${args.join(' ')} @ ${dir}`);
      return lefthookStatus;
    },
  });
  return { status, out: out.join('\n'), calls };
}

/** @param {string} hook @param {string} text */
const writeHook = (hook, text) => {
  mkdirSync(join(root, '.git', 'hooks'), { recursive: true });
  writeFileSync(join(root, '.git', 'hooks', hook), text);
};

describe('git hooks — install and check (EVM-006 AC5, W1)', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'evm006-hooks-'));
    spawnSync('git', ['init', '--quiet', root]);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('EVM-006 AC5: install runs lefthook install in the repository root', () => {
    const { status, calls } = run(['install']);
    assert.equal(status, 0);
    assert.equal(calls.length, 1);
    assert.match(calls[0] ?? '', /^lefthook install @ /);
  });

  it('EVM-006 W1: install is skipped in CI and outside a git repository (backend-tests container) — never an error', () => {
    for (const ci of ['true', '1']) {
      const skipped = run(['install'], { env: { CI: ci } });
      assert.equal(skipped.status, 0);
      assert.deepEqual(skipped.calls, []);
      assert.match(skipped.out, /CI/);
    }
    const plain = mkdtempSync(join(tmpdir(), 'evm006-nogit-'));
    try {
      const noGit = run(['install'], { cwd: plain });
      assert.equal(noGit.status, 0);
      assert.deepEqual(noGit.calls, []);
      assert.match(noGit.out, /brak repozytorium git/);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it('EVM-006 AC5: install reports a lefthook failure; CI=false or 0 does not skip', () => {
    assert.equal(run(['install'], { env: { CI: 'false' }, lefthookStatus: 1 }).status, 1);
    assert.equal(run(['install'], { env: { CI: '0' } }).calls.length, 1);
  });

  it('EVM-006 AC5: check passes when both lefthook hooks are installed', () => {
    writeHook('pre-commit', '#!/bin/sh\n# lefthook\n');
    writeHook('pre-push', '#!/bin/sh\n# lefthook\n');
    const { status, out } = run(['check']);
    assert.equal(status, 0, out);
  });

  it('EVM-006 AC5: check fails when a hook is missing or is not a lefthook hook', () => {
    writeHook('pre-commit', '#!/bin/sh\n# lefthook\n');
    writeHook('pre-push', '#!/bin/sh\nexit 0\n');
    const { status, out } = run(['check']);
    assert.equal(status, 1);
    assert.match(out, /pre-push/);
  });

  it('EVM-006 AC5: check fails when no hooks are installed at all', () => {
    const { status, out } = run(['check']);
    assert.equal(status, 1);
    assert.match(out, /pre-commit, pre-push/);
  });

  it('EVM-006 AC5: check fails when core.hooksPath redirects hooks elsewhere (bypass)', () => {
    writeHook('pre-commit', '# lefthook');
    writeHook('pre-push', '# lefthook');
    spawnSync('git', ['-C', root, 'config', 'core.hooksPath', '/dev/null']);
    const { status, out } = run(['check']);
    assert.equal(status, 1);
    assert.match(out, /core\.hooksPath/);
  });

  it('EVM-006 AC5: check outside a repository and usage errors fail', () => {
    const plain = mkdtempSync(join(tmpdir(), 'evm006-nogit-'));
    try {
      assert.equal(run(['check'], { cwd: plain }).status, 1);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
    assert.equal(run([]).status, 2);
    assert.equal(run(['uninstall']).status, 2);
  });

  it('EVM-006 AC5: the lefthook runner starts the CLI of the repository with node (missing CLI → non-zero)', () => {
    assert.notEqual(lefthook(['version'], root), 0);
  });

  it('EVM-006 AC5: the CLI entry point passes arguments and the exit code', () => {
    const result = spawnSync(process.execPath, [CLI, 'bogus'], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Użycie/);
  });
});

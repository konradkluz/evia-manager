// @ts-check
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { main, oneLine } from '../lib/main.mjs';
import { capture, tempRepo } from './helpers/repo.mjs';

const EXCLUSIONS = JSON.stringify({
  exclude: [
    { pattern: '**/test/**', reason: 'tests' },
    { pattern: '**/*.test.*', reason: 'tests' },
  ],
});

/**
 * @param {string} source
 * @param {number} n
 * @param {(line: number) => number} hits
 */
const lcov = (source, n, hits) =>
  ['TN:', `SF:${source}`, ...Array.from({ length: n }, (_, i) => `DA:${i + 1},${hits(i + 1)}`), 'end_of_record', ''].join('\n');

/** @type {ReturnType<typeof tempRepo>} */
let repo;

/** @param {string[]} [args] */
function run(args = []) {
  const out = capture();
  const err = capture();
  const status = main(args, { cwd: repo.root, stdout: out.stream, stderr: err.stream });
  return { status, out: out.text, err: err.text };
}

const SOURCE_10 = Array.from({ length: 10 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';

describe('diff-coverage CLI on a temporary repository (EVM-006 AC3)', () => {
  beforeEach(() => {
    repo = tempRepo('evm006-diffcov-');
    repo.write('packages/config/coverage-exclusions.json', EXCLUSIONS);
    repo.write('README.md', '# synthetic\n');
    repo.commit('chore: base');
    repo.git(['checkout', '--quiet', '-b', 'feature/EVM-999-x']);
  });
  afterEach(() => {
    repo.dispose();
  });

  it('EVM-006 AC3: a changed file covered ≥ 90% → exit 0 and a green verdict', () => {
    repo.write('packages/p/src/a.ts', SOURCE_10);
    repo.commit('feat: a');
    repo.write(
      'packages/p/coverage/lcov.info',
      lcov('src\\a.ts', 10, () => 1),
    );
    const { status, out } = run();
    assert.equal(status, 0, out);
    assert.match(out, /packages\/p\/src\/a\.ts/);
    assert.match(out, /ZIELONY/);
  });

  it('EVM-006 AC3: deliberately uncovered code → exit 1 with the list of uncovered lines', () => {
    repo.write('packages/p/src/a.ts', SOURCE_10);
    repo.commit('feat: a');
    repo.write(
      'packages/p/coverage/lcov.info',
      lcov('src/a.ts', 10, (line) => (line <= 5 ? 1 : 0)),
    );
    const { status, out } = run();
    assert.equal(status, 1, out);
    assert.match(out, /6, 7, 8, 9, 10/);
    assert.match(out, /CZERWONY/);
  });

  it('EVM-006 AC3: uncommitted and untracked changes count (TDD loop); a source file without a report is uncovered', () => {
    repo.write('tools/t/lib/new.mjs', 'export const x = 1;\n');
    const { status, out } = run();
    assert.equal(status, 1, out);
    assert.match(out, /tools\/t\/lib\/new\.mjs/);
    assert.match(out, /brak raportu/);
  });

  it('EVM-006 AC3: host and container reports of one workspace are merged', () => {
    repo.write('packages/p/src/a.ts', SOURCE_10);
    repo.commit('feat: a');
    repo.write(
      'packages/p/coverage/lcov.info',
      lcov('src\\a.ts', 10, (line) => (line <= 5 ? 1 : 0)),
    );
    repo.write(
      'coverage/backend-tests/packages/p/coverage/lcov.info',
      lcov('src/a.ts', 10, (line) => (line > 5 ? 1 : 0)),
    );
    const { status, out } = run();
    assert.equal(status, 0, out);
  });

  it('EVM-006 AC3: only documentation and tests changed → exit 0 with a "no measurable changes" message', () => {
    repo.write('docs/x.md', '# x\n');
    repo.write('packages/p/test/a.test.ts', 'test\n');
    const { status, out } = run();
    assert.equal(status, 0);
    assert.match(out, /Brak mierzalnych zmian/);
  });

  it('EVM-006 AC3: on main the base is the previous commit; origin/main wins over main', () => {
    repo.git(['checkout', '--quiet', 'main']);
    repo.write('packages/p/src/a.ts', SOURCE_10);
    repo.commit('feat: a on main');
    const first = run();
    assert.equal(first.status, 1, first.out);
    assert.match(first.out, /packages\/p\/src\/a\.ts/);
    repo.git(['update-ref', 'refs/remotes/origin/main', 'HEAD~1']);
    repo.git(['checkout', '--quiet', '-b', 'feature/EVM-999-y']);
    repo.write(
      'packages/p/coverage/lcov.info',
      lcov('src/a.ts', 10, () => 1),
    );
    assert.equal(run().status, 0);
  });

  it('EVM-006 AC3: the first commit of a repository is compared with the empty tree', () => {
    const fresh = tempRepo('evm006-fresh-');
    try {
      fresh.write('packages/config/coverage-exclusions.json', EXCLUSIONS);
      fresh.write('packages/p/src/a.ts', SOURCE_10);
      fresh.commit('feat: initial');
      const out = capture();
      const status = main([], { cwd: fresh.root, stdout: out.stream, stderr: capture().stream });
      assert.equal(status, 1, out.text);
    } finally {
      fresh.dispose();
    }
  });

  it('EVM-006 AC3: a report naming a file outside the repository is ignored', () => {
    repo.write('packages/p/src/a.ts', SOURCE_10);
    repo.write(
      'packages/p/coverage/lcov.info',
      lcov('/usr/lib/a.ts', 10, () => 1),
    );
    assert.equal(run().status, 1);
  });

  it('EVM-006 AC3: clean removes stale lcov reports of workspaces and of the container output only', () => {
    for (const path of [
      'packages/p/coverage/lcov.info',
      'tools/t/coverage/lcov.info',
      'coverage/backend-tests/packages/p/coverage/lcov.info',
    ]) {
      repo.write(path, 'TN:\n');
    }
    repo.write('packages/p/coverage/keep.txt', 'x');
    repo.write('packages/p/src/lcov.info', 'not a report location');
    const { status, out } = run(['clean']);
    assert.equal(status, 0);
    assert.match(out, /usunięto 3/);
    assert.equal(existsSync(join(repo.root, 'packages/p/coverage/lcov.info')), false);
    assert.equal(existsSync(join(repo.root, 'coverage/backend-tests/packages/p/coverage/lcov.info')), false);
    assert.equal(existsSync(join(repo.root, 'packages/p/coverage/keep.txt')), true);
    assert.equal(existsSync(join(repo.root, 'packages/p/src/lcov.info')), true);
  });

  it('EVM-006 AC3: clean and report discovery never follow symbolic links', (t) => {
    const outside = tempRepo('evm006-outside-');
    try {
      outside.write('coverage/lcov.info', 'TN:\n');
      outside.write('nested/coverage/lcov.info', 'TN:\n');
      mkdirSync(join(repo.root, 'packages'), { recursive: true });
      mkdirSync(join(repo.root, 'coverage', 'backend-tests'), { recursive: true });
      try {
        symlinkSync(outside.root, join(repo.root, 'packages', 'linked'), 'junction');
        symlinkSync(outside.root, join(repo.root, 'coverage', 'backend-tests', 'linked'), 'junction');
      } catch {
        t.skip('symbolic links are not available on this system');
        return;
      }
      const { status } = run(['clean']);
      assert.equal(status, 0);
      assert.equal(existsSync(join(outside.root, 'coverage/lcov.info')), true);
      assert.equal(existsSync(join(outside.root, 'nested/coverage/lcov.info')), true);
    } finally {
      outside.dispose();
    }
  });

  it('EVM-006 AC3: usage and environment errors → exit 2', () => {
    assert.equal(run(['unknown']).status, 2);
    assert.equal(run(['clean', 'extra']).status, 2);
    repo.git(['branch', '-m', 'main', 'trunk']);
    const missing = run();
    assert.equal(missing.status, 2);
    assert.match(missing.err, /main/);
  });

  it('EVM-006 AC3: outside a git repository → exit 2', () => {
    const plain = tempRepo('evm006-plain-');
    plain.dispose();
    mkdirSync(plain.root, { recursive: true });
    try {
      const err = capture();
      const status = main([], { cwd: plain.root, stdout: capture().stream, stderr: err.stream });
      assert.equal(status, 2);
      assert.match(err.text, /git/);
    } finally {
      plain.dispose();
    }
  });

  it('EVM-006 AC3: untrusted file names cannot start a new log line (no injected ::workflow commands)', () => {
    assert.equal(oneLine('a.ts\n::error::x\r\u0007\u007f'), 'a.ts?::error::x???');
  });

  it('EVM-006 AC3: an invalid exclusions file → exit 2', () => {
    writeFileSync(join(repo.root, 'packages/config/coverage-exclusions.json'), '{"exclude":[{"pattern":"x"}]}');
    const { status, err } = run();
    assert.equal(status, 2);
    assert.match(err, /coverage-exclusions/);
  });
});

describe('diff-coverage fails closed on unusual diffs (EVM-006 AC3; QA and code review, round 2)', () => {
  beforeEach(() => {
    repo = tempRepo('evm006-diffcov-closed-');
    repo.write('packages/config/coverage-exclusions.json', EXCLUSIONS);
    repo.write('README.md', '# synthetic\n');
    repo.commit('chore: base');
    repo.git(['checkout', '--quiet', '-b', 'feature/EVM-999-closed']);
  });
  afterEach(() => {
    repo.dispose();
  });

  it('EVM-006 AC3: diff.noprefix or diff.mnemonicPrefix in the git config does not hide changed files', () => {
    repo.write('packages/p/src/a.ts', SOURCE_10);
    repo.commit('feat: a');
    repo.write(
      'packages/p/coverage/lcov.info',
      lcov('src/a.ts', 10, (line) => (line <= 5 ? 1 : 0)),
    );
    for (const key of ['diff.noprefix', 'diff.mnemonicPrefix']) {
      repo.git(['config', key, 'true']);
      const { status, out } = run();
      assert.equal(status, 1, `${key}: ${out}`);
      assert.match(out, /6, 7, 8, 9, 10/);
    }
  });

  it('EVM-006 AC3: an added line starting with "++ " is a changed line of its file, not a new file header', () => {
    repo.git(['checkout', '--quiet', 'main']);
    repo.write('packages/p/src/a.ts', SOURCE_10);
    repo.commit('feat: a on main');
    repo.git(['checkout', '--quiet', '-b', 'feature/EVM-999-plus']);
    // Line 2 printed by git as "+++ b/packages/p/src/other.ts", then a second hunk at line 9 of the same file.
    const lines = SOURCE_10.split('\n');
    lines[1] = '++ b/packages/p/src/other.ts';
    lines[8] = 'export const changed = 9;';
    repo.write('packages/p/src/a.ts', lines.join('\n'));
    repo.commit('feat: change a');
    repo.write(
      'packages/p/coverage/lcov.info',
      lcov('src/a.ts', 10, (line) => (line === 9 ? 0 : 1)),
    );
    const { status, out } = run();
    assert.equal(status, 1, out);
    assert.match(out, /packages\/p\/src\/a\.ts \| 1\/2 .* \| 9 \|/);
    assert.doesNotMatch(out, /other\.ts/);
  });

  it('EVM-006 AC3: a source file shown as binary (-diff in .gitattributes) → exit 2 naming the file, never "no changes"', () => {
    repo.write('.gitattributes', 'packages/p/src/*.ts -diff\n');
    repo.commit('chore: attributes');
    repo.write('packages/p/src/a.ts', SOURCE_10);
    repo.git(['add', '--all']);
    const { status, out, err } = run();
    assert.equal(status, 2, out);
    assert.match(err, /packages\/p\/src\/a\.ts/);
    assert.match(err, /binarny/);
  });

  it('EVM-006 AC3: a name with a space and a double quote (C-quoted by git) is measured — Linux file systems', (t) => {
    const path = 'packages/p/src/a "b".ts';
    try {
      repo.write(path, SOURCE_10);
    } catch {
      t.skip('the file system does not allow " in file names (Windows) — runs in CI on Linux');
      return;
    }
    repo.commit('feat: quoted name');
    repo.write(
      'packages/p/coverage/lcov.info',
      lcov('src/a "b".ts', 10, (line) => (line <= 8 ? 1 : 0)),
    );
    const { status, out } = run();
    assert.equal(status, 1, out);
    assert.ok(out.includes(path), out);
    assert.match(out, /8\/10/);
  });
});

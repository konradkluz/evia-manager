// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluate, isSourceFile } from '../lib/evaluate.mjs';

/** @param {[number, number][]} lines @param {[string, number][]} [branches] */
const cov = (lines, branches = []) => ({ lines: new Map(lines), branches: new Map(branches) });

const EXCLUDE = ['**/test/**', '**/*.test.*', '**/*.config.*', '**/dist/**'];

describe('changed-code coverage (EVM-006 AC3)', () => {
  it('EVM-006 AC3: only source files of apps, packages, services and tools count; tests, configs and docs do not', () => {
    for (const path of ['packages/tokens/src/build.ts', 'tools/x/lib/a.mjs', 'apps/web/src/App.tsx', 'services/m/src/a.cts']) {
      assert.equal(isSourceFile(path, EXCLUDE), true, path);
    }
    for (const path of [
      'packages/tokens/test/build.test.ts',
      'tools/x/test/helpers/fake.mjs',
      'packages/tokens/vitest.config.ts',
      'packages/tokens/dist/web/tokens.js',
      'docs/README.md',
      'package.json',
      '.github/workflows/ci.yml',
      'packages/tokens/README.md',
      'design/tokens/base/color.tokens.json',
    ]) {
      assert.equal(isSourceFile(path, EXCLUDE), false, path);
    }
  });

  it('EVM-006 AC3: ≥ 90% of changed lines and branches covered → passes', () => {
    const lines = /** @type {[number, number][]} */ (Array.from({ length: 10 }, (_, i) => [i + 1, i === 0 ? 0 : 1]));
    const result = evaluate({
      changed: new Map([['packages/p/src/a.ts', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]]),
      coverage: new Map([
        [
          'packages/p/src/a.ts',
          cov(lines, [
            ['2:0:0', 1],
            ['2:0:1', 1],
          ]),
        ],
      ]),
      exclude: EXCLUDE,
      readLines: () => null,
      threshold: 90,
    });
    assert.equal(result.passed, true);
    assert.equal(result.measurable, true);
    assert.deepEqual(result.lines, { total: 10, covered: 9 });
    assert.deepEqual(result.branches, { total: 2, covered: 2 });
    assert.deepEqual(result.files[0]?.uncovered, [1]);
  });

  it('EVM-006 AC3: < 90% of changed lines covered → fails and lists uncovered lines', () => {
    const result = evaluate({
      changed: new Map([['tools/t/lib/a.mjs', [1, 2, 3]]]),
      coverage: new Map([
        [
          'tools/t/lib/a.mjs',
          cov([
            [1, 1],
            [2, 0],
            [3, 0],
            [4, 0],
          ]),
        ],
      ]),
      exclude: EXCLUDE,
      readLines: () => null,
      threshold: 90,
    });
    assert.equal(result.passed, false);
    assert.deepEqual(result.lines, { total: 3, covered: 1 });
    assert.deepEqual(result.files[0]?.uncovered, [2, 3]);
  });

  it('EVM-006 AC3: branches below the threshold fail even when every line is covered', () => {
    const result = evaluate({
      changed: new Map([['packages/p/src/a.ts', [5]]]),
      coverage: new Map([
        [
          'packages/p/src/a.ts',
          cov(
            [[5, 3]],
            [
              ['5:0:0', 2],
              ['5:0:1', 0],
              ['9:1:0', 0],
            ],
          ),
        ],
      ]),
      exclude: EXCLUDE,
      readLines: () => null,
      threshold: 90,
    });
    assert.equal(result.passed, false);
    assert.deepEqual(result.lines, { total: 1, covered: 1 });
    assert.deepEqual(result.branches, { total: 2, covered: 1 });
    assert.deepEqual(result.files[0]?.uncoveredBranches, [5]);
  });

  it('EVM-006 AC3: a changed source file without any coverage report counts as uncovered (non-blank changed lines)', () => {
    const result = evaluate({
      changed: new Map([['packages/p/src/new.ts', [1, 2, 3]]]),
      coverage: new Map(),
      exclude: EXCLUDE,
      readLines: (path) => (path === 'packages/p/src/new.ts' ? ['export const a = 1;', '', 'export const b = 2;'] : null),
      threshold: 90,
    });
    assert.equal(result.passed, false);
    const [file] = result.files;
    assert.ok(file);
    assert.equal(file.reported, false);
    assert.deepEqual(result.lines, { total: 2, covered: 0 });
    assert.deepEqual(file.uncovered, [1, 3]);
  });

  it('EVM-006 AC3: a missing file without a report counts every changed line (fail closed)', () => {
    const result = evaluate({
      changed: new Map([['packages/p/src/gone.ts', [7, 8]]]),
      coverage: new Map(),
      exclude: EXCLUDE,
      readLines: () => null,
      threshold: 90,
    });
    assert.deepEqual(result.lines, { total: 2, covered: 0 });
  });

  it('EVM-006 AC3: no measurable change (docs, tests, comments only) → passes with measurable = false', () => {
    const result = evaluate({
      changed: new Map([
        ['docs/README.md', [1]],
        ['packages/p/test/a.test.ts', [1]],
        ['packages/p/src/a.ts', [2]],
      ]),
      coverage: new Map([['packages/p/src/a.ts', cov([[1, 1]])]]),
      exclude: EXCLUDE,
      readLines: () => null,
      threshold: 90,
    });
    assert.equal(result.measurable, false);
    assert.equal(result.passed, true);
    assert.deepEqual(result.files, []);
  });
});

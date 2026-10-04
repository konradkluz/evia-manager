// @ts-check
/**
 * Polish characters and spaces in file names through the real git pipeline (`git diff`, `git ls-files --others`)
 * and Windows-style lcov paths (EVM-006 AC3; QA round 2 — docs/process/testing-strategy.md, edge cases).
 * Synthetic content only.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { main } from '../lib/main.mjs';
import { capture, tempRepo } from './helpers/repo.mjs';

const EXCLUSIONS = JSON.stringify({ exclude: [{ pattern: '**/test/**', reason: 'tests' }] });
const SOURCE_10 = Array.from({ length: 10 }, (_, i) => `export const v${String(i)} = ${String(i)};`).join('\n') + '\n';

/**
 * @param {string} source
 * @param {number} n
 * @param {(line: number) => number} hits
 */
const lcov = (source, n, hits) =>
  ['TN:', `SF:${source}`, ...Array.from({ length: n }, (_, i) => `DA:${String(i + 1)},${String(hits(i + 1))}`), 'end_of_record', ''].join(
    '\n',
  );

/** @type {ReturnType<typeof tempRepo>} */
let repo;

function run() {
  const out = capture();
  const err = capture();
  const status = main([], { cwd: repo.root, stdout: out.stream, stderr: err.stream });
  return { status, out: out.text, err: err.text };
}

describe('diff-coverage with Polish file names (EVM-006 AC3, QA)', () => {
  beforeEach(() => {
    repo = tempRepo('evm006-diffcov-pl-');
    repo.write('packages/config/coverage-exclusions.json', EXCLUSIONS);
    repo.write('README.md', '# synthetic\n');
    repo.commit('chore: base');
    repo.git(['checkout', '--quiet', '-b', 'feature/EVM-999-zazolc']);
  });
  afterEach(() => {
    repo.dispose();
  });

  it('EVM-006 AC3: a committed file named with ąćęłńóśźż and a space is matched to its Windows lcov path and listed', () => {
    const path = 'packages/zespół/src/zażółć gęślą jaźń.ts';
    repo.write(path, SOURCE_10);
    repo.commit('feat: polish name');
    repo.write(
      'packages/zespół/coverage/lcov.info',
      lcov('src\\zażółć gęślą jaźń.ts', 10, (line) => (line <= 8 ? 1 : 0)),
    );
    const { status, out } = run();
    assert.equal(status, 1, out);
    assert.ok(out.includes(path), out);
    assert.match(out, /8\/10/);
    assert.match(out, /9, 10/);
    assert.match(out, /CZERWONY/);
  });

  it('EVM-006 AC3: the same file fully covered is green — the Polish path is not counted as "no report"', () => {
    const path = 'packages/zespół/src/łódź.ts';
    repo.write(path, SOURCE_10);
    repo.commit('feat: polish name');
    repo.write(
      'packages/zespół/coverage/lcov.info',
      lcov('src/łódź.ts', 10, () => 1),
    );
    const { status, out } = run();
    assert.equal(status, 0, out);
    assert.ok(out.includes(path), out);
    assert.doesNotMatch(out, /brak raportu/);
  });

  it('EVM-006 AC3: an untracked file with a Polish name and no report counts as uncovered (no "uninstrumented = green")', () => {
    repo.write('tools/narzędzie/lib/źródło.mjs', 'export const x = 1;\nexport const y = 2;\n');
    const { status, out } = run();
    assert.equal(status, 1, out);
    assert.ok(out.includes('tools/narzędzie/lib/źródło.mjs'), out);
    assert.match(out, /brak raportu/);
  });
});

// @ts-check
/**
 * The developer's git configuration and environment must never turn uncovered changed lines green
 * (EVM-006 AC3; QA round 3). Options that add context lines to the -U0 patch (diff.interHunkContext, GIT_DIFF_OPTS)
 * would count covered, unchanged lines as changed and dilute the result above 90% — they may only make the gate red,
 * never green. Synthetic content only.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { main } from '../lib/main.mjs';
import { capture, tempRepo } from './helpers/repo.mjs';

const EXCLUSIONS = JSON.stringify({ exclude: [{ pattern: '**/test/**', reason: 'tests' }] });
const PATH = 'packages/p/src/a.ts';
const LINES = 30;
/** 1-based numbers of the changed (and uncovered) lines — far apart, so -U0 prints two hunks. */
const CHANGED_LINES = [2, 25];
const SOURCE = Array.from({ length: LINES }, (_, i) => `export const v${String(i)} = ${String(i)};`).join('\n') + '\n';
const CHANGED = SOURCE.split('\n')
  .map((line, index) => (CHANGED_LINES.includes(index + 1) ? `${line} // changed` : line))
  .join('\n');
/**
 * Every line hit except the two changed ones: changed-code coverage 0/2. Read with 22 or 28 covered context lines
 * as "changed", the same report would pass the 90% threshold (22/24, 28/30) — a false green.
 */
const LCOV = [
  'TN:',
  'SF:src/a.ts',
  ...Array.from({ length: LINES }, (_, i) => `DA:${String(i + 1)},${CHANGED_LINES.includes(i + 1) ? '0' : '1'}`),
  'end_of_record',
  '',
].join('\n');

/** @type {ReturnType<typeof tempRepo>} */
let repo;

function run() {
  const out = capture();
  const err = capture();
  const status = main([], { cwd: repo.root, stdout: out.stream, stderr: err.stream });
  return { status, out: out.text, err: err.text };
}

/** @param {{ status: number, out: string, err: string }} result @param {string} label */
function assertNeverGreen({ status, out, err }, label) {
  assert.notEqual(status, 0, `${label}: ${out}${err}`);
  assert.doesNotMatch(out, /ZIELONY|Brak mierzalnych zmian/, label);
  assert.ok(`${out}${err}`.includes(PATH), `${label}: the changed file must be named — ${out}${err}`);
}

describe('diff-coverage under hostile git configuration (EVM-006 AC3, QA round 3)', () => {
  beforeEach(() => {
    repo = tempRepo('evm006-diffcov-cfg-');
    repo.write('packages/config/coverage-exclusions.json', EXCLUSIONS);
    repo.write(PATH, SOURCE);
    repo.commit('chore: base');
    repo.git(['checkout', '--quiet', '-b', 'feature/EVM-999-config']);
    repo.write(PATH, CHANGED);
    repo.commit('feat: change two lines');
    repo.write('packages/p/coverage/lcov.info', LCOV);
  });
  afterEach(() => {
    repo.dispose();
  });

  it('EVM-006 AC3: control — without extra configuration both uncovered changed lines are listed (exit 1)', () => {
    const { status, out } = run();
    assert.equal(status, 1, out);
    assert.match(out, /packages\/p\/src\/a\.ts \| 0\/2 .* \| 2, 25 /);
  });

  it('EVM-006 AC3: diff.context in the git config is overridden by -U0 — the same two lines are listed', () => {
    repo.git(['config', 'diff.context', '30']);
    const { status, out } = run();
    assert.equal(status, 1, out);
    assert.match(out, /packages\/p\/src\/a\.ts \| 0\/2 .* \| 2, 25 /);
  });

  it('EVM-006 AC3: diff.interHunkContext (fused hunks with context lines) never turns uncovered changed lines green', () => {
    repo.git(['config', 'diff.interHunkContext', '30']);
    assertNeverGreen(run(), 'diff.interHunkContext=30');
  });

  it('EVM-006 AC3: GIT_DIFF_OPTS=--unified=30 in the environment never turns uncovered changed lines green', () => {
    const previous = process.env['GIT_DIFF_OPTS'];
    process.env['GIT_DIFF_OPTS'] = '--unified=30';
    try {
      assertNeverGreen(run(), 'GIT_DIFF_OPTS=--unified=30');
    } finally {
      if (previous === undefined) delete process.env['GIT_DIFF_OPTS'];
      else process.env['GIT_DIFF_OPTS'] = previous;
    }
  });
});

// @ts-check
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { main, readContainerOnly } from '../lib/main.mjs';
import { capture, tempRepo } from './helpers/repo.mjs';

const EXCLUSIONS = JSON.stringify({ exclude: [{ pattern: '**/test/**', reason: 'tests' }] });

/**
 * @param {string} source
 * @param {number} n
 * @param {(line: number) => number} hits
 */
const lcov = (source, n, hits) =>
  ['TN:', `SF:${source}`, ...Array.from({ length: n }, (_, i) => `DA:${i + 1},${hits(i + 1)}`), 'end_of_record', ''].join('\n');

const SOURCE_10 = Array.from({ length: 10 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';

const API_CONFIG = [
  '// synthetic list of database-bound files (apps/api/coverage.config.ts)',
  'export const DATABASE_BOUND: readonly string[] = [',
  "  // a comment with an apostrophe: the register's rows",
  "  'src/modules/work/application/**/*.ts',",
  "  'src/modules/work/http/work.controller.ts',",
  '];',
  '',
].join('\n');

const USE_CASE = 'apps/api/src/modules/work/application/use-case.ts';
const CONTAINER_REPORT = 'coverage/backend-tests/apps/api/coverage/lcov.info';

/** @type {ReturnType<typeof tempRepo>} */
let repo;

/** @param {string[]} [args] */
function run(args = []) {
  const out = capture();
  const err = capture();
  const status = main(args, { cwd: repo.root, stdout: out.stream, stderr: err.stream });
  return { status, out: out.text, err: err.text };
}

describe('diff-coverage --local: database-bound API code is measured only by the integration run (decision 2026-11-12)', () => {
  beforeEach(() => {
    repo = tempRepo('evm085-diffcov-local-');
    repo.write('packages/config/coverage-exclusions.json', EXCLUSIONS);
    repo.write('apps/api/coverage.config.ts', API_CONFIG);
    repo.write('README.md', '# synthetic\n');
    repo.commit('chore: base');
    repo.git(['checkout', '--quiet', '-b', 'feature/EVM-999-x']);
  });
  afterEach(() => {
    repo.dispose();
  });

  it('EVM-085 AC9: a database-bound file without a report is skipped locally (listed), while the CI mode still fails it', () => {
    repo.write(USE_CASE, SOURCE_10);
    repo.write('apps/api/src/modules/work/http/work.controller.ts', SOURCE_10);
    repo.commit('feat: use case');
    const local = run(['--local']);
    assert.equal(local.status, 0, local.out);
    assert.match(local.out, /Pominięte lokalnie \(2\)/);
    assert.match(local.out, /apps\/api\/src\/modules\/work\/application\/use-case\.ts/);
    assert.match(local.out, /apps\/api\/src\/modules\/work\/http\/work\.controller\.ts/);
    assert.match(local.out, /backend-integration/);
    const ci = run();
    assert.equal(ci.status, 1, ci.out);
    assert.match(ci.out, /brak raportu/);
    assert.doesNotMatch(ci.out, /Pominięte lokalnie/);
  });

  it('EVM-085 AC9: a file that is not database-bound is never skipped, also in the same workspace', () => {
    repo.write('apps/api/src/modules/work/domain/rule.ts', SOURCE_10);
    repo.commit('feat: rule');
    const { status, out } = run(['--local']);
    assert.equal(status, 1, out);
    assert.match(out, /brak raportu/);
    assert.doesNotMatch(out, /Pominięte lokalnie/);
  });

  it('EVM-085 AC9: a database-bound file outside apps/api is never skipped', () => {
    repo.write('packages/p/src/modules/work/application/use-case.ts', SOURCE_10);
    repo.commit('feat: use case in a package');
    const { status, out } = run(['--local']);
    assert.equal(status, 1, out);
    assert.doesNotMatch(out, /Pominięte lokalnie/);
  });

  it('EVM-085 AC9: a database-bound file with a report (from the container run) is measured as usual', () => {
    repo.write(USE_CASE, SOURCE_10);
    repo.commit('feat: use case');
    repo.write(
      CONTAINER_REPORT,
      lcov('src/modules/work/application/use-case.ts', 10, (line) => (line <= 5 ? 1 : 0)),
    );
    const red = run(['--local']);
    assert.equal(red.status, 1, red.out);
    assert.match(red.out, /6, 7, 8, 9, 10/);
    assert.doesNotMatch(red.out, /Pominięte lokalnie/);
    repo.write(
      CONTAINER_REPORT,
      lcov('src/modules/work/application/use-case.ts', 10, () => 1),
    );
    const green = run(['--local']);
    assert.equal(green.status, 0, green.out);
    assert.doesNotMatch(green.out, /Pominięte lokalnie/);
  });

  it('EVM-085 AC9: skipped files do not hide a failing measured file and are still listed', () => {
    repo.write(USE_CASE, SOURCE_10);
    repo.write('packages/p/src/a.ts', SOURCE_10);
    repo.commit('feat: both');
    repo.write(
      'packages/p/coverage/lcov.info',
      lcov('src/a.ts', 10, () => 0),
    );
    const { status, out } = run(['--local']);
    assert.equal(status, 1, out);
    assert.match(out, /CZERWONY/);
    assert.match(out, /Pominięte lokalnie \(1\)/);
  });

  it('EVM-085 AC9: only skipped files changed → green with the list (not the "no measurable changes" message)', () => {
    repo.write(USE_CASE, SOURCE_10);
    repo.commit('feat: use case');
    const { status, out } = run(['--local']);
    assert.equal(status, 0, out);
    assert.match(out, /Pominięte lokalnie \(1\)/);
    assert.doesNotMatch(out, /Brak mierzalnych zmian/);
  });

  it('EVM-085 AC9: an unreadable or empty list of database-bound files → exit 2 (fail closed), never a silent skip', () => {
    repo.write('apps/api/coverage.config.ts', 'export const OTHER = 1;\n');
    repo.commit('chore: break the config');
    const broken = run(['--local']);
    assert.equal(broken.status, 2);
    assert.match(broken.err, /DATABASE_BOUND/);
    repo.git(['rm', '--quiet', '-f', 'apps/api/coverage.config.ts']);
    repo.commit('chore: remove the config');
    const missing = run(['--local']);
    assert.equal(missing.status, 2);
    assert.match(missing.err, /DATABASE_BOUND/);
    assert.equal(run().status, 0, 'the CI mode does not read the list');
  });

  it('EVM-085 AC9: --local is accepted only alone', () => {
    assert.equal(run(['--local', 'clean']).status, 2);
    assert.equal(run(['--local', '--local']).status, 2);
  });
});

describe('diff-coverage --local reads the real list of the repository (EVM-085 AC9)', () => {
  it('EVM-085 AC9: apps/api/coverage.config.ts yields the globs of the database-bound files, prefixed with apps/api/', () => {
    const root = fileURLToPath(new URL('../../..', import.meta.url));
    const patterns = readContainerOnly(root);
    assert.ok(patterns.length > 10);
    assert.ok(patterns.includes('apps/api/src/modules/identity/application/**/*.ts'));
    for (const pattern of patterns) assert.match(pattern, /^apps\/api\/(src|dev)\/.+\.ts$/);
  });
});

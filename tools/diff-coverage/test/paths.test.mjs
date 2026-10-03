// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeSource, workspaceOfReport } from '../lib/paths.mjs';

describe('report paths (EVM-006 AC3)', () => {
  it('EVM-006 AC3: the workspace of a report is the directory above coverage/, also for container reports', () => {
    assert.equal(workspaceOfReport('packages/tokens/coverage/lcov.info'), 'packages/tokens');
    assert.equal(workspaceOfReport('coverage/backend-tests/packages/tokens/coverage/lcov.info'), 'packages/tokens');
    assert.equal(workspaceOfReport('tools/diff-coverage/coverage/lcov.info'), 'tools/diff-coverage');
  });

  it('EVM-006 AC3: relative SF paths (Vitest, node:test) resolve against the workspace — Windows and Linux separators', () => {
    const ctx = { root: 'C:/Users/k/evia-manager', workspace: 'packages/tokens' };
    assert.equal(normalizeSource('src\\build.ts', ctx), 'packages/tokens/src/build.ts');
    assert.equal(normalizeSource('src/build.ts', ctx), 'packages/tokens/src/build.ts');
    assert.equal(normalizeSource('./lib/../lib/a.mjs', ctx), 'packages/tokens/lib/a.mjs');
  });

  it('EVM-006 AC3: absolute paths from Windows, the container and the CI runner map to repository paths', () => {
    const ctx = { root: 'C:/Users/k/evia-manager', workspace: 'tools/x' };
    assert.equal(normalizeSource('C:\\Users\\k\\evia-manager\\tools\\x\\lib\\a.mjs', ctx), 'tools/x/lib/a.mjs');
    assert.equal(normalizeSource('c:\\users\\k\\evia-manager\\tools\\x\\lib\\a.mjs', ctx), 'tools/x/lib/a.mjs');
    assert.equal(
      normalizeSource('/work/repo/packages/tokens/src/a.ts', { root: '/r', workspace: 'packages/tokens' }),
      'packages/tokens/src/a.ts',
    );
    assert.equal(
      normalizeSource('/home/runner/work/evia-manager/evia-manager/tools/x/cli.mjs', { root: '/elsewhere', workspace: 'tools/x' }),
      'tools/x/cli.mjs',
    );
  });

  it('EVM-006 AC3: an absolute path outside the repository stays unmatched (never counted as coverage of a changed file)', () => {
    assert.equal(normalizeSource('/usr/lib/node/x.js', { root: '/repo', workspace: 'tools/x' }), null);
  });
});

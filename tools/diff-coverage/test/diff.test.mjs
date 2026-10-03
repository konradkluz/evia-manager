// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseUnifiedDiff } from '../lib/diff.mjs';

describe('git diff -U0 (EVM-006 AC3)', () => {
  it('EVM-006 AC3: collects added and changed lines of the new version per file', () => {
    const diff = [
      'diff --git a/packages/x/src/a.ts b/packages/x/src/a.ts',
      'index 1..2 100644',
      '--- a/packages/x/src/a.ts',
      '+++ b/packages/x/src/a.ts',
      '@@ -3,0 +4,2 @@ function f() {',
      '+  one();',
      '+  two();',
      '@@ -10 +12 @@',
      '-old',
      '+new',
      '@@ -20,2 +22,0 @@',
      '-gone',
      '-gone',
      'diff --git a/tools/t/new.mjs b/tools/t/new.mjs',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/tools/t/new.mjs',
      '@@ -0,0 +1,3 @@',
      '+a',
      '+b',
      '+c',
      'diff --git a/old.ts b/old.ts',
      'deleted file mode 100644',
      '--- a/old.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-x',
      'diff --git a/img.png b/img.png',
      'Binary files a/img.png and b/img.png differ',
      '',
    ].join('\n');
    const changed = parseUnifiedDiff(diff);
    assert.deepEqual([...changed.keys()], ['packages/x/src/a.ts', 'tools/t/new.mjs']);
    assert.deepEqual([...(changed.get('packages/x/src/a.ts') ?? [])], [4, 5, 12]);
    assert.deepEqual([...(changed.get('tools/t/new.mjs') ?? [])], [1, 2, 3]);
  });

  it('EVM-006 AC3: a renamed file is reported under its new path; paths with spaces and Polish characters stay intact', () => {
    const diff = [
      'diff --git a/a/old name.ts b/a/zażółć.ts',
      'similarity index 90%',
      'rename from a/old name.ts',
      'rename to a/zażółć.ts',
      '--- a/a/old name.ts',
      '+++ b/a/zażółć.ts',
      '@@ -1 +1 @@',
      '-x',
      '+y',
      '',
    ].join('\r\n');
    assert.deepEqual(
      [...parseUnifiedDiff(diff).entries()].map(([k, v]) => [k, [...v]]),
      [['a/zażółć.ts', [1]]],
    );
  });
});

// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { headerPath, parseNumstat, parseUnifiedDiff, unaccounted } from '../lib/diff.mjs';

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

describe('git diff headers and the --numstat cross-check (EVM-006 AC3; QA and code review, round 2)', () => {
  /** @param {string[]} lines */
  const entries = (lines) => [...parseUnifiedDiff(lines.join('\n')).entries()].map(([k, v]) => [k, [...v]]);

  it('EVM-006 AC3: git appends a TAB to a "+++ b/…" header when the name has a space — the path is read without it', () => {
    assert.deepEqual(
      entries([
        'diff --git a/packages/x/src/a b.ts b/packages/x/src/a b.ts',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/packages/x/src/a b.ts\t',
        '@@ -0,0 +1,2 @@',
        '+one',
        '+two',
      ]),
      [['packages/x/src/a b.ts', [1, 2]]],
    );
  });

  it('EVM-006 AC3: C-quoted names (", backslash, control characters, octal UTF-8 bytes) are unquoted, with or without the TAB', () => {
    // Header text exactly as git prints it — String.raw keeps every backslash of git's C quoting.
    assert.equal(headerPath(String.raw`"b/packages/x/src/q\"x\\y\tz.ts"`), 'packages/x/src/q"x\\y\tz.ts');
    assert.equal(headerPath(`${String.raw`"b/packages/x/src/a \"b.ts"`}\t`), 'packages/x/src/a "b.ts');
    assert.equal(headerPath(String.raw`"b/packages/x/src/\303\263\a\b\n\v\f\r.ts"`), 'packages/x/src/ó\u0007\b\n\v\f\r.ts');
    assert.equal(headerPath(String.raw`"b/packages/x/src/żółw\001.ts"`), 'packages/x/src/żółw\u0001.ts');
  });

  it('EVM-006 AC3: /dev/null, another prefix and malformed quoting give no path (the cross-check then fails closed)', () => {
    assert.equal(headerPath('/dev/null'), null);
    assert.equal(headerPath('w/packages/x/src/a.ts'), null);
    assert.equal(headerPath('"b/packages/x/src/a.ts'), null);
    assert.equal(headerPath(String.raw`"b/packages/x/src/\q.ts"`), null);
    assert.equal(headerPath(String.raw`"b/packages/x/src/\777.ts"`), null);
  });

  it('EVM-006 AC3: hunk content is never read as a header — an added line "++ b/…" stays a changed line of its own file', () => {
    assert.deepEqual(
      entries([
        'diff --git a/packages/x/src/a.ts b/packages/x/src/a.ts',
        '--- a/packages/x/src/a.ts',
        '+++ b/packages/x/src/a.ts',
        '@@ -1 +1,3 @@',
        '-old',
        String.raw`\ No newline at end of file`,
        '+++ b/packages/x/src/evil.ts',
        '+diff --git a/x b/x',
        '+@@ -1 +1,9 @@',
        String.raw`\ No newline at end of file`,
        '@@ -9,0 +12 @@',
        '+last',
        'diff --git a/packages/x/src/gone.ts b/packages/x/src/gone.ts',
        'deleted file mode 100644',
        '--- a/packages/x/src/gone.ts',
        '+++ /dev/null',
        '@@ -1,2 +0,0 @@',
        '--- a/packages/x/src/fake.ts',
        '-++ b/packages/x/src/fake.ts',
        '@@ -0,0 +1 @@',
        '+not a hunk of any file',
      ]),
      [['packages/x/src/a.ts', [1, 2, 3, 12]]],
    );
  });

  it('EVM-006 AC3: --numstat -z — counts per new path, renames, binary files; an unreadable entry throws (fail closed)', () => {
    const added = parseNumstat(
      ['1\t0\tpackages/x/src/a b.ts', '3\t1\t', 'packages/x/old.ts', 'packages/x/new.ts', '-\t-\tdocs/i.png', ''].join('\0'),
    );
    assert.deepEqual(
      [...added],
      [
        ['packages/x/src/a b.ts', 1],
        ['packages/x/new.ts', 3],
        ['docs/i.png', null],
      ],
    );
    assert.equal(parseNumstat('').size, 0);
    assert.throws(() => parseNumstat('garbage\0'), SyntaxError);
    assert.throws(() => parseNumstat('3\t1\t\0packages/x/old.ts'), SyntaxError);
    assert.throws(() => parseNumstat('3\t1\t\0packages/x/old.ts\0\0'), SyntaxError);
  });

  it('EVM-006 AC3: unaccounted lists files whose added lines the patch parser missed, binary files and unknown patch paths', () => {
    const changed = new Map([
      ['packages/x/src/ok.ts', [1, 2]],
      ['packages/x/src/short.ts', [1]],
      ['packages/x/src/phantom.ts', [4]],
    ]);
    const added = new Map(
      /** @type {[string, number | null][]} */ ([
        ['packages/x/src/ok.ts', 2],
        ['packages/x/src/short.ts', 2],
        ['packages/x/src/a b.ts\t', 0],
        ['packages/x/src/missed.ts', 1],
        ['packages/x/src/binary.ts', null],
      ]),
    );
    assert.deepEqual(unaccounted(changed, added), [
      'packages/x/src/binary.ts',
      'packages/x/src/missed.ts',
      'packages/x/src/phantom.ts',
      'packages/x/src/short.ts',
    ]);
    assert.deepEqual(unaccounted(new Map([['a.ts', [1]]]), new Map([['a.ts', 1]])), []);
  });
});

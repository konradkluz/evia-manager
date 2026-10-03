// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ToolError } from '../lib/errors.mjs';
import { compilePattern, matchPattern } from '../lib/patterns.mjs';

/**
 * @param {string} pattern
 * @param {string} path
 */
const match = (pattern, path) => matchPattern(compilePattern(pattern), path);

describe('wzorce lokalizacji (EVM-012)', () => {
  it('EVM-012 AC2: dokładna ścieżka pasuje tylko do siebie, z rozróżnieniem wielkości liter', () => {
    assert.deepEqual(match('docs/README.md', 'docs/README.md'), {});
    assert.equal(match('docs/README.md', 'docs/readme.md'), null);
    assert.equal(match('docs/README.md', 'docs/README.mdx'), null);
    assert.equal(match('docs/README.md', 'xdocs/README.md'), null);
  });

  it('EVM-012 AC2: kropka i inne znaki specjalne są literałami, nie wyrażeniem regularnym', () => {
    assert.deepEqual(match('.claude/x.md', '.claude/x.md'), {});
    assert.equal(match('.claude/x.md', 'aclaude/x.md'), null);
    assert.equal(match('docs/a+b(1).md', 'docs/aab(1).md'), null);
    assert.deepEqual(match('docs/a+b(1).md', 'docs/a+b(1).md'), {});
  });

  it('EVM-012 AC2: * dopasowuje znaki w obrębie jednego segmentu, także polskie', () => {
    assert.deepEqual(match('docs/*.md', 'docs/notatka-łódź.md'), {});
    assert.equal(match('docs/*.md', 'docs/notes/a.md'), null);
    assert.deepEqual(match('spikes/*.md', 'spikes/.md'), {});
  });

  it('EVM-012 AC2: ** w środku to dowolna liczba segmentów, także zero', () => {
    assert.deepEqual(match('.claude/**/*.md', '.claude/CLAUDE.md'), {});
    assert.deepEqual(match('.claude/**/*.md', '.claude/skills/milestone/SKILL.md'), {});
    assert.equal(match('.claude/**/*.md', '.claude/settings.json'), null);
    assert.deepEqual(match('**/README.md', 'README.md'), {});
    assert.deepEqual(match('**/README.md', 'a/b/README.md'), {});
  });

  it('EVM-012 AC2: ** na końcu to co najmniej jeden segment (wszystko poniżej katalogu)', () => {
    assert.deepEqual(match('.scratch/**', '.scratch/a.md'), {});
    assert.deepEqual(match('.scratch/**', '.scratch/EVM-012/wynik.txt'), {});
    assert.equal(match('.scratch/**', '.scratch'), null);
    assert.equal(match('.scratch/**', 'docs/.scratch/a.md'), null);
  });

  it('EVM-012 AC2: symbole <M#>, <EVM-ID>, <NNNN>, <nazwa> zwracają przechwycone wartości', () => {
    assert.deepEqual(match('docs/backlog/<M#>/<EVM-ID>-*.md', 'docs/backlog/M0/EVM-012-cykl.md'), {
      milestone: 'M0',
      evmId: 'EVM-012',
    });
    assert.deepEqual(match('docs/architecture/adr/<NNNN>-*.md', 'docs/architecture/adr/0012-ci.md'), { number: '0012' });
    assert.deepEqual(match('spikes/<nazwa>/**/*.md', 'spikes/upload-w-tle/README.md'), { name: 'upload-w-tle' });
    assert.deepEqual(match('docs/backlog/<M#>/README.md', 'docs/backlog/M12/README.md'), { milestone: 'M12' });
  });

  it('EVM-012 AC3: symbole wymagają poprawnego formatu (M + cyfry, EVM- + min. 3 cyfry, 4 cyfry)', () => {
    assert.equal(match('docs/backlog/<M#>/README.md', 'docs/backlog/m0/README.md'), null);
    assert.equal(match('docs/backlog/<M#>/README.md', 'docs/backlog/M/README.md'), null);
    assert.equal(match('docs/qa/<EVM-ID>/**/*.md', 'docs/qa/EVM-12/a.md'), null);
    assert.equal(match('docs/architecture/adr/<NNNN>-*.md', 'docs/architecture/adr/012-x.md'), null);
    assert.equal(match('spikes/<nazwa>/**/*.md', 'spikes/README.md'), null);
  });

  it('EVM-012 AC2: skompilowany wzorzec zna listę użytych symboli', () => {
    assert.deepEqual(compilePattern('docs/qa/<EVM-ID>/**/*.md').groups, ['evmId']);
    assert.deepEqual(compilePattern('docs/backlog/<M#>/<EVM-ID>-*.md').groups, ['milestone', 'evmId']);
    assert.deepEqual(compilePattern('docs/README.md').groups, []);
    assert.equal(compilePattern('docs/README.md').source, 'docs/README.md');
  });

  it('EVM-012 AC2: niepoprawny wzorzec w konfiguracji jest błędem narzędzia', () => {
    for (const bad of ['', '/docs/a.md', 'docs/', 'docs//a.md', 'docs\\a.md', 'docs/<foo>.md', 'docs/<M#.md', 'a/<M#>/<M#>.md']) {
      assert.throws(() => compilePattern(bad), ToolError, `wzorzec: ${bad}`);
    }
  });
});

// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compareCodeUnits, escapeText, isMarkdown, quote } from '../lib/text.mjs';

describe('pomocnicze funkcje tekstowe (EVM-012, ustalenie I)', () => {
  it('EVM-012 AC3: sortowanie po jednostkach kodu, niezależne od ICU i ustawień regionalnych', () => {
    assert.deepEqual(['ź.md', 'z.md', 'Z.md', 'ą.md', 'a.md'].sort(compareCodeUnits), ['Z.md', 'a.md', 'z.md', 'ą.md', 'ź.md']);
    assert.equal(compareCodeUnits('a', 'a'), 0);
  });

  it('EVM-012 AC3: plik Markdown = rozszerzenie .md w dowolnej wielkości liter', () => {
    assert.equal(isMarkdown('docs/a.md'), true);
    assert.equal(isMarkdown('docs/A.MD'), true);
    assert.equal(isMarkdown('docs/a.mdx'), false);
    assert.equal(isMarkdown('docs/md'), false);
  });

  it('EVM-012 AC3: znaki sterujące i niewidoczne znaki formatujące są escapowane, polskie znaki nie', () => {
    assert.equal(escapeText('docs/a\tb.md'), 'docs/a\\u{9}b.md');
    assert.equal(escapeText('docs/‮dm.txt'), 'docs/\\u{202E}dm.txt');
    assert.equal(escapeText('a b\u0000c'), 'a\\u{2028}b\\u{0}c');
    assert.equal(escapeText('docs/notatka-łódź.md'), 'docs/notatka-łódź.md');
  });

  it('EVM-012 AC3: wartość z dokumentu w cudzysłowie, skrócona do limitu znaków (bez dzielenia znaków)', () => {
    assert.equal(quote('M1'), '„M1”');
    assert.equal(quote('ąęśćźżółń', 3), '„ąęś…”');
    assert.equal(quote('😀😀😀', 2), '„😀😀…”');
    assert.equal(quote('abc', 3), '„abc”');
  });
});

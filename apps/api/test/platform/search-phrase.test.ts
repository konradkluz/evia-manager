import { describe, expect, it } from 'vitest';
import { Collector } from '../../src/platform/input/field-issues.ts';
import { normalizeSearchPhrase } from '../../src/platform/input/search-phrase.ts';

describe('the phrase of a search (EVM-021 AC1; SR-API-04, SR-INPUT-03, SR-INPUT-05)', () => {
  it('EVM-021 AC1 NFC once, white space collapsed, trimmed: "testowa 7" and " Łódź" stay readable', () => {
    expect(normalizeSearchPhrase('  testowa \t 7 ')).toEqual({ ok: true, phrase: 'testowa 7' });
    expect(normalizeSearchPhrase('Lodź')).toEqual({ ok: true, phrase: 'Lodź' });
  });

  it('EVM-021 AC1 3 to 100 characters (counted as characters, not code units)', () => {
    expect(normalizeSearchPhrase('abc')).toEqual({ ok: true, phrase: 'abc' });
    expect(normalizeSearchPhrase('x'.repeat(100))).toMatchObject({ ok: true });
    expect(normalizeSearchPhrase('😀😀😀')).toMatchObject({ ok: true });
    for (const phrase of ['', '  ', 'ab', ' ab ', '😀😀'])
      expect(normalizeSearchPhrase(phrase), phrase).toEqual({ ok: false, errors: [{ pointer: '/query', code: 'too_short' }] });
    expect(normalizeSearchPhrase('x'.repeat(101))).toEqual({ ok: false, errors: [{ pointer: '/query', code: 'too_long' }] });
  });

  it('EVM-021 AC1 a control or invisible formatting character is refused; the error names the code, never the phrase', () => {
    // NUL, zero-width space, next line (NEL), bell — none of them is white space for `\s`, so none is collapsed away
    for (const code of [0x0000, 0x200b, 0x0085, 0x0007]) {
      const phrase = `ab${String.fromCodePoint(code)}cd`;
      expect(normalizeSearchPhrase(phrase), code.toString(16)).toEqual({
        ok: false,
        errors: [{ pointer: '/query', code: 'invalid_characters' }],
      });
    }
  });

  it('EVM-021 AC1 a line or paragraph separator is white space: it collapses into one space (same as a tab)', () => {
    expect(normalizeSearchPhrase(`ab${String.fromCodePoint(0x2028)}cd`)).toEqual({ ok: true, phrase: 'ab cd' });
  });
});

describe('the collector of field errors (EVM-021 AC5; SR-ERR-02)', () => {
  it('EVM-021 AC5 an optional shaped value: absent or empty is null, a good one is normalised, a bad one is invalid_format', () => {
    const collector = new Collector();
    const upper = (raw: string): string | undefined => (raw.startsWith('x') ? undefined : raw.toUpperCase());
    expect(collector.shaped('/a', undefined, upper)).toBeNull();
    expect(collector.shaped('/a', '   ', upper)).toBeNull();
    expect(collector.shaped('/a', 'abc', upper)).toBe('ABC');
    expect(collector.errors).toEqual([]);
    expect(collector.shaped('/b', 'xyz', upper)).toBeNull();
    expect(collector.errors).toEqual([{ pointer: '/b', code: 'invalid_format' }]);
  });
});

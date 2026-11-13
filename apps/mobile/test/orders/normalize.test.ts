import { normalizeSearch } from '../../src/orders/normalize';

describe('normalizeSearch (EVM-103 AC2)', () => {
  it('EVM-103 AC2: "lodz" and "Łódź" meet in one key; case and Polish diacritics do not matter', () => {
    expect(normalizeSearch('Łódź')).toBe('lodz');
    expect(normalizeSearch('lodz')).toBe(normalizeSearch('ŁÓDŹ'));
    expect(normalizeSearch('ŻÓŁĆ ąęśń')).toBe('zolc aesn');
    expect(normalizeSearch('Żółkiewskiego')).toBe(normalizeSearch('zolkiewskiego'));
  });

  it('EVM-103 AC2: digits, spaces and punctuation stay as they are (a fragment of a number is a literal substring)', () => {
    expect(normalizeSearch('ZL-2026-0042')).toBe('zl-2026-0042');
    expect(normalizeSearch('  a  b ')).toBe('  a  b ');
  });

  it('EVM-103 AC2: special characters and emoji never throw and stay literal', () => {
    const special = `" % _ * ( ) ' \\ [ ] ^ $ . | ? 😀`;
    expect(normalizeSearch(special)).toBe(special);
    expect(normalizeSearch('')).toBe('');
    expect(normalizeSearch('x'.repeat(10_000))).toHaveLength(10_000);
  });
});

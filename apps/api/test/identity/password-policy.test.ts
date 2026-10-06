import { describe, expect, it } from 'vitest';
import { COMMON_PASSWORDS } from '../../src/modules/identity/domain/common-passwords.ts';
import {
  checkPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type PasswordContext,
} from '../../src/modules/identity/domain/password-policy.ts';

const context: PasswordContext = {
  email: 'jan.przykladowy@evia.invalid',
  displayName: 'Konrad Kłuż',
  now: new Date('2026-10-06T08:00:00Z'),
};

const check = (password: string, overrides: Partial<PasswordContext> = {}) => checkPassword(password, { ...context, ...overrides });

describe('password policy P2 — length (EVM-016 AC3; SR-AUTH-01, ASVS V6.2.1, V6.2.9)', () => {
  it('EVM-016 AC3 the minimum is 15 and the maximum 256 characters (the maxLength of the contract)', () => {
    expect([PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH]).toEqual([15, 256]);
  });

  it('EVM-016 AC3 a password shorter than 15 characters is too_short, 15 characters pass', () => {
    expect(check('Zq9-lamp-Orbit-')).toBeNull();
    expect(check('Zq9-lamp-Orbit')).toBe('too_short');
    expect(check('')).toBe('too_short');
  });

  it('EVM-016 AC3 spaces count and nothing is trimmed: 15 characters of which some are spaces are accepted', () => {
    expect(check('lampa orbita 9x')).toBeNull();
    expect(check('  lampa orbita 9')).toBeNull();
    expect(check('lampa orbita 9 ')).toBeNull();
  });

  it('EVM-016 AC3 any Unicode character is allowed and is counted as one: 15 emoji pass, 14 do not', () => {
    expect(check('\u{1F600}'.repeat(15))).toBeNull();
    expect(check('\u{1F600}'.repeat(14))).toBe('too_short');
    expect(check('zażółć gęślą jaźń')).toBeNull();
  });

  it('EVM-016 AC3 length is counted after NFC: a 14-character password typed decomposed is still 14 characters, not 28', () => {
    const fourteen = 'ąćęłńóśźżabcdx';
    const fifteen = `${fourteen}y`;
    expect(fourteen.normalize('NFC')).toHaveLength(14);
    expect(fourteen.normalize('NFD').length).toBeGreaterThan(14);
    expect(check(fourteen.normalize('NFD'))).toBe('too_short');
    expect(check(fifteen.normalize('NFD'))).toBeNull();
    expect(check(fifteen.normalize('NFC'))).toBeNull();
  });

  it('EVM-016 AC3 256 characters pass and 257 are too_long; a 128-character password of 4-byte characters is accepted', () => {
    expect(check('Zq9-lamp-Orbit-'.padEnd(256, 'k'))).toBeNull();
    expect(check('Zq9-lamp-Orbit-'.padEnd(257, 'k'))).toBe('too_long');
    expect(check('\u{1F680}'.repeat(128))).toBeNull();
  });

  it('EVM-016 AC3 too_short is reported before weakness', () => {
    expect(check('evia')).toBe('too_short');
    expect(check('eviacharge2026')).toBe('too_short');
  });
});

describe('password policy P2 — context words and the common-password list (EVM-016 AC3; SR-AUTH-02, ASVS V6.2.4)', () => {
  it('EVM-016 AC3 "EviaCharge2026!" has 15 characters, so the context rule (not the length rule) rejects it', () => {
    expect('EviaCharge2026!'.length).toBe(15);
    expect(check('EviaCharge2026!')).toBe('too_weak');
  });

  it.each(['evia', 'eviacharge', 'evia charge', 'charge', 'wallbox', 'ładowarka', 'ladowarka', 'garaż', 'garaz', 'manager'])(
    'EVM-016 AC3 the context word %j makes a password weak, in any case, with spaces or special characters between letters',
    (word) => {
      const variants = [word, word.toUpperCase(), ` ${word} `, word.split('').join('-'), `${word}.${word}`];
      for (const variant of variants) {
        expect(check(`Zq9-orbit-${variant}-k7`.padEnd(15, 'k')), variant).toBe('too_weak');
      }
    },
  );

  it('EVM-016 AC3 look-alike characters do not hide a context word (leet: 0 o, 1 i or l, 3 e, 4 a, 5 s, @ a, $ s)', () => {
    for (const disguised of [
      '3v1a-Zq9-orbit-k',
      'Ev!a-Zq9-orbit-k'.replace('!', '1'),
      'Zq9-orbit-Ch4rg3',
      'Zq9-w4llb0x-orbit',
      'Zq9-m@n@ger-orbit',
      'Zq9-orbit-g4r@z',
    ]) {
      expect(check(disguised), disguised).toBe('too_weak');
    }
    expect(check('Zq9-orbit-ch4rg3-k')).toBe('too_weak');
    expect(check('Zq9-orbit-1mage-kx7')).toBeNull();
  });

  it('EVM-016 AC3 diacritics and compatibility forms are folded: ŁADOWARKA, ｅｖｉａ (full width) and decomposed letters are weak', () => {
    expect(check('Zq9-orbit-ŁADOWARKA')).toBe('too_weak');
    expect(check('Zq9-orbit-ｅｖｉａ-k7x')).toBe('too_weak');
    expect(check('Zq9-orbit-garaż-k')).toBe('too_weak');
    expect(check('Zq9-orbit-garaż-k7')).toBe('too_weak');
  });

  it('EVM-016 AC3 the local part and the segments of the e-mail address, and the parts of the display name, are context words', () => {
    expect(check('xx-jan.przykladowy-xx')).toBe('too_weak');
    expect(check('Zq9-orbit-przykladowy')).toBe('too_weak');
    expect(check('Zq9-orbit-PRZYKŁADOWY')).toBe('too_weak');
    expect(check('Zq9-orbit-konrad-k7')).toBe('too_weak');
    expect(check('Zq9-orbit-kluz-k7x')).toBe('too_weak');
    expect(check('Zq9-orbit-KŁUŻ-k7x')).toBe('too_weak');
    // fragments shorter than 4 characters are not context words ("jan" is a part of the address)
    expect(check('Zq9-orbit-jan-k7xy')).toBeNull();
  });

  it('EVM-016 AC3 the current and the previous year are context words, computed from the clock (Europe/Warsaw), not constants', () => {
    expect(check('Zq9-orbit-2026-k7x')).toBe('too_weak');
    expect(check('Zq9-orbit-2025-k7x')).toBe('too_weak');
    expect(check('Zq9-orbit-2024-k7x')).toBeNull();
    expect(check('Zq9-orbit-2027-k7x')).toBeNull();
    const ny = { now: new Date('2027-03-01T10:00:00Z') };
    expect(check('Zq9-orbit-2027-k7x', ny)).toBe('too_weak');
    expect(check('Zq9-orbit-2026-k7x', ny)).toBe('too_weak');
    expect(check('Zq9-orbit-2025-k7x', ny)).toBeNull();
    // 2026-12-31 23:30 UTC is already 2027-01-01 in Warsaw
    const boundary = { now: new Date('2026-12-31T23:30:00Z') };
    expect(check('Zq9-orbit-2027-k7x', boundary)).toBe('too_weak');
    expect(check('Zq9-orbit-2025-k7x', boundary)).toBeNull();
  });

  it('EVM-016 AC3 a password that merely looks similar to a context word but does not contain it is accepted', () => {
    for (const fine of ['Evidence-Purple-Tractor-9', 'Zq9-orbit-lamp-k7x', 'correct horse battery staple', 'Wąż-eży-łączy-pędzel-9']) {
      expect(check(fine), fine).toBeNull();
    }
  });

  it('EVM-016 AC3 the local list has at least 3000 passwords, all of at least 15 characters (so it can reject something) with a known source', () => {
    expect(COMMON_PASSWORDS.length).toBeGreaterThanOrEqual(3000);
    expect(COMMON_PASSWORDS.every((entry) => entry.length >= PASSWORD_MIN_LENGTH)).toBe(true);
    expect(new Set(COMMON_PASSWORDS).size).toBe(COMMON_PASSWORDS.length);
  });

  it('EVM-016 AC3 passwords of the local list are rejected, also with another case, spacing or punctuation', () => {
    for (const entry of COMMON_PASSWORDS.slice(0, 200)) {
      expect(check(entry), entry).toBe('too_weak');
    }
    const [first = ''] = COMMON_PASSWORDS;
    expect(check(first.toUpperCase())).toBe('too_weak');
    expect(check(first.split('').join(' '))).toBe('too_weak');
  });
});

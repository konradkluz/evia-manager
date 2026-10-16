import { describe, expect, it } from 'vitest';
import {
  newRecoveryCode,
  newRecoveryCodes,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_LENGTH,
} from '../../src/modules/identity/domain/recovery-codes.ts';
import { TOTP_CODE_PATTERN, TOTP_SECRET_BYTES, totpSecretContext } from '../../src/modules/identity/domain/totp.ts';
import { OtpauthTotpEngine } from '../../src/modules/identity/infrastructure/totp-engine.ts';

const engine = new OtpauthTotpEngine();
/** The SHA-1 test secret of RFC 6238 appendix B (the ASCII digits 1234567890 twice) — a public test vector, not a credential. */
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');
const at = (seconds: number): Date => new Date(seconds * 1000);

describe('TOTP engine (EVM-023 AC1, AC2; SR-AUTH-07, RFC 6238)', () => {
  it('EVM-023 AC2 accepts the RFC 6238 vectors at their own instant and reports the time step', () => {
    const vectors: Array<[number, string]> = [
      [59, '287082'],
      [1_111_111_109, '081804'],
      [1_111_111_111, '050471'],
      [1_234_567_890, '005924'],
      [2_000_000_000, '279037'],
      [20_000_000_000, '353130'],
    ];
    for (const [seconds, code] of vectors) expect(engine.match(RFC_SECRET, code, at(seconds)), code).toBe(Math.floor(seconds / 30));
  });

  it('EVM-023 AC2 the tolerance is one step either way: ±1 is accepted (and reported as that step), ±2 is not', () => {
    const now = 1_234_567_890; // step 41152263, code 005924
    const step = Math.floor(now / 30);
    expect(engine.match(RFC_SECRET, '005924', at(now + 30))).toBe(step);
    expect(engine.match(RFC_SECRET, '005924', at(now - 30))).toBe(step);
    expect(engine.match(RFC_SECRET, '005924', at(now + 60))).toBeNull();
    expect(engine.match(RFC_SECRET, '005924', at(now - 60))).toBeNull();
  });

  it('EVM-023 AC2 a wrong code, one of another shape and one for another secret are refused', () => {
    const other = engine.newSecret();
    expect(engine.match(RFC_SECRET, '000000', at(59))).toBeNull();
    expect(engine.match(RFC_SECRET, '28708', at(59))).toBeNull();
    expect(engine.match(RFC_SECRET, '2870820', at(59))).toBeNull();
    expect(engine.match(other, '287082', at(59))).toBeNull();
  });

  it('EVM-023 AC1 a new secret has at least 160 bits, is different every time and is offered as base32 and as an otpauth URI of the issuer and the account', () => {
    const secret = engine.newSecret();
    expect(secret).toHaveLength(TOTP_SECRET_BYTES);
    expect(TOTP_SECRET_BYTES * 8).toBeGreaterThanOrEqual(160);
    expect(engine.newSecret().equals(secret)).toBe(false);
    const base32 = engine.base32(secret);
    expect(base32).toMatch(/^[A-Z2-7]{32}$/);
    const uri = new URL(engine.uri(secret, 'edytor@evia.invalid'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/EVia Manager:edytor@evia.invalid');
    expect(uri.searchParams.get('secret')).toBe(base32);
    expect(uri.searchParams.get('issuer')).toBe('EVia Manager');
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('period')).toBe('30');
    expect(uri.searchParams.get('algorithm')).toBe('SHA1');
  });

  it('EVM-023 AC2 the code is exactly six ASCII digits; the sealed secret is bound to the account', () => {
    expect(TOTP_CODE_PATTERN.test('012345')).toBe(true);
    for (const value of ['12345', '1234567', '12345a', ' 12345', '12345\n', '１２３４５６', '+12345'])
      expect(TOTP_CODE_PATTERN.test(value), value).toBe(false);
    expect(totpSecretContext('u1')).not.toBe(totpSecretContext('u2'));
  });
});

describe('recovery codes (EVM-023 AC4, AC5; SR-AUTH-08)', () => {
  it('EVM-023 AC4 a generation is ten different codes of at least 20 characters of base32', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    expect(RECOVERY_CODE_LENGTH).toBeGreaterThanOrEqual(20);
    for (const code of codes) expect(code).toMatch(/^[A-Z2-7]{20}$/);
  });

  it('EVM-023 AC4 codes use the whole alphabet (no bias towards a part of it)', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 400; index += 1) for (const character of newRecoveryCode()) seen.add(character);
    expect(seen.size).toBe(32);
  });

  it('EVM-023 AC5 the input is normalised: case, spaces and hyphens do not matter', () => {
    const code = newRecoveryCode();
    const grouped = `${code.slice(0, 5)}-${code.slice(5, 10)} ${code.slice(10, 15).toLowerCase()}-${code.slice(15)}`;
    expect(normalizeRecoveryCode(grouped)).toBe(code);
    expect(normalizeRecoveryCode(` ${code}\n`)).toBe(code);
  });

  it('EVM-023 AC5 an input that cannot be a code is refused before any hash: wrong length, characters outside the alphabet, a folded unicode letter', () => {
    const code = newRecoveryCode();
    for (const value of ['', code.slice(1), `${code}A`, `${code.slice(1)}1`, `${code.slice(1)}0`, `${code.slice(1)}ı`, `${code.slice(1)}!`])
      expect(normalizeRecoveryCode(value), value).toBeUndefined();
  });
});

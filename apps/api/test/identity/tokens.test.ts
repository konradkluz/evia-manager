import { describe, expect, it } from 'vitest';
import { channelAllowedForRole } from '../../src/modules/identity/domain/channel-rules.ts';
import { displayNameFromEmail, normalizeEmail } from '../../src/modules/identity/domain/text.ts';
import { csrfMatches, deriveCsrfToken, hashToken, newToken, TOKEN_PATTERN } from '../../src/modules/identity/domain/tokens.ts';
import { clearedSessionCookie, readSessionCookie, sessionCookie } from '../../src/modules/identity/http/session-cookie.ts';

describe('opaque tokens (EVM-016 AC1, AC5, AC6; SR-CRYPTO-01, SR-CRYPTO-03, SR-SESS-01)', () => {
  it('EVM-016 AC1 a token is 256 random bits as 43 base64url characters and never repeats', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token).toMatch(TOKEN_PATTERN);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    }
  });

  it('EVM-016 AC1 only the SHA-256 of a token is stored: 32 bytes, deterministic, different for different tokens', () => {
    const token = 'A'.repeat(43);
    expect(hashToken(token)).toHaveLength(32);
    expect(hashToken(token).equals(hashToken(token))).toBe(true);
    expect(hashToken(token).equals(hashToken(`${'A'.repeat(42)}B`))).toBe(false);
    expect(hashToken(token).toString('base64url')).not.toContain(token);
  });

  it('EVM-016 AC6 the CSRF token is derived from the session token (no secret in the database) and rotates with the session', () => {
    const first = newToken();
    const second = newToken();
    expect(deriveCsrfToken(first)).toMatch(TOKEN_PATTERN);
    expect(deriveCsrfToken(first)).toBe(deriveCsrfToken(first));
    expect(deriveCsrfToken(first)).not.toBe(deriveCsrfToken(second));
    expect(deriveCsrfToken(first)).not.toBe(first);
    expect(deriveCsrfToken(first)).not.toBe(hashToken(first).toString('base64url'));
  });

  it('EVM-016 AC6 the CSRF comparison accepts only the exact token, of any length, and never an absent one', () => {
    const expected = deriveCsrfToken(newToken());
    expect(csrfMatches(expected, expected)).toBe(true);
    for (const provided of [undefined, '', expected.slice(1), `${expected}x`, expected.toUpperCase(), ` ${expected}`, 'x'.repeat(10_000)]) {
      expect(csrfMatches(expected, provided), String(provided).slice(0, 12)).toBe(false);
    }
  });
});

describe('session cookie (EVM-016 AC4, AC6; SR-SESS-01, ASVS V3.3.1-V3.3.3)', () => {
  const token = newToken();

  it('EVM-016 AC6 the cookie is __Host-, Secure, HttpOnly, SameSite=Strict, Path=/ and has no Domain', () => {
    const header = sessionCookie(token, 43_200);
    expect(header).toBe(`__Host-evia_session=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=43200`);
    expect(header).not.toMatch(/Domain/i);
  });

  it('EVM-016 AC6 the cleared cookie carries the same attributes with Max-Age=0', () => {
    expect(clearedSessionCookie()).toBe('__Host-evia_session=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0');
  });

  it('EVM-016 AC6 the session token is read from exactly one well-formed cookie', () => {
    expect(readSessionCookie(undefined)).toEqual({ kind: 'none' });
    expect(readSessionCookie('theme=dark')).toEqual({ kind: 'none' });
    expect(readSessionCookie(`theme=dark; __Host-evia_session=${token}; other=1`)).toEqual({ kind: 'token', token });
    expect(readSessionCookie(`__Host-evia_session=${token}`)).toEqual({ kind: 'token', token });
  });

  it('EVM-016 AC6 two cookies of that name are ambiguous (cookie tossing) and malformed values are no token', () => {
    expect(readSessionCookie(`__Host-evia_session=${token}; __Host-evia_session=${newToken()}`)).toEqual({ kind: 'ambiguous' });
    for (const value of ['', 'short', `${token}x`, `"${token}"`, `${token.slice(1)}!`, 'a b']) {
      expect(readSessionCookie(`__Host-evia_session=${value}`), value).toEqual({ kind: 'none' });
    }
    expect(readSessionCookie(`evia_session=${token}; session=${token}`)).toEqual({ kind: 'none' });
    expect(readSessionCookie(`x__Host-evia_session=${token}`)).toEqual({ kind: 'none' });
  });
});

describe('roles, channels and text of the identity module (EVM-016 AC8; SR-AUTHZ-06)', () => {
  it('EVM-016 AC8 the read-only role has no mobile channel, every role has the web channel', () => {
    for (const role of ['administrator', 'editor', 'read_only'] as const) expect(channelAllowedForRole(role, 'web'), role).toBe(true);
    expect(channelAllowedForRole('administrator', 'mobile')).toBe(true);
    expect(channelAllowedForRole('editor', 'mobile')).toBe(true);
    expect(channelAllowedForRole('read_only', 'mobile')).toBe(false);
  });

  it('EVM-016 AC1 e-mail addresses are stored in NFC, trimmed and lower case; the default display name is the local part', () => {
    expect(normalizeEmail('  Jan.Przykladowy@Example.INVALID ')).toBe('jan.przykladowy@example.invalid');
    expect(normalizeEmail('Zóła@example.invalid')).toBe('zóła@example.invalid');
    expect(normalizeEmail('Zóła@example.invalid')).toBe(normalizeEmail('Zóła@example.invalid'));
    expect(displayNameFromEmail('jan.przykladowy@example.invalid')).toBe('jan.przykladowy');
    expect(displayNameFromEmail('@example.invalid')).toBe('@example.invalid');
    expect(displayNameFromEmail(`${'x'.repeat(300)}@example.invalid`)).toHaveLength(200);
  });
});

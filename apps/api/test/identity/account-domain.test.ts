import { describe, expect, it } from 'vitest';
import { normalizeDisplayName, normalizePasskeyName } from '../../src/modules/identity/domain/account-input.ts';
import { MAX_WEB_SESSIONS } from '../../src/modules/identity/domain/constants.ts';
import {
  PASSWORD_CHANGE_ACCOUNT_VARIANT,
  SESSIONS_SETTINGS_PATH,
  isSecondStepChange,
  passwordChangedText,
  secondStepChangedText,
  sessionLimitText,
} from '../../src/modules/identity/domain/email-templates.ts';
import { canRemoveMethod } from '../../src/modules/identity/domain/second-step-rules.ts';
import { sessionsToEnd } from '../../src/modules/identity/domain/session-limit.ts';
import { describeUserAgent, UNKNOWN_BROWSER, UNKNOWN_SYSTEM } from '../../src/modules/identity/domain/user-agent.ts';

const ORIGIN = 'https://panel.evia.test';
const when = new Date('2026-10-04T12:05:00Z');

describe('the browser and the system of a session come out of a closed dictionary (EVM-028 AC6; SR-INPUT-07, SR-DATA-03)', () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Chrome',
      'Windows',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      'Edge',
      'Windows',
    ],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox', 'Windows'],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Safari',
      'macOS',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1',
      'Chrome',
      'iOS',
    ],
    [
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Safari',
      'iOS',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
      'Chrome',
      'Android',
    ],
    [
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
      'Opera',
      'Linux',
    ],
    [
      'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Chrome',
      'ChromeOS',
    ],
  ];

  it.each(cases)('EVM-028 AC6 %s', (userAgent, browser, os) => {
    expect(describeUserAgent(userAgent)).toEqual({ browser, os });
  });

  it('EVM-028 AC6 a string that matches nothing, an empty one and a missing one are "Nieznana przeglądarka" / "Nieznany system"; the version and the raw text never appear', () => {
    for (const unknown of ['curl/8.0', '', undefined, null, '<script>alert(1)</script> Chrome-ish']) {
      expect(describeUserAgent(unknown)).toEqual({ browser: UNKNOWN_BROWSER, os: UNKNOWN_SYSTEM });
    }
    const described = describeUserAgent(cases[0]?.[0]);
    expect(JSON.stringify(described)).not.toMatch(/\d|Mozilla|AppleWebKit/);
  });
});

describe('the rules of the methods of the second step (EVM-028 AC4; SR-AUTH-10, P1)', () => {
  it('EVM-028 AC4 an Administrator with one passkey cannot remove it; with two he can', () => {
    expect(canRemoveMethod('administrator', { passkeys: 1, totp: false }, 'passkey')).toEqual({ allowed: false, required: 'passkey' });
    expect(canRemoveMethod('administrator', { passkeys: 2, totp: false }, 'passkey')).toEqual({ allowed: true });
  });

  it('EVM-028 AC4 the code of the app does not count for an Administrator: a key and a code is still one method, and the code can always go', () => {
    expect(canRemoveMethod('administrator', { passkeys: 1, totp: true }, 'passkey')).toEqual({ allowed: false, required: 'passkey' });
    expect(canRemoveMethod('administrator', { passkeys: 1, totp: true }, 'totp')).toEqual({ allowed: true });
  });

  it('EVM-028 AC4 an Editor and a Read-only user keep at least one method of any kind', () => {
    for (const role of ['editor', 'read_only'] as const) {
      expect(canRemoveMethod(role, { passkeys: 1, totp: false }, 'passkey')).toEqual({ allowed: false, required: 'method' });
      expect(canRemoveMethod(role, { passkeys: 0, totp: true }, 'totp')).toEqual({ allowed: false, required: 'method' });
      expect(canRemoveMethod(role, { passkeys: 1, totp: true }, 'passkey')).toEqual({ allowed: true });
      expect(canRemoveMethod(role, { passkeys: 1, totp: true }, 'totp')).toEqual({ allowed: true });
      expect(canRemoveMethod(role, { passkeys: 2, totp: false }, 'passkey')).toEqual({ allowed: true });
    }
  });
});

describe('the limit of five sessions (EVM-028 AC6; SR-SESS-04)', () => {
  const ids = (count: number): string[] => Array.from({ length: count }, (_, index) => `s${index + 1}`);

  it('EVM-028 AC6 with fewer than five open sessions nobody is ended; with five the oldest is; with more, as many as it takes to leave room', () => {
    expect(sessionsToEnd(ids(0), MAX_WEB_SESSIONS)).toEqual([]);
    expect(sessionsToEnd(ids(4), MAX_WEB_SESSIONS)).toEqual([]);
    expect(sessionsToEnd(ids(5), MAX_WEB_SESSIONS)).toEqual(['s1']);
    expect(sessionsToEnd(ids(7), MAX_WEB_SESSIONS)).toEqual(['s1', 's2', 's3']);
  });
});

describe('the fields the owner types (EVM-028 AC1; SR-INPUT-01, SR-INPUT-07, ASVS V1.2, V1.3)', () => {
  it('EVM-028 AC1 the name is NFC and trimmed; 200 characters pass, 201 are too long; empty is required', () => {
    expect(normalizeDisplayName('  Ánna Testowa  ')).toEqual({ ok: true, value: 'Ánna Testowa' });
    expect(normalizeDisplayName('a'.repeat(200))).toMatchObject({ ok: true });
    expect(normalizeDisplayName('a'.repeat(201))).toEqual({ ok: false, errors: [{ pointer: '/displayName', code: 'too_long' }] });
    expect(normalizeDisplayName('   ')).toEqual({ ok: false, errors: [{ pointer: '/displayName', code: 'required' }] });
  });

  it('EVM-028 AC1 characters that are not text are refused: a line break, a NUL, a zero-width character, a bidi override, a line separator', () => {
    for (const bad of ['Jan\nKowalski', 'Jan\rKowalski', 'Jan\u0000K', 'Jan​K', 'Jan‮K', 'Jan K', 'Jan K', 'Jan\u0007K']) {
      expect(normalizeDisplayName(bad), JSON.stringify(bad)).toEqual({
        ok: false,
        errors: [{ pointer: '/displayName', code: 'invalid_characters' }],
      });
    }
  });

  it('EVM-028 AC3 the name of a key: absent is "Klucz dostępu"; the limit is 60; the same characters are refused, on /name', () => {
    expect(normalizePasskeyName(undefined)).toEqual({ ok: true, value: 'Klucz dostępu' });
    expect(normalizePasskeyName('  Telefon Jana ')).toEqual({ ok: true, value: 'Telefon Jana' });
    expect(normalizePasskeyName('k'.repeat(60))).toMatchObject({ ok: true });
    expect(normalizePasskeyName('k'.repeat(61))).toEqual({ ok: false, errors: [{ pointer: '/name', code: 'too_long' }] });
    expect(normalizePasskeyName('')).toEqual({ ok: false, errors: [{ pointer: '/name', code: 'required' }] });
    expect(normalizePasskeyName('Klucz‮dcba')).toEqual({ ok: false, errors: [{ pointer: '/name', code: 'invalid_characters' }] });
    expect(normalizePasskeyName('Klucz\nDruga linia')).toEqual({ ok: false, errors: [{ pointer: '/name', code: 'invalid_characters' }] });
  });
});

describe('the texts of the e-mails of the account (EVM-028 AC2, AC3, AC6; e-maile.md 4, 5, 8; SR-INPUT-07, SR-AUTH-15)', () => {
  it('EVM-028 AC2 e-mail 4 after a change in the account points to "Moje sesje" and does not say that the sessions ended; after a reset it says they did', () => {
    const fromAccount = passwordChangedText({ panelOrigin: ORIGIN, changedAt: when, source: 'account' });
    expect(PASSWORD_CHANGE_ACCOUNT_VARIANT).toBe('from_account');
    expect(fromAccount.subject).toBe('EVia Manager: hasło zostało zmienione');
    expect(fromAccount.text).toContain(`${ORIGIN}${SESSIONS_SETTINGS_PATH}`);
    expect(fromAccount.text).not.toContain('Zakończyliśmy wszystkie sesje konta.');
    expect(passwordChangedText({ panelOrigin: ORIGIN, changedAt: when }).text).toContain('Zakończyliśmy wszystkie sesje konta.');
  });

  it('EVM-028 AC3 e-mail 5 for a removed key and a removed code says what was removed — and never a name, an address, an IP or who did it', () => {
    const key = secondStepChangedText({ panelOrigin: ORIGIN, change: 'passkey_removed', changedAt: when });
    const totp = secondStepChangedText({ panelOrigin: ORIGIN, change: 'totp_removed', changedAt: when });
    expect(key.text).toContain('usunięto klucz dostępu.');
    expect(totp.text).toContain('usunięto kod z aplikacji uwierzytelniającej.');
    for (const { text } of [key, totp]) expect(text).not.toMatch(/@|\d+\.\d+\.\d+\.\d+|token/i);
    expect(isSecondStepChange('passkey_removed')).toBe(true);
    expect(isSecondStepChange('totp_removed')).toBe(true);
    expect(isSecondStepChange('made_up')).toBe(false);
  });

  it('EVM-028 AC6 e-mail 8 names the ended session and the new sign-in by browser, system and time — no IP, no raw user agent', () => {
    const { subject, text } = sessionLimitText({
      panelOrigin: ORIGIN,
      ended: { browser: 'Edge', os: 'Windows', lastSeenAt: new Date('2026-10-03T14:20:00Z') },
      signedIn: { browser: 'Firefox', os: 'Windows', at: when },
    });
    expect(subject).toBe('EVia Manager: zakończono najstarszą sesję');
    expect(text).toContain('Zakończona sesja: Edge · Windows, ostatnia aktywność 03.10.2026, 16:20');
    expect(text).toContain('Nowe logowanie: Firefox · Windows, 04.10.2026, 14:05');
    expect(text).toContain(`${ORIGIN}${SESSIONS_SETTINGS_PATH}`);
    expect(text).not.toMatch(/@|\d+\.\d+\.\d+\.\d+|Mozilla|token/i);
  });
});

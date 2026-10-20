import { describe, expect, it } from 'vitest';
import {
  ALERT_VARIANTS,
  RESET_FORM_PATH,
  accountLockedText,
  alertText,
  isLockVariant,
  lockVariant,
  newBrowserText,
} from '../../src/modules/identity/domain/email-templates.ts';
import { deviceCookie, readDeviceCookie } from '../../src/modules/identity/http/device-cookie.ts';
import { DEVICE_COOKIE_NAME } from '../../src/modules/identity/domain/constants.ts';

const ORIGIN = 'https://panel.evia.test';
const TOKEN = 'D'.repeat(43);
const LOCKED_AT = new Date('2026-10-05T07:10:00.000Z'); // 09:10 Europe/Warsaw (CEST)
const LINK = `${ORIGIN}${RESET_FORM_PATH}`;

describe('the texts of the security e-mails of the sign-in (EVM-026 AC4, AC5; docs/ux/flows/e-maile.md nr 3, 7 and 9)', () => {
  it('EVM-026 AC4 e-mail 3 of the password: the time and the length of the lock, the link to the form without a token, and that a new password lifts the lock', () => {
    const { subject, text } = accountLockedText({
      panelOrigin: ORIGIN,
      variant: 'password',
      lockedAt: LOCKED_AT,
      lockedUntil: new Date(LOCKED_AT.getTime() + 15 * 60_000),
    });
    expect(subject).toBe('EVia Manager: logowanie zablokowane na 15 minut');
    expect(text).toContain('po 10 nieudanych próbach logowania zablokowaliśmy logowanie');
    expect(text).toContain('z nieznanych przeglądarek od 05.10.2026, 09:10 do 05.10.2026, 09:25.');
    expect(text).toContain('zmiana hasła zdejmie tę blokadę');
    expect(text).toContain(LINK);
    expect(text).not.toMatch(/#|token|@/i);
    expect(text).toContain('Logowanie z przeglądarki, której używasz na co dzień, nie jest zablokowane.');
  });

  it('EVM-026 AC4 e-mail 3 of the second step: "ktoś zna Twoje hasło", and the new password does NOT lift the lock', () => {
    const { text } = accountLockedText({
      panelOrigin: ORIGIN,
      variant: 'second_step',
      lockedAt: LOCKED_AT,
      lockedUntil: new Date(LOCKED_AT.getTime() + 15 * 60_000),
    });
    expect(text).toContain('po kilku nieudanych próbach drugiego kroku logowania zablokowaliśmy');
    expect(text).toContain('ktoś zna Twoje hasło');
    expect(text).toContain('Zmiana hasła nie zdejmie tej blokady');
    expect(text).toContain(LINK);
    expect(text).not.toMatch(/#|token|@/i);
  });

  it('EVM-026 AC4 e-mail 3 of a browser the account knows, by the password: THIS browser is locked, the others are not covered, and a new password lifts it', () => {
    const { text } = accountLockedText({
      panelOrigin: ORIGIN,
      variant: 'browser_password',
      lockedAt: LOCKED_AT,
      lockedUntil: new Date(LOCKED_AT.getTime() + 15 * 60_000),
    });
    expect(text).toContain('po 10 nieudanych próbach logowania zablokowaliśmy logowanie');
    expect(text).toContain('z przeglądarki, której Twoje konto używa na co dzień, od 05.10.2026, 09:10 do 05.10.2026, 09:25.');
    expect(text).toContain('Ta blokada dotyczy tylko tej przeglądarki');
    expect(text).toContain('zmiana hasła zdejmie tę blokadę');
    expect(text).toContain(LINK);
    expect(text).not.toContain('z nieznanych przeglądarek');
    expect(text).not.toContain('nie jest zablokowane');
    expect(text).not.toMatch(/#|token|@/i);
  });

  it('EVM-026 AC4 e-mail 3 of a browser the account knows, by the second step: someone knows the password, and a new password lifts THIS lock (the browsers are forgotten)', () => {
    const { text } = accountLockedText({
      panelOrigin: ORIGIN,
      variant: 'browser_second_step',
      lockedAt: LOCKED_AT,
      lockedUntil: new Date(LOCKED_AT.getTime() + 15 * 60_000),
    });
    expect(text).toContain('po kilku nieudanych próbach drugiego kroku logowania zablokowaliśmy');
    expect(text).toContain('z przeglądarki, której Twoje konto używa na co dzień, od 05.10.2026, 09:10 do 05.10.2026, 09:25.');
    expect(text).toContain('ktoś zna Twoje hasło');
    expect(text).toContain('Zmiana hasła zdejmie tę blokadę');
    expect(text).toContain('zapomnimy przeglądarki konta');
    expect(text).not.toContain('nie zdejmie');
    expect(text).toContain('Ta blokada dotyczy tylko tej przeglądarki');
    expect(text).toContain(LINK);
    expect(text).not.toMatch(/#|token|@/i);
  });

  it('EVM-026 AC4 only the causes of a lock, for the two scopes, are variants', () => {
    expect(['password', 'second_step', 'browser_password', 'browser_second_step', 'other', 'browser', null].map(isLockVariant)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(lockVariant('password', 'account')).toBe('password');
    expect(lockVariant('second_step', 'account')).toBe('second_step');
    expect(lockVariant('password', 'browser')).toBe('browser_password');
    expect(lockVariant('second_step', 'browser')).toBe('browser_second_step');
  });

  it('EVM-026 AC5 e-mail 7: the time of the sign-in and the way back — no IP, no place, no device, no token', () => {
    const { subject, text } = newBrowserText({ panelOrigin: ORIGIN, signedInAt: LOCKED_AT });
    expect(subject).toBe('EVia Manager: logowanie z nowej przeglądarki');
    expect(text).toContain('05.10.2026, 09:10 zalogowano się do Twojego konta w EVia Manager z przeglądarki,');
    expect(text).toContain(LINK);
    expect(text).not.toMatch(/#|token|@|\d+\.\d+\.\d+\.\d+|Mozilla/i);
  });

  it('EVM-026 AC5 alert 9 of a new browser names the event and the time, and keeps its own lead', () => {
    expect(ALERT_VARIANTS).toContain('administrator_new_browser');
    const { subject, text } = alertText({ panelOrigin: ORIGIN, variant: 'administrator_new_browser', occurredAt: LOCKED_AT });
    expect(subject).toBe('EVia Manager: alert bezpieczeństwa — logowanie z nowej przeglądarki');
    expect(text).toContain('wystąpiło zdarzenie dotyczące logowania do konta administratora');
    expect(text).toContain('(05.10.2026, 09:10):');
    expect(text).toContain('zalogowano się do konta Administratora z przeglądarki, której to konto wcześniej nie używało.');
  });
});

describe('the cookie of a known browser (EVM-026 AC5; ASVS V3.3, CWE-614, CWE-1004)', () => {
  it('EVM-026 AC5 is __Host- with Secure, HttpOnly, SameSite=Strict, Path=/, 30 days and no Domain', () => {
    expect(deviceCookie(TOKEN)).toBe(`${DEVICE_COOKIE_NAME}=${TOKEN}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000`);
    expect(deviceCookie(TOKEN)).not.toMatch(/Domain/i);
  });

  it('EVM-026 AC5 reads the one well-formed cookie among others', () => {
    expect(readDeviceCookie(`__Host-evia_session=${'S'.repeat(43)}; ${DEVICE_COOKIE_NAME}=${TOKEN}; other=1`)).toBe(TOKEN);
  });

  it.each([
    ['no header', undefined],
    ['no cookie of the name', '__Host-evia_session=abc; other=1'],
    ['a malformed token', `${DEVICE_COOKIE_NAME}=short`],
    ['a token of a wrong alphabet', `${DEVICE_COOKIE_NAME}=${'+'.repeat(43)}`],
    ['an empty value', `${DEVICE_COOKIE_NAME}=`],
    ['two cookies of the name (one may be planted)', `${DEVICE_COOKIE_NAME}=${TOKEN}; ${DEVICE_COOKIE_NAME}=${'E'.repeat(43)}`],
    ['a cookie of the name with a prefix', `x${DEVICE_COOKIE_NAME}=${TOKEN}`],
  ])('EVM-026 AC5 %s is no cookie at all', (_label, header) => {
    expect(readDeviceCookie(header)).toBeUndefined();
  });
});

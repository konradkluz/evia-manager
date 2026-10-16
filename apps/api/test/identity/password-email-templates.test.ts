import { describe, expect, it } from 'vitest';
import {
  RESET_FORM_PATH,
  RESET_PATH,
  passwordChangedText,
  passwordResetLink,
  passwordResetText,
} from '../../src/modules/identity/domain/email-templates.ts';

const ORIGIN = 'https://panel.evia.test';
const TOKEN = 'B'.repeat(43);
const LF = String.fromCharCode(10);
const FOOTER = [
  '--',
  'Wiadomość automatyczna z EVia Manager (EVia Charge) — nie odpowiadaj na nią.',
  `Adres panelu: ${ORIGIN}`,
  'Nigdy nie prosimy o hasło ani kody w e-mailu. Jeśli wiadomość budzi wątpliwości,',
  'wpisz adres panelu samodzielnie i skontaktuj się z administratorem.',
  '',
];

describe('the fixed texts of the password e-mails (EVM-025 AC1, AC5; docs/ux/flows/e-maile.md nr 2 and 4)', () => {
  it('EVM-025 AC1 the reset link is the template of the document: the link only in the fragment, the validity of 30 minutes with the end in Europe/Warsaw, the footer — and no name or address', () => {
    const { subject, text } = passwordResetText({
      link: passwordResetLink(ORIGIN, TOKEN),
      expiresAt: new Date('2026-10-05T08:30:00.000Z'),
      panelOrigin: ORIGIN,
    });
    expect(subject).toBe('EVia Manager: link do ustawienia nowego hasła');
    expect(text.split(LF)).toEqual([
      'Dzień dobry,',
      '',
      'otrzymaliśmy prośbę o ustawienie nowego hasła do konta w EVia Manager.',
      '',
      'Aby ustawić nowe hasło, otwórz link:',
      `${ORIGIN}${RESET_PATH}#${TOKEN}`,
      '',
      'Link jest jednorazowy i ważny 30 minut — do 10:30.',
      'Po ustawieniu hasła zakończymy wszystkie sesje konta, a logowanie',
      'potwierdzisz drugim krokiem.',
      '',
      'Jeśli ta prośba nie pochodzi od Ciebie, zignoruj tę wiadomość —',
      'hasło się nie zmieni.',
      '',
      ...FOOTER,
    ]);
  });

  it('EVM-025 AC2 the token is never in the path or the query of the link', () => {
    const link = passwordResetLink(ORIGIN, TOKEN);
    const url = new URL(link);
    expect(url.pathname).toBe(RESET_PATH);
    expect(url.search).toBe('');
    expect(url.hash).toBe(`#${TOKEN}`);
  });

  it('EVM-025 AC5 the notice after a reset names the time in Europe/Warsaw, says that the sessions ended and links to the reset form without a token', () => {
    const { subject, text } = passwordChangedText({ panelOrigin: ORIGIN, changedAt: new Date('2026-10-04T12:05:00.000Z') });
    expect(subject).toBe('EVia Manager: hasło zostało zmienione');
    expect(text.split(LF)).toEqual([
      'Dzień dobry,',
      '',
      'hasło do konta w EVia Manager zostało zmienione 04.10.2026, 14:05.',
      '',
      'Zakończyliśmy wszystkie sesje konta.',
      '',
      'Jeśli to nie Ty, od razu ustaw nowe hasło i powiadom administratora:',
      `${ORIGIN}${RESET_FORM_PATH}`,
      '',
      ...FOOTER,
    ]);
    expect(text).not.toContain('#');
  });
});

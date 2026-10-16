import { describe, expect, it } from 'vitest';
import {
  SECOND_STEP_SETTINGS_PATH,
  isSecondStepChange,
  recoveryCodeUsedText,
  remainingCodesSentence,
  secondStepChangedText,
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

describe('the fixed texts of the e-mails about the second step (EVM-023 AC5, AC6; docs/ux/flows/e-maile.md nr 5 and 6)', () => {
  const when = new Date('2026-10-04T12:05:00.000Z'); // 14:05 in Europe/Warsaw (CEST)

  it('EVM-023 AC6 the change is the template of the document: what changed and when, the links without a token, the footer — no secret, no name, no address', () => {
    const { subject, text } = secondStepChangedText({ panelOrigin: ORIGIN, change: 'totp_enrolled', changedAt: when });
    expect(subject).toBe('EVia Manager: zmiana drugiego kroku logowania');
    expect(text.split(LF)).toEqual([
      'Dzień dobry,',
      '',
      'w koncie w EVia Manager zmieniono drugi krok logowania 04.10.2026, 14:05:',
      'dodano kod z aplikacji uwierzytelniającej.',
      '',
      'Metody konta sprawdzisz w panelu: Konto → Drugi krok logowania',
      `${ORIGIN}${SECOND_STEP_SETTINGS_PATH}`,
      '',
      'Jeśli to nie Ty, od razu ustaw nowe hasło i powiadom administratora:',
      `${ORIGIN}${RESET_FORM_PATH}`,
      '',
      ...FOOTER,
    ]);
    expect(secondStepChangedText({ panelOrigin: ORIGIN, change: 'recovery_codes_generated', changedAt: when }).text).toContain(
      'wygenerowano nowe kody odzyskiwania — poprzednie kody przestały działać.',
    );
  });

  it('EVM-023 AC6 only the two known changes are texts: anything else is refused before a message is made', () => {
    expect(isSecondStepChange('totp_enrolled')).toBe(true);
    expect(isSecondStepChange('recovery_codes_generated')).toBe(true);
    for (const value of [null, '', 'passkey_added', 'TOTP_ENROLLED']) expect(isSecondStepChange(value), String(value)).toBe(false);
  });

  it('EVM-023 AC5 the use of a recovery code is the template of the document: the time and the number of codes left', () => {
    const { subject, text } = recoveryCodeUsedText({ panelOrigin: ORIGIN, usedAt: when, remaining: 9 });
    expect(subject).toBe('EVia Manager: użyto kodu odzyskiwania');
    expect(text.split(LF)).toEqual([
      'Dzień dobry,',
      '',
      'zalogowano się do konta w EVia Manager kodem odzyskiwania',
      '04.10.2026, 14:05. Pozostało 9 kodów.',
      '',
      'Każdy kod działa raz. Gdy zostaną 3 lub mniej, wygeneruj nowe:',
      'Konto → Drugi krok logowania',
      `${ORIGIN}${SECOND_STEP_SETTINGS_PATH}`,
      'Jeśli nie masz już żadnej metody drugiego kroku, poproś administratora',
      'o reset drugiego kroku logowania.',
      '',
      'Jeśli to nie Ty, ktoś zna hasło i ma kody odzyskiwania — od razu',
      'ustaw nowe hasło i powiadom administratora:',
      `${ORIGIN}${RESET_FORM_PATH}`,
      '',
      ...FOOTER,
    ]);
  });

  it('EVM-023 AC5 the number of codes left has the Polish forms (0, 1, 2–4, 5–21, 22–24, 12–14)', () => {
    const cases: Array<[number, string]> = [
      [0, 'Nie zostały już żadne kody.'],
      [1, 'Pozostał 1 kod.'],
      [2, 'Pozostały 2 kody.'],
      [4, 'Pozostały 4 kody.'],
      [5, 'Pozostało 5 kodów.'],
      [9, 'Pozostało 9 kodów.'],
      [12, 'Pozostało 12 kodów.'],
      [22, 'Pozostały 22 kody.'],
    ];
    for (const [count, sentence] of cases) expect(remainingCodesSentence(count), String(count)).toBe(sentence);
  });
});

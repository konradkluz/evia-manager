/**
 * The fixed texts of the e-mails of the identity module (EVM-024 AC2; docs/ux/flows/e-maile.md, rules 1-8, 12; SR-INPUT-07, TM-80): plain text,
 * a template in the code, filled ONLY with values of closed lists (the role of the account, the end of the validity of a link, the time of an
 * event) and with links built from the origin of the panel in the configuration — never from a header of a request (CWE-640). No name of a
 * person, no address, no data of a customer, no IP address: the text of an alert names no one (rule 10).
 *
 * The token of a link is in the FRAGMENT of the address (`#…`), never in the path or the query (SR-API-04): a mail scanner that opens the
 * link and a proxy that logs the path never see it.
 */

export type InviteRole = 'administrator' | 'editor' | 'read_only';

const ROLE_LABELS: Readonly<Record<InviteRole, string>> = {
  administrator: 'Administrator',
  editor: 'Edytor',
  read_only: 'Tylko odczyt',
};

/** The panel pages the e-mails lead to (paths of the panel: `apps/web/src/paths.ts`). */
export const ACTIVATION_PATH = '/activate';
export const AUDIT_LOG_PATH = '/administration/audit';

const WARSAW = new Intl.DateTimeFormat('pl-PL', {
  timeZone: 'Europe/Warsaw',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "06.10.2026, 10:00" in the business zone (e-maile.md, rule 8). */
export function formatWarsaw(instant: Date): string {
  const parts = Object.fromEntries(WARSAW.formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts['day']}.${parts['month']}.${parts['year']}, ${parts['hour']}:${parts['minute']}`;
}

export interface EmailText {
  readonly subject: string;
  readonly text: string;
}

const footer = (panelOrigin: string): string =>
  [
    '--',
    'Wiadomość automatyczna z EVia Manager (EVia Charge) — nie odpowiadaj na nią.',
    `Adres panelu: ${panelOrigin}`,
    'Nigdy nie prosimy o hasło ani kody w e-mailu. Jeśli wiadomość budzi wątpliwości,',
    'wpisz adres panelu samodzielnie i skontaktuj się z administratorem.',
  ].join('\n');

/** The one-time link of an activation: the token only in the fragment. */
export const activationLink = (panelOrigin: string, token: string): string => `${panelOrigin}${ACTIVATION_PATH}#${token}`;

export interface InvitationTextInput {
  readonly panelOrigin: string;
  readonly role: InviteRole;
  /** The link with the token (see {@link activationLink}). */
  readonly link: string;
  readonly expiresAt: Date;
}

/** E-mail 1 (an invitation; also a repeated one — the same text, the earlier link no longer works). */
export function invitationText(input: InvitationTextInput): EmailText {
  return {
    subject: 'EVia Manager: zaproszenie do panelu',
    text: [
      'Dzień dobry,',
      '',
      `zaproszono Cię do panelu EVia Manager firmy EVia Charge z rolą: ${ROLE_LABELS[input.role]}.`,
      '',
      'Aby aktywować konto, otwórz link i ustaw hasło, a potem drugi krok logowania:',
      input.link,
      '',
      `Link jest jednorazowy i ważny 72 godziny — do ${formatWarsaw(input.expiresAt)}.`,
      'Po tym czasie poproś administratora o nowe zaproszenie.',
      '',
      'Jeśli nie spodziewasz się tego zaproszenia, zignoruj tę wiadomość —',
      'konto nie zostanie aktywowane.',
      '',
      footer(input.panelOrigin),
      '',
    ].join('\n'),
  };
}

/** The variants of the alert for Administrators (EVM-024, EVM-027; the others belong to EVM-026, -028). */
export const ALERT_VARIANTS = [
  'administrator_invitation',
  'administrator_granted',
  'administrator_revoked',
  'administrator_deactivated',
  'administrator_reactivated',
  'administrator_second_step_reset',
  // EVM-026 (alert 9): an Administrator's account signed in from a browser it did not know.
  'administrator_new_browser',
  // EVM-028 (alert 9): a method of the second step of an Administrator's account was added or removed, or new recovery codes were made.
  'administrator_second_step_changed',
  // EVM-094: an Administrator signed in from a phone the account did not know / a used refresh credential came back (a session of a phone was ended).
  'administrator_new_device',
  'administrator_refresh_reuse',
] as const;
export type AlertVariant = (typeof ALERT_VARIANTS)[number];

const ALERT_KINDS: Readonly<Record<AlertVariant, { readonly kind: string; readonly sentence: string; readonly lead?: string }>> = {
  administrator_invitation: { kind: 'zaproszenie administratora', sentence: 'wysłano zaproszenie z rolą Administrator.' },
  administrator_granted: { kind: 'nowy administrator', sentence: 'nadano rolę Administrator jednemu z kont.' },
  administrator_revoked: { kind: 'odebrana rola', sentence: 'odebrano rolę Administrator jednemu z kont.' },
  administrator_deactivated: { kind: 'dezaktywacja administratora', sentence: 'dezaktywowano konto z rolą Administrator.' },
  administrator_reactivated: { kind: 'reaktywacja administratora', sentence: 'reaktywowano konto z rolą Administrator.' },
  administrator_second_step_reset: { kind: 'reset drugiego kroku', sentence: 'zresetowano drugi krok logowania konta administratora.' },
  administrator_new_browser: {
    kind: 'logowanie z nowej przeglądarki',
    sentence: 'zalogowano się do konta Administratora z przeglądarki, której to konto wcześniej nie używało.',
    lead: 'zdarzenie dotyczące logowania do konta administratora',
  },
  administrator_new_device: {
    kind: 'logowanie z nowego urządzenia mobilnego',
    sentence: 'zalogowano się do konta Administratora z telefonu, którego to konto wcześniej nie używało.',
    lead: 'zdarzenie dotyczące logowania do konta administratora',
  },
  administrator_refresh_reuse: {
    kind: 'ponowne użycie poświadczenia odświeżania',
    sentence:
      'ponownie użyto zużytego poświadczenia odświeżania sesji telefonu — sesja tego urządzenia została zakończona, a urządzenie wymaga ponownego logowania.',
    lead: 'zdarzenie dotyczące bezpieczeństwa sesji mobilnej',
  },
  administrator_second_step_changed: {
    kind: 'zmiana drugiego kroku',
    sentence: 'zmieniono drugi krok logowania konta administratora (dodano albo usunięto metodę albo wygenerowano nowe kody).',
  },
};

export const isAlertVariant = (value: string | null): value is AlertVariant => ALERT_VARIANTS.includes(value as AlertVariant);

export interface AlertTextInput {
  readonly panelOrigin: string;
  readonly variant: AlertVariant;
  readonly occurredAt: Date;
}

/** E-mail 9 (an alert for Administrators): the event and the time, no person, no address, no token — who and when is in the audit log. */
export function alertText(input: AlertTextInput): EmailText {
  const { kind, sentence, lead = 'zdarzenie dotyczące uprawnień administratora' } = ALERT_KINDS[input.variant];
  return {
    subject: `EVia Manager: alert bezpieczeństwa — ${kind}`,
    text: [
      'Dzień dobry,',
      '',
      `w EVia Manager wystąpiło ${lead}`,
      `(${formatWarsaw(input.occurredAt)}):`,
      sentence,
      '',
      'Szczegóły — kto i kiedy — są w panelu: Administracja → Dziennik audytu',
      '(wymaga potwierdzenia tożsamości):',
      `${input.panelOrigin}${AUDIT_LOG_PATH}`,
      '',
      'Jeśli zdarzenie nie było zaplanowane, sprawdź dziennik audytu',
      'i skontaktuj się z pozostałymi administratorami.',
      '',
      footer(input.panelOrigin),
      '',
    ].join('\n'),
  };
}

/** W-12 (the page a reset link leads to; the token is in the fragment) and the "Zresetuj hasło" form of W-01 (no token): paths of the panel. */
export const RESET_PATH = '/reset-password';
export const RESET_FORM_PATH = '/login/reset';

/** The one-time link of a password reset: the token only in the fragment. */
export const passwordResetLink = (panelOrigin: string, token: string): string => `${panelOrigin}${RESET_PATH}#${token}`;

/** "10:30" in the business zone — the end of the validity of a reset link (e-maile.md, rule 6). */
const WARSAW_TIME = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const formatWarsawTime = (instant: Date): string => WARSAW_TIME.format(instant);

export interface PasswordResetTextInput {
  readonly panelOrigin: string;
  /** The link with the token (see {@link passwordResetLink}). */
  readonly link: string;
  readonly expiresAt: Date;
}

/** E-mail 2 (the link to set a new password): only the link, its validity and the footer — no name, no address (SR-INPUT-07). */
export function passwordResetText(input: PasswordResetTextInput): EmailText {
  return {
    subject: 'EVia Manager: link do ustawienia nowego hasła',
    text: [
      'Dzień dobry,',
      '',
      'otrzymaliśmy prośbę o ustawienie nowego hasła do konta w EVia Manager.',
      '',
      'Aby ustawić nowe hasło, otwórz link:',
      input.link,
      '',
      `Link jest jednorazowy i ważny 30 minut — do ${formatWarsawTime(input.expiresAt)}.`,
      'Po ustawieniu hasła zakończymy wszystkie sesje konta, a logowanie',
      'potwierdzisz drugim krokiem.',
      '',
      'Jeśli ta prośba nie pochodzi od Ciebie, zignoruj tę wiadomość —',
      'hasło się nie zmieni.',
      '',
      footer(input.panelOrigin),
      '',
    ].join('\n'),
  };
}

/** The panel page "Moje sesje" (W-15 anchor): the mails that mention the sessions of the account point here, without a token. */
export const SESSIONS_SETTINGS_PATH = '/account#moje-sesje';

/** Where the new password came from: a reset with a link (every session ended), or the page of the account (the other sessions go on until the owner ends them). */
export type PasswordChangeSource = 'reset' | 'account';
export const PASSWORD_CHANGE_ACCOUNT_VARIANT = 'from_account';

export interface PasswordChangedTextInput {
  readonly panelOrigin: string;
  readonly changedAt: Date;
  readonly source?: PasswordChangeSource;
}

/**
 * E-mail 4: the time, what happened to the sessions and a link to the reset form without a token. After a reset with a link every session ended; after a change
 * on the page of the account the other sessions stay, and the mail says where to end them ("Konto → Moje sesje"). No IP, no browser, no name of the doer.
 */
export function passwordChangedText(input: PasswordChangedTextInput): EmailText {
  const sessions =
    input.source === 'account'
      ? ['Pozostałe sesje możesz zakończyć w panelu: Konto → Moje sesje', `${input.panelOrigin}${SESSIONS_SETTINGS_PATH}`]
      : ['Zakończyliśmy wszystkie sesje konta.'];
  return {
    subject: 'EVia Manager: hasło zostało zmienione',
    text: [
      'Dzień dobry,',
      '',
      `hasło do konta w EVia Manager zostało zmienione ${formatWarsaw(input.changedAt)}.`,
      '',
      ...sessions,
      '',
      'Jeśli to nie Ty, od razu ustaw nowe hasło i powiadom administratora:',
      `${input.panelOrigin}${RESET_FORM_PATH}`,
      '',
      footer(input.panelOrigin),
      '',
    ].join('\n'),
  };
}

/** W-15 "Drugi krok logowania" (the anchor of the account page): the mails of a change of the second step point here, without a token. */
export const SECOND_STEP_SETTINGS_PATH = '/account#drugi-krok';

export type SecondStepChange =
  'totp_enrolled' | 'recovery_codes_generated' | 'passkey_enrolled' | 'second_step_reset' | 'passkey_removed' | 'totp_removed';
export const SECOND_STEP_CHANGES: readonly SecondStepChange[] = [
  'totp_enrolled',
  'recovery_codes_generated',
  'passkey_enrolled',
  'second_step_reset',
  'passkey_removed',
  'totp_removed',
];
export const isSecondStepChange = (value: string | null): value is SecondStepChange =>
  SECOND_STEP_CHANGES.some((change) => change === value);

const SECOND_STEP_CHANGE_TEXT: Readonly<Record<Exclude<SecondStepChange, 'second_step_reset'>, string>> = {
  totp_enrolled: 'dodano kod z aplikacji uwierzytelniającej.',
  passkey_enrolled: 'dodano klucz dostępu.',
  recovery_codes_generated: 'wygenerowano nowe kody odzyskiwania — poprzednie kody przestały działać.',
  passkey_removed: 'usunięto klucz dostępu.',
  totp_removed: 'usunięto kod z aplikacji uwierzytelniającej.',
};

export interface SecondStepChangedTextInput {
  readonly panelOrigin: string;
  readonly change: SecondStepChange;
  readonly changedAt: Date;
  /** The end of the window to set up a second step — only for `second_step_reset`. */
  readonly windowEndsAt?: Date;
}

/**
 * E-mail 5 (a change of the second step, variants of EVM-023 and EVM-027): what changed and when; never the secret, a code, the name of a method's device or
 * who did it (SR-AUTH-10). The variant "reset by an Administrator" says that every session ended and until when the setup is open; it carries NO link that
 * signs in or sets a password (SR-INPUT-07) — only the address of the panel — and asks to contact the administrator instead of "set a new password".
 */
export function secondStepChangedText(input: SecondStepChangedTextInput): EmailText {
  const reset = input.change === 'second_step_reset';
  const what = reset
    ? [
        'zresetowano drugi krok logowania w panelu administracji. Wszystkie sesje konta zostały zakończone.',
        'Przy następnym logowaniu panel poprowadzi przez konfigurację od nowa.',
        `Skonfiguruj drugi krok do ${formatWarsaw(input.windowEndsAt ?? input.changedAt)} — po tym czasie poproś administratora o ponowny reset.`,
      ]
    : [SECOND_STEP_CHANGE_TEXT[input.change]];
  const warning = reset
    ? ['Jeśli nie zgłaszasz utraty drugiego kroku, od razu skontaktuj się z administratorem.']
    : ['Jeśli to nie Ty, od razu ustaw nowe hasło i powiadom administratora:', `${input.panelOrigin}${RESET_FORM_PATH}`];
  return {
    subject: 'EVia Manager: zmiana drugiego kroku logowania',
    text: [
      'Dzień dobry,',
      '',
      `w koncie w EVia Manager zmieniono drugi krok logowania ${formatWarsaw(input.changedAt)}:`,
      ...what,
      '',
      'Metody konta sprawdzisz w panelu: Konto → Drugi krok logowania',
      `${input.panelOrigin}${SECOND_STEP_SETTINGS_PATH}`,
      '',
      ...warning,
      '',
      footer(input.panelOrigin),
      '',
    ].join('\n'),
  };
}

/** "Pozostało 9 kodów." with the Polish forms (the same sentence as W-02 shows after the sign-in; e-maile.md rule 3). */
export function remainingCodesSentence(remaining: number): string {
  if (remaining <= 0) return 'Nie zostały już żadne kody.';
  if (remaining === 1) return 'Pozostał 1 kod.';
  const lastTwo = remaining % 100;
  const few = remaining % 10 >= 2 && remaining % 10 <= 4 && (lastTwo < 12 || lastTwo > 14);
  return few ? `Pozostały ${remaining} kody.` : `Pozostało ${remaining} kodów.`;
}

export interface RecoveryCodeUsedTextInput {
  readonly panelOrigin: string;
  readonly usedAt: Date;
  readonly remaining: number;
}

/** E-mail 6 (a recovery code was used to sign in): the time and how many codes are left — never the code or its position (SR-AUTH-15). */
export function recoveryCodeUsedText(input: RecoveryCodeUsedTextInput): EmailText {
  return {
    subject: 'EVia Manager: użyto kodu odzyskiwania',
    text: [
      'Dzień dobry,',
      '',
      'zalogowano się do konta w EVia Manager kodem odzyskiwania',
      `${formatWarsaw(input.usedAt)}. ${remainingCodesSentence(input.remaining)}`,
      '',
      'Każdy kod działa raz. Gdy zostaną 3 lub mniej, wygeneruj nowe:',
      'Konto → Drugi krok logowania',
      `${input.panelOrigin}${SECOND_STEP_SETTINGS_PATH}`,
      'Jeśli nie masz już żadnej metody drugiego kroku, poproś administratora',
      'o reset drugiego kroku logowania.',
      '',
      'Jeśli to nie Ty, ktoś zna hasło i ma kody odzyskiwania — od razu',
      'ustaw nowe hasło i powiadom administratora:',
      `${input.panelOrigin}${RESET_FORM_PATH}`,
      '',
      footer(input.panelOrigin),
      '',
    ].join('\n'),
  };
}

/**
 * The variant of e-mail 3 (EVM-026 AC4): the cause of the lock — the failures of the password, or at least one of the second step — and the scope of it: the
 * browsers the account does not know (`password`, `second_step`) or ONE browser it knows (`browser_…`). The variant is what the outbox stores.
 */
export type LockVariant = 'password' | 'second_step' | 'browser_password' | 'browser_second_step';
const LOCK_VARIANTS: readonly string[] = ['password', 'second_step', 'browser_password', 'browser_second_step'];
export const isLockVariant = (value: string | null): value is LockVariant => value !== null && LOCK_VARIANTS.includes(value);

export const lockVariant = (cause: 'password' | 'second_step', scope: 'account' | 'browser'): LockVariant =>
  scope === 'browser' ? (`browser_${cause}` as LockVariant) : cause;

export interface AccountLockedTextInput {
  readonly panelOrigin: string;
  readonly variant: LockVariant;
  /** When the lock began (the time the lock was asked for) and for how long it holds. */
  readonly lockedAt: Date;
  readonly lockedUntil: Date;
}

/**
 * E-mail 3 (a lock of the sign-in after ten failed tries): the time, for how long, the one thing to do — a link to the form "Zresetuj hasło" WITHOUT a token
 * (SR-INPUT-07, SR-AUTH-15). It names no address, no IP and no number of tries. The variants of the browsers the account does not know: with the second step,
 * someone seems to know the password and a new one does not lift the lock (only the time does); with the password, a new one does. The variants of a browser
 * the account knows say that THAT browser is locked and nothing else; there a new password lifts the lock in both causes, because it makes the account forget
 * its browsers with their counters (`forgetBrowsers`).
 */
export function accountLockedText(input: AccountLockedTextInput): EmailText {
  const resetForm = `${input.panelOrigin}${RESET_FORM_PATH}`;
  const period = `od ${formatWarsaw(input.lockedAt)} do ${formatWarsaw(input.lockedUntil)}.`;
  const bodies: Record<LockVariant, string[]> = {
    second_step: [
      'po kilku nieudanych próbach drugiego kroku logowania zablokowaliśmy',
      `logowanie z nieznanych przeglądarek ${period}`,
      '',
      'Wygląda na to, że ktoś zna Twoje hasło. Ustaw nowe hasło i powiadom',
      'administratora. Zmiana hasła nie zdejmie tej blokady — ustąpi z upływem czasu.',
      resetForm,
      '',
      'Logowanie z przeglądarki, której używasz na co dzień, nie jest zablokowane.',
    ],
    password: [
      'po 10 nieudanych próbach logowania zablokowaliśmy logowanie',
      `z nieznanych przeglądarek ${period}`,
      '',
      'Jeśli to nie Ty, ktoś mógł zgadywać Twoje hasło — ustaw nowe;',
      'zmiana hasła zdejmie tę blokadę. Jeśli to Ty, poczekaj do końca blokady.',
      resetForm,
      '',
      'Logowanie z przeglądarki, której używasz na co dzień, nie jest zablokowane.',
    ],
    browser_second_step: [
      'po kilku nieudanych próbach drugiego kroku logowania zablokowaliśmy',
      `logowanie z przeglądarki, której Twoje konto używa na co dzień, ${period}`,
      '',
      'Wygląda na to, że ktoś zna Twoje hasło. Ustaw nowe hasło i powiadom',
      'administratora. Zmiana hasła zdejmie tę blokadę — zapomnimy przeglądarki konta,',
      'więc następne logowanie będzie z „nowej” przeglądarki i wyślemy o nim wiadomość.',
      resetForm,
      '',
      'Ta blokada dotyczy tylko tej przeglądarki.',
    ],
    browser_password: [
      'po 10 nieudanych próbach logowania zablokowaliśmy logowanie',
      `z przeglądarki, której Twoje konto używa na co dzień, ${period}`,
      '',
      'Jeśli to nie Ty, ktoś mógł zgadywać Twoje hasło — ustaw nowe;',
      'zmiana hasła zdejmie tę blokadę. Jeśli to Ty, poczekaj do końca blokady.',
      resetForm,
      '',
      'Ta blokada dotyczy tylko tej przeglądarki.',
    ],
  };
  return {
    subject: 'EVia Manager: logowanie zablokowane na 15 minut',
    text: ['Dzień dobry,', '', ...bodies[input.variant], '', footer(input.panelOrigin), ''].join('\n'),
  };
}

export interface NewBrowserTextInput {
  readonly panelOrigin: string;
  readonly signedInAt: Date;
}

/** E-mail 7 (a sign-in from a browser the account did not know): the time and the way back — a link to the form "Zresetuj hasło" without a token; no IP, no place, no device. */
export function newBrowserText(input: NewBrowserTextInput): EmailText {
  return {
    subject: 'EVia Manager: logowanie z nowej przeglądarki',
    text: [
      'Dzień dobry,',
      '',
      `${formatWarsaw(input.signedInAt)} zalogowano się do Twojego konta w EVia Manager z przeglądarki,`,
      'której to konto wcześniej nie używało.',
      '',
      'Jeśli to Ty, nic nie musisz robić. Jeśli to nie Ty, od razu ustaw nowe hasło',
      'i powiadom administratora:',
      `${input.panelOrigin}${RESET_FORM_PATH}`,
      '',
      footer(input.panelOrigin),
      '',
    ].join('\n'),
  };
}

export interface NewDeviceTextInput {
  readonly panelOrigin: string;
  readonly signedInAt: Date;
  /** The model and the version of Android as the contract admits them (letters, digits and a few signs — no control characters); never an IMEI, an address or a place. */
  readonly model: string;
  readonly osVersion: string;
}

/** E-mail 7 for the phone (a sign-in from a device the account did not know; SR-AUTH-15): the model, the system and the time — no IP, no token, no identifier of the device. */
export function newDeviceText(input: NewDeviceTextInput): EmailText {
  return {
    subject: 'EVia Manager: logowanie z nowego urządzenia',
    text: [
      'Dzień dobry,',
      '',
      `${formatWarsaw(input.signedInAt)} zalogowano się do Twojego konta w aplikacji EVia Manager na urządzeniu,`,
      'którego to konto wcześniej nie używało:',
      `${input.model}, Android ${input.osVersion}.`,
      '',
      'Jeśli to Ty, nic nie musisz robić. Jeśli to nie Ty, od razu ustaw nowe hasło',
      'i powiadom administratora:',
      `${input.panelOrigin}${RESET_FORM_PATH}`,
      '',
      footer(input.panelOrigin),
      '',
    ].join('\n'),
  };
}

export interface SessionLimitTextInput {
  readonly panelOrigin: string;
  /** The session that ended: browser and system out of the closed dictionary (never the raw user agent) and its last activity. */
  readonly ended: { readonly browser: string; readonly os: string; readonly lastSeenAt: Date };
  /** The sign-in that went over the limit: the same dictionary and the moment. */
  readonly signedIn: { readonly browser: string; readonly os: string; readonly at: Date };
}

/**
 * E-mail 8 (the sixth sign-in ended the oldest session; SR-SESS-04): which session ended and which sign-in caused it, by browser and system and time —
 * no IP address, no raw user agent. The links lead to the reset form (without a token) and to "Moje sesje".
 */
export function sessionLimitText(input: SessionLimitTextInput): EmailText {
  const { ended, signedIn } = input;
  return {
    subject: 'EVia Manager: zakończono najstarszą sesję',
    text: [
      'Dzień dobry,',
      '',
      'nowe logowanie do konta w EVia Manager przekroczyło limit 5 równoczesnych',
      'sesji, więc zakończyliśmy najstarszą sesję:',
      '',
      `Zakończona sesja: ${ended.browser} · ${ended.os}, ostatnia aktywność ${formatWarsaw(ended.lastSeenAt)}`,
      `Nowe logowanie: ${signedIn.browser} · ${signedIn.os}, ${formatWarsaw(signedIn.at)}`,
      '',
      'Jeśli nowe logowanie nie pochodzi od Ciebie, od razu ustaw nowe hasło',
      'i powiadom administratora:',
      `${input.panelOrigin}${RESET_FORM_PATH}`,
      'Sesje konta zobaczysz w panelu: Konto → Moje sesje',
      `${input.panelOrigin}${SESSIONS_SETTINGS_PATH}`,
      '',
      footer(input.panelOrigin),
      '',
    ].join('\n'),
  };
}

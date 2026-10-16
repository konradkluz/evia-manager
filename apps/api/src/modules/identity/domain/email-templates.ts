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

/** The variants of the alert for Administrators this story sends (the others belong to EVM-026, -027, -028). */
export const ALERT_VARIANTS = ['administrator_invitation'] as const;
export type AlertVariant = (typeof ALERT_VARIANTS)[number];

const ALERT_KINDS: Readonly<Record<AlertVariant, { readonly kind: string; readonly sentence: string }>> = {
  administrator_invitation: { kind: 'zaproszenie administratora', sentence: 'wysłano zaproszenie z rolą Administrator.' },
};

export const isAlertVariant = (value: string | null): value is AlertVariant => ALERT_VARIANTS.includes(value as AlertVariant);

export interface AlertTextInput {
  readonly panelOrigin: string;
  readonly variant: AlertVariant;
  readonly occurredAt: Date;
}

/** E-mail 9 (an alert for Administrators): the event and the time, no person, no address, no token — who and when is in the audit log. */
export function alertText(input: AlertTextInput): EmailText {
  const { kind, sentence } = ALERT_KINDS[input.variant];
  return {
    subject: `EVia Manager: alert bezpieczeństwa — ${kind}`,
    text: [
      'Dzień dobry,',
      '',
      'w EVia Manager wystąpiło zdarzenie dotyczące uprawnień administratora',
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
const formatWarsawTime = (instant: Date): string => formatWarsaw(instant).split(', ')[1] ?? '';

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

export interface PasswordChangedTextInput {
  readonly panelOrigin: string;
  readonly changedAt: Date;
}

/** E-mail 4, the variant "after a reset with a link": the time, the sessions that ended, a link to the reset form without a token. */
export function passwordChangedText(input: PasswordChangedTextInput): EmailText {
  return {
    subject: 'EVia Manager: hasło zostało zmienione',
    text: [
      'Dzień dobry,',
      '',
      `hasło do konta w EVia Manager zostało zmienione ${formatWarsaw(input.changedAt)}.`,
      '',
      'Zakończyliśmy wszystkie sesje konta.',
      '',
      'Jeśli to nie Ty, od razu ustaw nowe hasło i powiadom administratora:',
      `${input.panelOrigin}${RESET_FORM_PATH}`,
      '',
      footer(input.panelOrigin),
      '',
    ].join('\n'),
  };
}

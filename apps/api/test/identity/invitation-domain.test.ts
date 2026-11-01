import { describe, expect, it } from 'vitest';
import {
  ACTIVATION_PATH,
  ALERT_VARIANTS,
  AUDIT_LOG_PATH,
  activationLink,
  alertText,
  formatWarsaw,
  invitationText,
  isAlertVariant,
} from '../../src/modules/identity/domain/email-templates.ts';
import { DISPLAY_NAME_MAX_LENGTH, normalizeInvitation } from '../../src/modules/identity/domain/invitation-input.ts';
import {
  DEFAULT_USER_LIMIT,
  MAX_USER_LIMIT,
  parseUserPosition,
  resolveUserListQuery,
} from '../../src/modules/identity/domain/user-list-query.ts';
import { uuidv7 } from '../support/uuid.ts';

const ORIGIN = 'https://panel.evia.test';
const TOKEN = 'A'.repeat(43);
const LF = String.fromCharCode(10);

describe('the fixed texts of the e-mails (EVM-024 AC2; docs/ux/flows/e-maile.md)', () => {
  it('EVM-024 AC2 the invitation is the template of the document: the role, the link in the fragment, the validity with the end in Europe/Warsaw, the footer — and no name', () => {
    const { subject, text } = invitationText({
      panelOrigin: ORIGIN,
      role: 'editor',
      link: activationLink(ORIGIN, TOKEN),
      expiresAt: new Date('2026-10-06T08:00:00.000Z'),
    });
    expect(subject).toBe('EVia Manager: zaproszenie do panelu');
    expect(text.split(LF)).toEqual([
      'Dzień dobry,',
      '',
      'zaproszono Cię do panelu EVia Manager firmy EVia Charge z rolą: Edytor.',
      '',
      'Aby aktywować konto, otwórz link i ustaw hasło, a potem drugi krok logowania:',
      `${ORIGIN}${ACTIVATION_PATH}#${TOKEN}`,
      '',
      'Link jest jednorazowy i ważny 72 godziny — do 06.10.2026, 10:00.',
      'Po tym czasie poproś administratora o nowe zaproszenie.',
      '',
      'Jeśli nie spodziewasz się tego zaproszenia, zignoruj tę wiadomość —',
      'konto nie zostanie aktywowane.',
      '',
      '--',
      'Wiadomość automatyczna z EVia Manager (EVia Charge) — nie odpowiadaj na nią.',
      `Adres panelu: ${ORIGIN}`,
      'Nigdy nie prosimy o hasło ani kody w e-mailu. Jeśli wiadomość budzi wątpliwości,',
      'wpisz adres panelu samodzielnie i skontaktuj się z administratorem.',
      '',
    ]);
  });

  it('EVM-024 AC2 the role is a label of a closed list; the token is only in the fragment, never in the path or the query', () => {
    for (const [role, label] of [
      ['administrator', 'Administrator'],
      ['editor', 'Edytor'],
      ['read_only', 'Tylko odczyt'],
    ] as const) {
      const { text } = invitationText({
        panelOrigin: ORIGIN,
        role,
        link: activationLink(ORIGIN, TOKEN),
        expiresAt: new Date('2026-10-06T08:00:00.000Z'),
      });
      expect(text).toContain(`z rolą: ${label}.`);
    }
    const link = activationLink(ORIGIN, TOKEN);
    expect(link).toBe(`${ORIGIN}/activate#${TOKEN}`);
    expect(new URL(link).pathname).toBe('/activate');
    expect(new URL(link).search).toBe('');
    expect(new URL(link).hash).toBe(`#${TOKEN}`);
  });

  it('EVM-024 AC1 the alert for Administrators names no one: the event, its time, a link to the audit log without a token — the variant is a closed list', () => {
    const { subject, text } = alertText({
      panelOrigin: ORIGIN,
      variant: 'administrator_invitation',
      occurredAt: new Date('2026-10-04T12:05:00.000Z'),
    });
    expect(subject).toBe('EVia Manager: alert bezpieczeństwa — zaproszenie administratora');
    expect(text).toContain('(04.10.2026, 14:05):');
    expect(text).toContain('wysłano zaproszenie z rolą Administrator.');
    expect(text).toContain(`${ORIGIN}${AUDIT_LOG_PATH}`);
    expect(text).not.toMatch(/#|@|token/i);
    expect(ALERT_VARIANTS).toEqual([
      'administrator_invitation',
      'administrator_granted',
      'administrator_revoked',
      'administrator_deactivated',
      'administrator_reactivated',
      'administrator_second_step_reset',
      'administrator_new_browser', // EVM-026 (alert 9)
      'administrator_second_step_changed', // EVM-028 (alert 9)
      'administrator_media_quarantined', // EVM-049 (alert 9)
      'administrator_media_export_started', // EVM-052 (alert 9)
      'administrator_new_device', // EVM-094
      'administrator_refresh_reuse',
    ]);
    expect(isAlertVariant('administrator_invitation')).toBe(true);
    for (const other of [null, '', 'emergency_reset', 'ADMINISTRATOR_INVITATION']) expect(isAlertVariant(other)).toBe(false);
  });

  it('EVM-024 AC4 the time is in the business zone with the change of the season: 2026-10-25 03:00 CEST becomes 02:00 CET', () => {
    expect(formatWarsaw(new Date('2026-10-01T08:00:00.000Z'))).toBe('01.10.2026, 10:00'); // CEST, UTC+2
    expect(formatWarsaw(new Date('2026-10-25T00:30:00.000Z'))).toBe('25.10.2026, 02:30'); // still CEST
    expect(formatWarsaw(new Date('2026-10-25T01:30:00.000Z'))).toBe('25.10.2026, 02:30'); // CET after the change
    expect(formatWarsaw(new Date('2026-12-31T23:30:00.000Z'))).toBe('01.01.2027, 00:30');
  });
});

describe('the input of an invitation (EVM-024 AC1, AC2; SR-INPUT-01, SR-INPUT-07)', () => {
  const input = (overrides: Partial<{ email: string; displayName: string }> = {}) => ({
    id: uuidv7(),
    email: 'Anna.Testowa@Example.com',
    displayName: '  Anna Testowa  ',
    role: 'editor' as const,
    ...overrides,
  });

  it('EVM-024 AC1 the address is normalised and the name is trimmed and put in NFC', () => {
    const result = normalizeInvitation(input({ displayName: 'Zófia' }));
    expect(result).toMatchObject({ ok: true, invitation: { email: 'anna.testowa@example.com', displayName: 'Zófia', role: 'editor' } });
  });

  it('EVM-024 AC2 an address that is not one is invalid_email; a name that is empty, too long (in characters, not bytes) or has control or formatting characters has its own code — pointers and codes only', () => {
    expect(normalizeInvitation(input({ email: 'a@b.test\r\nBcc: x@y.test' }))).toEqual({
      ok: false,
      errors: [{ pointer: '/email', code: 'invalid_email' }],
    });
    expect(normalizeInvitation(input({ displayName: ' ' }))).toEqual({
      ok: false,
      errors: [{ pointer: '/displayName', code: 'required' }],
    });
    expect(normalizeInvitation(input({ displayName: 'ł'.repeat(DISPLAY_NAME_MAX_LENGTH + 1) }))).toEqual({
      ok: false,
      errors: [{ pointer: '/displayName', code: 'too_long' }],
    });
    expect(normalizeInvitation(input({ displayName: 'ł'.repeat(DISPLAY_NAME_MAX_LENGTH) })).ok).toBe(true);
    for (const displayName of ['a\nb', 'a\u0000b', 'a​b', 'a‮b', 'a b', 'a b']) {
      expect(normalizeInvitation(input({ displayName })), JSON.stringify(displayName)).toEqual({
        ok: false,
        errors: [{ pointer: '/displayName', code: 'invalid_characters' }],
      });
    }
    expect(normalizeInvitation(input({ email: 'x', displayName: '' }))).toEqual({
      ok: false,
      errors: [
        { pointer: '/email', code: 'invalid_email' },
        { pointer: '/displayName', code: 'required' },
      ],
    });
  });
});

describe('the query of the list of users (EVM-024 AC5; SR-INPUT-01)', () => {
  it('EVM-024 AC5 the defaults, the bounds of the limit and the shape of the cursor', () => {
    expect(resolveUserListQuery.parse({})).toEqual({ limit: DEFAULT_USER_LIMIT, cursor: undefined });
    expect(resolveUserListQuery.parse({ limit: '100', cursor: 'abc_-' })).toEqual({ limit: MAX_USER_LIMIT, cursor: 'abc_-' });
    for (const bad of [
      { limit: '0' },
      { limit: '101' },
      { limit: '-1' },
      { limit: '1e2' },
      { limit: ' 5' },
      { cursor: '' },
      { cursor: 'a b' },
      { cursor: 'x'.repeat(513) },
      { sort: 'email' },
    ]) {
      expect(resolveUserListQuery.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('EVM-024 AC5 the position of a cursor is one identifier and nothing else', () => {
    const id = uuidv7();
    expect(parseUserPosition([id])).toBe(id);
    for (const bad of [[], ['not-a-uuid'], [id, id], ['']]) expect(parseUserPosition(bad)).toBeUndefined();
  });
});

describe('EVM-052 AC3 the e-mail to the Administrators when a ZIP export starts', () => {
  const ORDER = '0198a7a0-1234-7000-8000-000000000001';

  it('EVM-052 AC3 the text is the link to the order and nothing else: no customer, no file name, no link to the file, no person', () => {
    const { subject, text } = alertText({
      panelOrigin: 'https://panel.example.test',
      variant: 'administrator_media_export_started',
      occurredAt: new Date('2026-11-01T10:00:00Z'),
      subjectId: ORDER,
    });
    expect(subject).toBe('EVia Manager: alert bezpieczeństwa — eksport zdjęć zlecenia');
    expect(text).toContain(`https://panel.example.test/work-orders/${ORDER}`);
    expect(text).toContain('zlecono eksport zdjęć zlecenia do pliku ZIP.');
    expect(text).not.toMatch(/\.zip\b.*https?:|X-Amz|@|token/i);
    expect(text.match(/https?:\/\//g)).toHaveLength(2);
  });
});

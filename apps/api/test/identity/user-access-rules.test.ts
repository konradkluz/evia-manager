import { describe, expect, it } from 'vitest';
import {
  decideDeactivation,
  decideEndSessions,
  decideReactivation,
  decideRoleChange,
  decideSecondStepReset,
  roleChangeAlert,
  type AccessFacts,
  type Role,
  type Status,
} from '../../src/modules/identity/domain/access-rules.ts';
import { ALERT_VARIANTS, RESET_FORM_PATH, alertText, secondStepChangedText } from '../../src/modules/identity/domain/email-templates.ts';

const ACTOR = '0198f2a0-7b1c-7c4e-8d3a-5f6b7c8d9e01';
const OTHER = '0198f2a0-7b1c-7c4e-8d3a-5f6b7c8d9e02';
const ORIGIN = 'https://panel.evia.test';

const facts = (
  target: Partial<{ id: string; role: Role; status: Status; activatedAt: Date | null; hasPasskey: boolean }> = {},
  activeAdministrators = 2,
): AccessFacts => ({
  actorId: ACTOR,
  activeAdministrators,
  target: { id: OTHER, role: 'editor', status: 'active', activatedAt: new Date('2026-09-01T08:00:00Z'), hasPasskey: false, ...target },
});

describe('the rules of a change of a role (EVM-027 AC1, AC5, D3; decision 10)', () => {
  it('EVM-027 AC1 an Editor becomes Read-only, and the other way round: allowed, no alert (it is not about Administrators)', () => {
    expect(decideRoleChange(facts({ role: 'editor' }), 'read_only')).toEqual({ ok: true, alert: null });
    expect(decideRoleChange(facts({ role: 'read_only' }), 'editor')).toEqual({ ok: true, alert: null });
  });

  it('EVM-027 AC7 whoever becomes or stops being an Administrator is an alert for all; the alert names the direction', () => {
    expect(decideRoleChange(facts({ role: 'editor', hasPasskey: true }), 'administrator')).toEqual({
      ok: true,
      alert: 'administrator_granted',
    });
    expect(decideRoleChange(facts({ role: 'administrator' }), 'editor')).toEqual({ ok: true, alert: 'administrator_revoked' });
    expect(roleChangeAlert('read_only', 'editor')).toBeNull();
  });

  it('EVM-027 AC5 the only active Administrator keeps the role: last_active_administrator, before "your own account" — also when it is the actor', () => {
    expect(decideRoleChange(facts({ role: 'administrator' }, 1), 'editor')).toEqual({ ok: false, refusal: 'last_active_administrator' });
    expect(decideRoleChange(facts({ id: ACTOR, role: 'administrator' }, 1), 'read_only')).toEqual({
      ok: false,
      refusal: 'last_active_administrator',
    });
  });

  it('EVM-027 AC5 an Administrator does not take the role from themselves even when there are others', () => {
    expect(decideRoleChange(facts({ id: ACTOR, role: 'administrator' }, 3), 'editor')).toEqual({
      ok: false,
      refusal: 'own_account_not_allowed',
    });
  });

  it('EVM-027 AC5 an Administrator who is invited (not active) is not counted: the last ACTIVE one is protected, an invited one is not', () => {
    expect(decideRoleChange(facts({ role: 'administrator', status: 'invited' }, 1), 'editor')).toEqual({
      ok: true,
      alert: 'administrator_revoked',
    });
  });

  it('EVM-027 D3 an account without a passkey does not become an Administrator: administrator_passkey_required', () => {
    expect(decideRoleChange(facts({ role: 'editor', hasPasskey: false }), 'administrator')).toEqual({
      ok: false,
      refusal: 'administrator_passkey_required',
    });
  });

  it('EVM-027 D8 the same role and a deactivated account are not a transition (invalid_state_transition) — checked before everything else', () => {
    expect(decideRoleChange(facts({ role: 'editor' }), 'editor')).toEqual({ ok: false, refusal: 'invalid_state_transition' });
    expect(decideRoleChange(facts({ status: 'deactivated' }), 'read_only')).toEqual({ ok: false, refusal: 'invalid_state_transition' });
    expect(decideRoleChange(facts({ id: ACTOR, role: 'administrator' }, 1), 'administrator')).toEqual({
      ok: false,
      refusal: 'invalid_state_transition',
    });
  });
});

describe('the rules of a deactivation and a reactivation (EVM-027 AC2, AC5, AC7)', () => {
  it('EVM-027 AC2 an active or invited account may be deactivated; a deactivated one may not (invalid_state_transition)', () => {
    expect(decideDeactivation(facts({ status: 'active' }))).toEqual({ ok: true, alert: null });
    expect(decideDeactivation(facts({ status: 'invited' }))).toEqual({ ok: true, alert: null });
    expect(decideDeactivation(facts({ status: 'deactivated' }))).toEqual({ ok: false, refusal: 'invalid_state_transition' });
  });

  it('EVM-027 AC5 the only active Administrator and your own account are protected, in that order', () => {
    expect(decideDeactivation(facts({ role: 'administrator' }, 1))).toEqual({ ok: false, refusal: 'last_active_administrator' });
    expect(decideDeactivation(facts({ id: ACTOR, role: 'administrator' }, 1))).toEqual({ ok: false, refusal: 'last_active_administrator' });
    expect(decideDeactivation(facts({ id: ACTOR, role: 'administrator' }, 2))).toEqual({ ok: false, refusal: 'own_account_not_allowed' });
  });

  it('EVM-027 AC7 deactivating an ACTIVE Administrator alerts; an Administrator who never became active does not', () => {
    expect(decideDeactivation(facts({ role: 'administrator' }))).toEqual({ ok: true, alert: 'administrator_deactivated' });
    expect(decideDeactivation(facts({ role: 'administrator', status: 'invited' }, 1))).toEqual({ ok: true, alert: null });
  });

  it('EVM-027 AC2 a reactivated account returns to active when it was activated, to invited when it never was', () => {
    expect(decideReactivation(facts({ status: 'deactivated' }))).toEqual({ ok: true, status: 'active', alert: null });
    expect(decideReactivation(facts({ status: 'deactivated', activatedAt: null }))).toEqual({ ok: true, status: 'invited', alert: null });
  });

  it('EVM-027 AC7 a reactivated Administrator is an alert — but not one who returns to "invited" (never active)', () => {
    expect(decideReactivation(facts({ status: 'deactivated', role: 'administrator' }))).toEqual({
      ok: true,
      status: 'active',
      alert: 'administrator_reactivated',
    });
    expect(decideReactivation(facts({ status: 'deactivated', role: 'administrator', activatedAt: null }))).toEqual({
      ok: true,
      status: 'invited',
      alert: null,
    });
  });

  it('EVM-027 AC2 only a deactivated account is reactivated (an active and an invited one are invalid_state_transition)', () => {
    for (const status of ['active', 'invited'] as const)
      expect(decideReactivation(facts({ status }))).toEqual({ ok: false, refusal: 'invalid_state_transition' });
  });
});

describe('the rules of a reset of the second step and of the end of sessions (EVM-027 AC3, AC4, AC7)', () => {
  it('EVM-027 AC4 an active account of another person: allowed; an Administrator reset is an alert', () => {
    expect(decideSecondStepReset(facts({ role: 'editor' }))).toEqual({ ok: true, alert: null });
    expect(decideSecondStepReset(facts({ role: 'administrator' }))).toEqual({ ok: true, alert: 'administrator_second_step_reset' });
  });

  it('EVM-027 AC4 your own second step is not reset (own_account_not_allowed) — only another Administrator can reset an Administrator', () => {
    expect(decideSecondStepReset(facts({ id: ACTOR, role: 'administrator' }))).toEqual({ ok: false, refusal: 'own_account_not_allowed' });
  });

  it('EVM-027 AC4 an account that is not active has no second step to reset (invalid_state_transition)', () => {
    for (const status of ['invited', 'deactivated'] as const)
      expect(decideSecondStepReset(facts({ status }))).toEqual({ ok: false, refusal: 'invalid_state_transition' });
  });

  it('EVM-027 AC3 the sessions of another person end, any state of the account; ones own are not ended here', () => {
    for (const status of ['invited', 'active', 'deactivated'] as const) expect(decideEndSessions(facts({ status }))).toEqual({ ok: true });
    expect(decideEndSessions(facts({ id: ACTOR }))).toEqual({ ok: false, refusal: 'own_account_not_allowed' });
  });
});

describe('the texts of EVM-027 (docs/ux/flows/e-maile.md nr 5 and 9; SR-INPUT-07, SR-LOG-07)', () => {
  const when = new Date('2026-10-04T12:05:00.000Z'); // 14:05 in Europe/Warsaw (CEST)

  it('EVM-027 AC4 the e-mail after a reset says what happened, that every session ended and until when the setup is open (24 h) — with no link that signs in, no person', () => {
    const { subject, text } = secondStepChangedText({
      panelOrigin: ORIGIN,
      change: 'second_step_reset',
      changedAt: when,
      windowEndsAt: new Date(when.getTime() + 24 * 3_600_000),
    });
    expect(subject).toBe('EVia Manager: zmiana drugiego kroku logowania');
    expect(text).toContain('zmieniono drugi krok logowania 04.10.2026, 14:05:');
    expect(text).toContain('zresetowano drugi krok logowania w panelu administracji. Wszystkie sesje konta zostały zakończone.');
    expect(text).toContain('Skonfiguruj drugi krok do 05.10.2026, 14:05 — po tym czasie poproś administratora o ponowny reset.');
    expect(text).toContain('Jeśli nie zgłaszasz utraty drugiego kroku, od razu skontaktuj się z administratorem.');
    expect(text).not.toContain(RESET_FORM_PATH);
    expect(text).not.toMatch(/#[A-Za-z0-9_-]{20}|token/i);
  });

  it('EVM-027 AC7 each variant of the alert names the event and the time, and no person, no address, no IP', () => {
    const sentences = {
      administrator_granted: 'nadano rolę Administrator jednemu z kont.',
      administrator_revoked: 'odebrano rolę Administrator jednemu z kont.',
      administrator_deactivated: 'dezaktywowano konto z rolą Administrator.',
      administrator_reactivated: 'reaktywowano konto z rolą Administrator.',
      administrator_second_step_reset: 'zresetowano drugi krok logowania konta administratora.',
      administrator_invitation: 'wysłano zaproszenie z rolą Administrator.',
      // EVM-026 (alert 9): a new browser
      administrator_new_browser: 'zalogowano się do konta Administratora z przeglądarki, której to konto wcześniej nie używało.',
      // EVM-028 (alert 9): a method of the second step added or removed, new recovery codes
      administrator_second_step_changed:
        'zmieniono drugi krok logowania konta administratora (dodano albo usunięto metodę albo wygenerowano nowe kody).',
      // EVM-049 (alert 9): a file stopped by the scan
      administrator_media_quarantined: 'plik dodany do zlecenia został zatrzymany przez skan bezpieczeństwa.',
    } as const;
    expect(Object.keys(sentences).sort()).toEqual([...ALERT_VARIANTS].sort());
    for (const variant of ALERT_VARIANTS) {
      const { subject, text } = alertText({ panelOrigin: ORIGIN, variant, occurredAt: when });
      expect(subject, variant).toMatch(/^EVia Manager: alert bezpieczeństwa — /);
      expect(text, variant).toContain(sentences[variant]);
      expect(text, variant).toContain('(04.10.2026, 14:05):');
      expect(text, variant).not.toMatch(/@|#|token|\d+\.\d+\.\d+\.\d+/i);
    }
  });
});

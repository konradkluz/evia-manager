/**
 * The rules of the administration of accounts (EVM-027; decision 10; SR-AUTH-13, SR-SESS-06, SR-SESS-07, SR-AUTHZ-09, SR-LOG-07): who may change what in
 * the account of whom. Pure functions of the facts the use case has read UNDER THE LOCKS (the advisory lock of the Administrators, the actor and the
 * target) — no database, no framework. A verdict is a refusal code or the consequences the use case carries out; the codes are the `409`s of the contract.
 *
 * The order inside a rule is part of the contract (api-guidelines.md): the state of the account first, then the protection of the last active
 * Administrator, and only then "your own account" — so the sole Administrator who tries to demote or deactivate themselves learns the reason that
 * matters (`last_active_administrator`, AC5), and a refusal never depends on who asks beyond that.
 */
import type { AlertVariant } from './email-templates.ts';

export type Role = 'administrator' | 'editor' | 'read_only';
export type Status = 'invited' | 'active' | 'deactivated';

export type Refusal =
  'last_active_administrator' | 'own_account_not_allowed' | 'administrator_passkey_required' | 'invalid_state_transition';

export type Verdict<T extends object = object> = ({ readonly ok: true } & T) | { readonly ok: false; readonly refusal: Refusal };

/** What the use case has read under the locks. */
export interface AccessFacts {
  readonly actorId: string;
  readonly target: {
    readonly id: string;
    readonly role: Role;
    readonly status: Status;
    /** The first activation; null = never activated (decides where a reactivated account returns). */
    readonly activatedAt: Date | null;
    /** Does the account have an ACTIVE passkey (a TOTP factor and recovery codes do not count — an Administrator signs in with a key only). */
    readonly hasPasskey: boolean;
  };
  /** Active, not deleted Administrators now (the target and the actor included). */
  readonly activeAdministrators: number;
}

const refuse = (refusal: Refusal): { ok: false; refusal: Refusal } => ({ ok: false, refusal });
const ALLOWED = Object.freeze({ ok: true as const });

const isOwn = (facts: AccessFacts): boolean => facts.target.id === facts.actorId;
/** Would the account, if it stopped being an Administrator now, leave the system without one? (Only an ACTIVE Administrator counts.) */
const isLastActiveAdministrator = (facts: AccessFacts): boolean =>
  facts.target.role === 'administrator' && facts.target.status === 'active' && facts.activeAdministrators <= 1;

/** The Administrator who stops (or starts) being one: an alert for all (AC7). `null` for a change between the two other roles. */
export function roleChangeAlert(from: Role, to: Role): AlertVariant | null {
  if (to === 'administrator') return 'administrator_granted';
  return from === 'administrator' ? 'administrator_revoked' : null;
}

export function decideRoleChange(facts: AccessFacts, newRole: Role): Verdict<{ readonly alert: AlertVariant | null }> {
  const { target } = facts;
  if (target.status === 'deactivated' || target.role === newRole) return refuse('invalid_state_transition');
  if (isLastActiveAdministrator(facts)) return refuse('last_active_administrator');
  if (isOwn(facts)) return refuse('own_account_not_allowed');
  // D3 (decision of Konrad, 2026-10-19): an Administrator signs in with a passkey only, so the account must already have one.
  if (newRole === 'administrator' && !target.hasPasskey) return refuse('administrator_passkey_required');
  return { ok: true, alert: roleChangeAlert(target.role, newRole) };
}

export function decideDeactivation(facts: AccessFacts): Verdict<{ readonly alert: AlertVariant | null }> {
  const { target } = facts;
  if (target.status === 'deactivated') return refuse('invalid_state_transition');
  if (isLastActiveAdministrator(facts)) return refuse('last_active_administrator');
  if (isOwn(facts)) return refuse('own_account_not_allowed');
  // Only an Administrator who was able to act (active) is "an Administrator who stops being one"; an invited one never was.
  return { ok: true, alert: target.role === 'administrator' && target.status === 'active' ? 'administrator_deactivated' : null };
}

/** A reactivated account returns to `active` when it had been activated, otherwise to `invited` ("Wyślij ponownie" gives it a new invitation). */
export function decideReactivation(
  facts: AccessFacts,
): Verdict<{ readonly status: 'active' | 'invited'; readonly alert: AlertVariant | null }> {
  const { target } = facts;
  if (target.status !== 'deactivated') return refuse('invalid_state_transition');
  const status = target.activatedAt === null ? 'invited' : 'active';
  return { ok: true, status, alert: target.role === 'administrator' && status === 'active' ? 'administrator_reactivated' : null };
}

export function decideSecondStepReset(facts: AccessFacts): Verdict<{ readonly alert: AlertVariant | null }> {
  if (isOwn(facts)) return refuse('own_account_not_allowed');
  if (facts.target.status !== 'active') return refuse('invalid_state_transition');
  return { ok: true, alert: facts.target.role === 'administrator' ? 'administrator_second_step_reset' : null };
}

export function decideEndSessions(facts: AccessFacts): Verdict {
  return isOwn(facts) ? refuse('own_account_not_allowed') : ALLOWED;
}

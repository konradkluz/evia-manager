/**
 * The administration of accounts by an Administrator (EVM-027): a change of a role, a deactivation, a reactivation, the end of all sessions of a
 * user and the reset of the second step (SR-AUTH-13, SR-SESS-06, SR-SESS-07, SR-AUTHZ-09, SR-LOG-07, SR-LOG-03; ASVS V7.4.x, V6.4.4; CWE-362, CWE-285).
 * The guard has decided before this runs: only an Administrator with a fresh key on the web channel gets here.
 *
 * Every operation is ONE transaction with the same fixed order of locks (no deadlock, no race between two Administrators — AC6):
 * 1. the advisory lock `ADMINISTRATOR_LOCK_KEY` (transaction scope: it is released at COMMIT, never held by a pooled connection) — it serialises everything
 *    that decides who the Administrators are, so the count below cannot be stale;
 * 2. the ACTOR is read again under the lock: an Administrator who was deactivated while the request waited is `401 session_revoked` and changes nothing
 *    (the session in the cookie is an old fact; the database is the truth — SR-AUTHZ-09), one whose role changed is `403`;
 * 3. the TARGET `FOR UPDATE` — nonexistent and deleted are `404`; then the shape of `If-Match` and of the body (`428`, `400`) and the version (`412`),
 *    all AFTER the `404` (a stale version never tells that an account exists to one who may not see it — no oracle of existence);
 * 4. the rules (`domain/access-rules.ts`) on the facts read under the locks — a refusal changes nothing;
 * 5. the change, the end of the target's sessions, `loginToken`s and ceremonies, the rows of the outbox (alerts of the Administrators computed AFTER the
 *    change, in the same transaction) and the audit events: identifiers and codes only — no name, no address, no free text.
 *
 * The session of the actor is never touched: the rules refuse every operation on one's own account.
 */
import {
  zChangeUserRoleRequest,
  zChangeUserRolePath,
  zDeactivateUserPath,
  zEndUserSessionsPath,
  zReactivateUserPath,
  zResetUserSecondStepPath,
  zResetUserSecondStepRequest,
} from '@evia/contracts/zod';
import type { User } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import { enqueueEmail, supersedePendingEmails } from '../../../platform/email/email-outbox.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { parseIfMatch } from '../../../platform/http/if-match.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { ADMINISTRATOR_LOCK_KEY, SECOND_STEP_SETUP_WINDOW_MS } from '../domain/constants.ts';
import {
  decideDeactivation,
  decideEndSessions,
  decideReactivation,
  decideRoleChange,
  decideSecondStepReset,
  type AccessFacts,
  type Role,
  type Verdict,
} from '../domain/access-rules.ts';
import type { AlertVariant } from '../domain/email-templates.ts';
import { hashToken, newToken } from '../domain/tokens.ts';
import type { IdentityEvent, ReasonCode } from '../events.ts';
import {
  countActiveAdministrators,
  deletePasskeysOfUser,
  deletePendingTotp,
  deleteTotpFactor,
  insertSetupWindow,
  revokeChallengesOfUser,
  setUserRole,
  setUserStatus,
  supersedeAllOpenLinksOfUser,
  touchUser,
} from '../infrastructure/access-queries.ts';
import { supersedeRecoveryCodes } from '../infrastructure/mfa-queries.ts';
import {
  findUserById,
  hasPasskey,
  listActiveAdministratorIds,
  lockAdministrators,
  revokeLoginAttemptsOfUser,
  revokeSessions,
  type UserRow,
} from '../infrastructure/queries.ts';
import { identityTables, type IdentityDb, type RevokeReason } from '../infrastructure/tables.ts';
import { applyAccountEventToDevices, type AccountEventDeviceMode, type AccountEventReason } from './account-device-events.ts';
import { LoginThrottle } from './login-throttle.ts';
import { representUser } from './user-view.ts';

const changeRolePath = strictObjects(zChangeUserRolePath);
const changeRoleBody = strictObjects(zChangeUserRoleRequest);
const deactivatePath = strictObjects(zDeactivateUserPath);
const reactivatePath = strictObjects(zReactivateUserPath);
const endSessionsPath = strictObjects(zEndUserSessionsPath);
const resetPath = strictObjects(zResetUserSecondStepPath);
const resetBody = strictObjects(zResetUserSecondStepRequest);

const VERIFICATION_REASONS = {
  in_person: 'identity_verified_in_person',
  video_call: 'identity_verified_video_call',
} as const satisfies Record<string, ReasonCode>;

/** What an operation sees once the locks are held and the version is right. */
interface Locked {
  readonly tx: Kysely<Database>;
  readonly db: IdentityDb;
  readonly actor: UserRow;
  readonly target: UserRow;
  readonly facts: AccessFacts;
  readonly now: Date;
  readonly request: EventContext;
}

@Injectable()
export class UserAccessService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #throttle: LoginThrottle;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(LoginThrottle) throttle: LoginThrottle,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#throttle = throttle;
  }

  /** The role of the account changes; its sessions end; Administrators are alerted when someone becomes or stops being one (AC1, AC5, AC7, D3). */
  async changeRole(
    principal: Principal,
    rawParams: unknown,
    rawIfMatch: string | undefined,
    rawBody: unknown,
    context: EventContext,
  ): Promise<User> {
    const { userId } = parseInput(changeRolePath, rawParams) as { userId: string };
    return this.#run(principal, userId, context, async (locked) => {
      const { db, target, actor, now } = locked;
      const { role } = parseInput(changeRoleBody, rawBody) as { role: Role };
      assertVersion(target, rawIfMatch);
      const verdict = refusedOr(decideRoleChange(locked.facts, role));
      await setUserRole(db, target.id, role, actor.id, now);
      await this.#endTargetSessions(locked, 'role_changed');
      await this.#applyToDevices(locked, role === 'read_only' ? 'wipe' : 'sign_out', 'role_changed');
      await this.#alertAdministrators(locked, verdict.alert);
      await this.#publish(locked, {
        type: 'user.role_changed',
        actor: { type: 'user', userId: actor.id },
        outcome: 'success',
        fromCode: target.role,
        toCode: role,
        objectType: 'user',
        objectId: target.id,
      });
      return this.#represent(locked);
    });
  }

  /** The account is deactivated: every way in ends at once (AC2, AC5, AC7). */
  async deactivate(principal: Principal, rawParams: unknown, rawIfMatch: string | undefined, context: EventContext): Promise<User> {
    const { userId } = parseInput(deactivatePath, rawParams) as { userId: string };
    return this.#run(principal, userId, context, async (locked) => {
      const { db, target, actor, now } = locked;
      assertVersion(target, rawIfMatch);
      const verdict = refusedOr(decideDeactivation(locked.facts));
      await setUserStatus(db, target.id, 'deactivated', actor.id, now);
      await this.#endTargetSessions(locked, 'account_deactivated');
      await this.#applyToDevices(locked, 'wipe', 'account_deactivated');
      // The browsers the account was known by are forgotten with their counters (EVM-026 AC5).
      await this.#throttle.forgetBrowsers(locked.tx, target.id);
      // A setup of an authenticator that was never confirmed, every open link (an invitation, a reset, the window of a second step) and every message
      // that waits for the account end with it; the confirmed second steps stay for the reactivation (AC2).
      await deletePendingTotp(db, target.id);
      await supersedeAllOpenLinksOfUser(db, target.id, now);
      await supersedePendingEmails(locked.tx, target.id, 'user_invitation');
      await supersedePendingEmails(locked.tx, target.id, 'password_reset');
      await this.#alertAdministrators(locked, verdict.alert);
      await this.#publish(locked, {
        type: 'user.deactivated',
        actor: { type: 'user', userId: actor.id },
        outcome: 'success',
        objectType: 'user',
        objectId: target.id,
      });
      return this.#represent(locked);
    });
  }

  /** A deactivated account returns with the second steps it had: to `active`, or to `invited` when it was never activated (AC2, AC7). */
  async reactivate(principal: Principal, rawParams: unknown, rawIfMatch: string | undefined, context: EventContext): Promise<User> {
    const { userId } = parseInput(reactivatePath, rawParams) as { userId: string };
    return this.#run(principal, userId, context, async (locked) => {
      const { db, target, actor, now } = locked;
      assertVersion(target, rawIfMatch);
      const verdict = refusedOr(decideReactivation(locked.facts));
      await setUserStatus(db, target.id, verdict.status, actor.id, now);
      await this.#alertAdministrators(locked, verdict.alert);
      await this.#publish(locked, {
        type: 'user.reactivated',
        actor: { type: 'user', userId: actor.id },
        outcome: 'success',
        objectType: 'user',
        objectId: target.id,
      });
      return this.#represent(locked);
    });
  }

  /** Every session of the user ends (all states); the account and its second steps stay. Idempotent (AC3). */
  async endSessions(principal: Principal, rawParams: unknown, context: EventContext): Promise<void> {
    const { userId } = parseInput(endSessionsPath, rawParams) as { userId: string };
    await this.#run(principal, userId, context, async (locked) => {
      refusedOr(decideEndSessions(locked.facts));
      await this.#endTargetSessions(locked, 'sessions_ended');
      await this.#publish(locked, {
        type: 'user.sessions_ended',
        actor: { type: 'user', userId: locked.actor.id },
        outcome: 'success',
        objectType: 'user',
        objectId: locked.target.id,
      });
    });
  }

  /**
   * The second step of the account is erased (keys and the authenticator deleted, recovery codes retired), every session and open link ends and the window
   * of 24 hours to set up a new one opens (AC4, AC7; D1). The owner gets a fixed e-mail without a link that signs in.
   */
  async resetSecondStep(
    principal: Principal,
    rawParams: unknown,
    rawIfMatch: string | undefined,
    rawBody: unknown,
    context: EventContext,
  ): Promise<User> {
    const { userId } = parseInput(resetPath, rawParams) as { userId: string };
    return this.#run(principal, userId, context, async (locked) => {
      const { db, tx, target, actor, now } = locked;
      const { identityVerification } = parseInput(resetBody, rawBody) as { identityVerification: keyof typeof VERIFICATION_REASONS };
      assertVersion(target, rawIfMatch);
      const verdict = refusedOr(decideSecondStepReset(locked.facts));
      await deletePasskeysOfUser(db, target.id);
      await deleteTotpFactor(db, target.id);
      await supersedeRecoveryCodes(db, target.id, now);
      await this.#endTargetSessions(locked, 'second_step_reset');
      await this.#applyToDevices(locked, 'sign_out', 'second_step_reset');
      await this.#throttle.forgetBrowsers(tx, target.id);
      // The links first (a reset link issued before ends too — K6), then the NEW window: a repeated reset replaces the window, it never adds one.
      await supersedeAllOpenLinksOfUser(db, target.id, now);
      await supersedePendingEmails(tx, target.id, 'password_reset');
      await touchUser(db, target.id, actor.id, now);
      await insertSetupWindow(db, {
        userId: target.id,
        tokenHash: hashToken(newToken()),
        issuedAt: now,
        expiresAt: new Date(now.getTime() + SECOND_STEP_SETUP_WINDOW_MS),
      });
      await enqueueEmail(tx, { kind: 'mfa_changed', variant: 'second_step_reset', recipientUserId: target.id, now });
      await this.#alertAdministrators(locked, verdict.alert);
      await this.#publish(locked, {
        type: 'user.second_step_reset',
        actor: { type: 'user', userId: actor.id },
        outcome: 'success',
        reasonCode: VERIFICATION_REASONS[identityVerification],
        objectType: 'user',
        objectId: target.id,
      });
      return this.#represent(locked);
    });
  }

  /** The common frame: one transaction, the fixed order of locks, the actor and the target read under them (see the header). */
  async #run<T>(principal: Principal, userId: string, context: EventContext, work: (locked: Locked) => Promise<T>): Promise<T> {
    const request: EventContext = { ...context, sessionId: principal.sessionId };
    return runInTransaction(this.#db, async (tx) => {
      const db = identityTables(tx);
      await lockAdministrators(db, ADMINISTRATOR_LOCK_KEY);
      const actor = await findUserById(db, principal.userId, true);
      if (actor === undefined || actor.deletedAt !== null || actor.status !== 'active') throw new ProblemException('session_revoked');
      if (actor.role !== 'administrator') throw new ProblemException('forbidden');
      const target = userId === actor.id ? actor : await findUserById(db, userId, true);
      if (target === undefined || target.deletedAt !== null) throw new ProblemException('not_found');

      const now = this.#clock.now();
      const facts: AccessFacts = {
        actorId: actor.id,
        activeAdministrators: await countActiveAdministrators(db),
        target: {
          id: target.id,
          role: target.role,
          status: target.status,
          activatedAt: target.activatedAt,
          hasPasskey: await hasPasskey(db, target.id),
        },
      };
      return work({ tx, db, actor, target, facts, now, request });
    });
  }

  /** The account as the transaction left it (the new version included), parsed with the schema of the contract. */
  async #represent({ tx, db, target, now }: Locked): Promise<User> {
    const after = await findUserById(db, target.id);
    if (after === undefined) throw new ProblemException('internal_error');
    return representUser(tx, after, now);
  }

  /**
   * Every session of the target in every state (an active one, one of the setup of a second step, one after a step-up), the `loginToken`s that wait for a
   * second step and the WebAuthn ceremonies in flight end now — a sign-in started before the change cannot finish after it. One audit event per session.
   */
  async #endTargetSessions({ db, target, actor, now, request, tx }: Locked, reason: Extract<RevokeReason, ReasonCode>): Promise<void> {
    for (const sessionId of await revokeSessions(db, { userId: target.id }, reason, now)) {
      const revoked: IdentityEvent = {
        type: 'session.revoked',
        actor: { type: 'user', userId: actor.id },
        outcome: 'success',
        reasonCode: reason,
        objectType: 'session',
        objectId: sessionId,
      };
      await this.#events.publish(tx, revoked, request);
    }
    await revokeLoginAttemptsOfUser(db, target.id, now);
    await revokeChallengesOfUser(db, target.id, now);
  }

  /** The phones of the target follow the event of the account in the same transaction (EVM-095 AC5; table M-02). */
  #applyToDevices({ tx, target, actor, now, request }: Locked, mode: AccountEventDeviceMode, reason: AccountEventReason): Promise<void> {
    return applyAccountEventToDevices(tx, this.#events, {
      userId: target.id,
      mode,
      reason,
      actor: { type: 'user', userId: actor.id },
      context: request,
      now,
    });
  }

  /** One alert per ACTIVE Administrator — counted AFTER the change, the actor included (SR-LOG-07); the text names no one. */
  async #alertAdministrators({ tx, db, now }: Locked, variant: AlertVariant | null): Promise<void> {
    if (variant === null) return;
    for (const recipientUserId of await listActiveAdministratorIds(db)) {
      await enqueueEmail(tx, { kind: 'administrator_alert', variant, recipientUserId, now });
    }
  }

  #publish({ tx, request }: Locked, event: IdentityEvent): Promise<void> {
    return this.#events.publish(tx, event, request);
  }
}

/**
 * The precondition of a command on the account (ADR-0004): `If-Match` is read only AFTER the account was found, so the order is the one of the contract —
 * `404` (nonexistent, deleted), then the shape of the header and the body (`428`, `400`), then the version (`412`). Decided under the lock of the row.
 */
function assertVersion(target: UserRow, rawIfMatch: string | undefined): void {
  if (parseIfMatch(rawIfMatch) !== target.version) throw new ProblemException('version_conflict');
}

/** The verdict of a rule: a refusal is the `409` of its code (nothing has been changed yet), otherwise the consequences the rule decided. */
function refusedOr<T extends object>(verdict: Verdict<T>): { readonly ok: true } & T {
  if (!verdict.ok) throw new ProblemException(verdict.refusal);
  return verdict;
}

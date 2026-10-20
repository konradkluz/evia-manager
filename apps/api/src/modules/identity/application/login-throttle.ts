/**
 * Protection against guessing passwords and codes (EVM-026; SR-AUTH-05, SR-AUTH-15, SR-LOG-06, SR-LOG-07; AB-01, RR-26; ASVS V6.3.1; CWE-307, CWE-367).
 * The rules are the pure state machine of `domain/throttle-policy.ts`; this class is the rows, the key and the consequences:
 *
 * - `reserve` — before a try is verified: under the lock of the row of the scope it takes one of the ten tries of the window, or refuses (a lock, or ten
 *   tries already reserved). It is the same call for the first and the second step, so ten failures of both kinds together lock — one counter. The caller
 *   then waits (OUTSIDE a transaction, `delayMs`), verifies EXACTLY once and settles the try with `fail` or `release`.
 * - `fail` — the try was wrong. When it is the one that brings the lock, the consequences happen in the SAME transaction, once (the transition is decided
 *   under the lock of the row): the metric, the alert, the open `loginToken`s of the scope end, the audit event (for an account that exists) and the e-mail
 *   about the lock (one per lock, at most three a day). An address without an account leaves only the metric and the alert: no object, no e-mail.
 * - `release` — the try was right: it gives back its own reservation and nothing else. A correct password does NOT zero the counter (RR-26).
 *
 * The key of a scope is an HMAC (`domain/throttle-keys.ts`): the table holds no address. The scope of a sign-in is the browser the account knows (own
 * counter, so a stranger's tries cannot lock the owner out of the browser he uses) or else the account (the browsers it does not know).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { SecurityAlertCode } from '../../../platform/alerts/security-alerts.ts';
import { enqueueSecurityAlert } from '../../../platform/alerts/security-alerts.ts';
import type { AppConfig } from '../../../platform/config/config.ts';
import type { Database } from '../../../platform/database/database.ts';
import { countRecentEmails, enqueueEmail } from '../../../platform/email/email-outbox.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Counter, MetricsRegistry } from '../../../platform/metrics/metrics.ts';
import { APP_CONFIG, EVENT_BUS, METRICS } from '../../../platform/tokens.ts';
import { LOCK_EMAIL_DAILY_LIMIT } from '../domain/constants.ts';
import { lockVariant } from '../domain/email-templates.ts';
import { accountKey, browserKey, spikeKey } from '../domain/throttle-keys.ts';
import {
  confirm,
  isPasswordFailure,
  pendingDelay,
  release as releaseState,
  retryAfterSeconds,
  reserve as reserveState,
  THROTTLE_RETENTION_MS,
  type CountedFailure,
  type LockCause,
  type Reservation,
  type Reserved,
} from '../domain/throttle-policy.ts';
import type { IdentityEvent } from '../events.ts';
import { findUserById, revokeLoginAttemptsOfScope } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import {
  countSpike,
  deleteBrowsersOfUser,
  deleteExpiredLoginAttempts,
  deleteExpiredThrottles,
  deletePasswordThrottle,
  deleteStaleBrowsers,
  deleteThrottles,
  lockThrottle,
  readThrottle,
  saveThrottle,
} from '../infrastructure/throttle-queries.ts';
import { DEVICE_RETENTION_MS } from '../domain/constants.ts';

export const ACCOUNT_LOCKOUTS_METRIC = 'evia_account_lockouts_total';

/** Where a try is counted: the account (for the browsers it does not know) or one browser it knows. The `kind` creates the row; the row remembers it. */
export interface ThrottleScope {
  readonly key: Buffer;
  readonly kind: 'account' | 'browser';
}

/** What a settled try needs: the scope, the reservation it holds, and whether the account exists and is active (only then a lock tells the owner). */
export interface ThrottleTicket {
  readonly scope: ThrottleScope;
  readonly reserved: Reserved | undefined;
  readonly active: boolean;
}

const SECOND_STEP_FAILURES: readonly CountedFailure[] = ['totp_failed', 'recovery_code_failed', 'passkey_failed'];
const DAY_MS = 24 * 60 * 60_000;

@Injectable()
export class LoginThrottle {
  readonly #key: Buffer;
  readonly #alerts: AppConfig['loginAlerts'];
  readonly #events: EventBus;
  readonly #lockouts: Counter;

  constructor(@Inject(APP_CONFIG) config: AppConfig, @Inject(EVENT_BUS) events: EventBus, @Inject(METRICS) metrics: MetricsRegistry) {
    this.#key = config.loginThrottleKey;
    this.#alerts = config.loginAlerts;
    this.#events = events;
    this.#lockouts = metrics.counter(ACCOUNT_LOCKOUTS_METRIC, ['cause']);
  }

  accountScope(email: string): ThrottleScope {
    return { key: accountKey(this.#key, email), kind: 'account' };
  }

  browserScope(deviceId: string): ThrottleScope {
    return { key: browserKey(this.#key, deviceId), kind: 'browser' };
  }

  /** Takes one try of the window (see the header); a granted try carries what `fail` and `release` need and how long the caller waits first. */
  async reserve(tx: Kysely<Database>, scope: ThrottleScope, now: Date): Promise<Reservation> {
    const db = identityTables(tx);
    const stored = await lockThrottle(db, scope.key, scope.kind, now);
    const { state, reservation } = reserveState(stored.state, now);
    if (reservation.granted) await saveThrottle(db, scope.key, state);
    return reservation;
  }

  /** The wait a try would be given now — a look, nothing is reserved (the wait before a second step, which reserves inside its own transaction). */
  async delayFor(tx: Kysely<Database>, key: Buffer, now: Date): Promise<number> {
    return pendingDelay(await readThrottle(identityTables(tx), key), now);
  }

  /** How long the scope stays locked from `now` — undefined when no lock holds (the caller of a verification that has just failed asks whether it brought the lock). */
  async lockRemaining(tx: Kysely<Database>, scope: ThrottleScope, now: Date): Promise<number | undefined> {
    const state = await readThrottle(identityTables(tx), scope.key);
    return state?.lockedUntil != null && state.lockedUntil > now ? retryAfterSeconds(state, now) : undefined;
  }

  /** The try was right: only its own reservation is given back. */
  async release(tx: Kysely<Database>, scope: ThrottleScope, reserved: Reserved, now: Date): Promise<void> {
    const db = identityTables(tx);
    const stored = await lockThrottle(db, scope.key, scope.kind, now);
    await saveThrottle(db, scope.key, releaseState(stored.state, reserved, now));
  }

  /** The try was wrong (see the header). `userId` is the account that exists and is active, otherwise `undefined`. */
  async fail(
    tx: Kysely<Database>,
    ticket: ThrottleTicket,
    input: { readonly reason: CountedFailure; readonly userId: string | undefined; readonly now: Date; readonly context: EventContext },
  ): Promise<void> {
    const { scope } = ticket;
    const { reason, userId, now, context } = input;
    const db = identityTables(tx);
    const cause: LockCause = SECOND_STEP_FAILURES.includes(reason) ? 'second_step' : 'password';
    const stored = await lockThrottle(db, scope.key, scope.kind, now);
    const confirmation = confirm(stored.state, ticket.reserved, cause, now);
    await saveThrottle(db, scope.key, confirmation.state);

    if (isPasswordFailure(reason) && (await countSpike(db, spikeKey(this.#key), now)) === this.#alerts.passwordFailures + 1) {
      await this.#alert(tx, 'login_failure_spike', now, context);
    }
    if (cause === 'second_step' && confirmation.secondStepFailures === this.#alerts.secondStepFailures) {
      await this.#alert(tx, 'second_step_failure_spike', now, context);
    }
    if (confirmation.locked !== null) {
      await this.#lock(tx, {
        scope,
        kind: stored.scope,
        cause: confirmation.locked,
        userId: ticket.active ? userId : undefined,
        now,
        context,
      });
    }
  }

  /** The end of a reset of the password: the lock whose cause is the password goes (AC7) — a failure of the second step in the window keeps its lock. */
  async liftPasswordLock(tx: Kysely<Database>, email: string): Promise<void> {
    await deletePasswordThrottle(identityTables(tx), accountKey(this.#key, email));
  }

  /** The browsers of the account are forgotten with their counters (a deactivation, a reset of the second step, a reset of the password; AC5). */
  async forgetBrowsers(tx: Kysely<Database>, userId: string): Promise<void> {
    await this.dropBrowserCounters(tx, await deleteBrowsersOfUser(identityTables(tx), userId));
  }

  /** The counters of browsers that no longer exist. */
  async dropBrowserCounters(tx: Kysely<Database>, deviceIds: readonly string[]): Promise<void> {
    await deleteThrottles(
      identityTables(tx),
      deviceIds.map((id) => browserKey(this.#key, id)),
    );
  }

  /**
   * The retention (M6; RODO art. 5(1)(e)): counters past their time, first steps 30 minutes after they expired (they carry the HMAC of the address), and
   * browsers not seen for 30 days with their counters.
   */
  async purge(
    tx: Kysely<Database>,
    now: Date,
  ): Promise<{ readonly throttles: number; readonly browsers: number; readonly loginAttempts: number }> {
    const db = identityTables(tx);
    const stale = await deleteStaleBrowsers(db, new Date(now.getTime() - DEVICE_RETENTION_MS));
    await this.dropBrowserCounters(tx, stale);
    return {
      throttles: await deleteExpiredThrottles(db, now),
      browsers: stale.length,
      loginAttempts: await deleteExpiredLoginAttempts(db, new Date(now.getTime() - THROTTLE_RETENTION_MS)),
    };
  }

  #alert(tx: Kysely<Database>, code: SecurityAlertCode, now: Date, context: EventContext): Promise<void> {
    return enqueueSecurityAlert(tx, { code, occurredAt: now, traceId: context.traceId });
  }

  async #lock(
    tx: Kysely<Database>,
    lock: {
      readonly scope: ThrottleScope;
      readonly kind: ThrottleScope['kind'] | 'spike';
      readonly cause: LockCause;
      readonly userId: string | undefined;
      readonly now: Date;
      readonly context: EventContext;
    },
  ): Promise<void> {
    const { scope, cause, userId, now, context } = lock;
    this.#lockouts.increment({ cause });
    await this.#alert(tx, 'account_locked', now, context);
    if (userId === undefined) return;
    const db = identityTables(tx);
    // The open first steps of THIS scope end now — a `loginToken` must not outlive the lock and go on guessing. Another scope of the account is not locked.
    await revokeLoginAttemptsOfScope(db, scope.key, now);
    const event: IdentityEvent = {
      type: lock.kind === 'browser' ? 'account.browser_locked' : 'account.locked',
      actor: { type: 'anonymous' },
      outcome: 'denied',
      reasonCode: cause,
      objectType: 'user',
      objectId: userId,
    };
    await this.#events.publish(tx, event, context);
    const user = await findUserById(db, userId);
    if (user?.status !== 'active' || user.deletedAt !== null) return;
    if ((await countRecentEmails(tx, userId, 'account_locked', new Date(now.getTime() - DAY_MS))) >= LOCK_EMAIL_DAILY_LIMIT) return;
    await enqueueEmail(tx, {
      kind: 'account_locked',
      variant: lockVariant(cause, lock.kind === 'browser' ? 'browser' : 'account'),
      recipientUserId: userId,
      now,
    });
  }
}

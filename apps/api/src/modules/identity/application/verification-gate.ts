/**
 * The counter against guessing for the verifications of a SIGNED-IN person: the full re-authentication, the change of the password and the step-up
 * (EVM-028 K2, EVM-026 rule 2; SR-AUTH-05, ASVS V6.3.1; CWE-307). Without it a thief of a session would guess the password or a code of the app through
 * these doors with no lock at all. Every try goes through the SAME counter as a sign-in — `LoginThrottle.reserve` → the wait → ONE verification →
 * `LoginFailures.record(…, ticket)` (a failure) or `release` (it was right); there is no other place a failed try is written.
 *
 * The scope is the one of a sign-in (the hybrid of EVM-026): the browser the account knows (the cookie `__Host-evia_device` of THIS account), else the account.
 * When the lock already holds, nothing is verified: the answer is `429` and the session ENDS (a thief must not go on in it — the recommendation of the UX
 * review). The try that brings the lock ends the session in the same transaction and is answered `429` as well.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import type { Sleeper } from '../../../platform/http/response-floor.ts';
import { CLOCK, DATABASE, EVENT_BUS, SLEEPER } from '../../../platform/tokens.ts';
import type { IdentityEvent } from '../events.ts';
import { findUserById, revokeSessions } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import type { ClientInfo } from './activation.service.ts';
import { BrowserRegister } from './browser-register.ts';
import { LoginFailures } from './login-failures.ts';
import { LoginThrottle, type ThrottleTicket } from './login-throttle.ts';

/** The audit event that tells a refused verification (the action of the operation that asked for it). */
export type VerificationEvent = 'step_up.failed' | 'reauthentication.failed' | 'password.changed';

export interface VerificationTry {
  readonly ticket: ThrottleTicket;
  readonly userId: string;
  readonly principal: Principal;
  readonly event: VerificationEvent;
}

/** What `fail` reports: the try brought the lock (the session has ended with it) and for how long. */
export interface FailedTry {
  readonly lockedForSeconds: number | undefined;
}

@Injectable()
export class VerificationGate {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #sleeper: Sleeper;
  readonly #events: EventBus;
  readonly #throttle: LoginThrottle;
  readonly #failures: LoginFailures;
  readonly #browsers: BrowserRegister;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(SLEEPER) sleeper: Sleeper,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(LoginThrottle) throttle: LoginThrottle,
    @Inject(LoginFailures) failures: LoginFailures,
    @Inject(BrowserRegister) browsers: BrowserRegister,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#sleeper = sleeper;
    this.#events = events;
    this.#throttle = throttle;
    this.#failures = failures;
    this.#browsers = browsers;
  }

  /**
   * Takes one try of the window and waits what the failures so far demand (OUTSIDE any transaction, BEFORE the verification).
   * @throws `429 rate_limited` with `Retry-After` — after the session has ended — when the scope is locked or its ten tries are used
   */
  async begin(
    principal: Principal,
    deviceToken: string | undefined,
    client: ClientInfo,
    event: VerificationEvent,
  ): Promise<VerificationTry> {
    const now = this.#clock.now();
    const user = await findUserById(identityTables(this.#db), principal.userId);
    // A session of an account that is gone has nothing to verify: the guard let it through a moment ago, and the use case ends it as any ended session.
    if (user === undefined) throw new ProblemException('session_revoked');
    const known = await this.#browsers.known(principal.userId, deviceToken);
    const scope = known === undefined ? this.#throttle.accountScope(user.email) : this.#throttle.browserScope(known.id);
    const reservation = await runInTransaction(this.#db, (transaction) => this.#throttle.reserve(transaction, scope, now));
    if (!reservation.granted) {
      await runInTransaction(this.#db, (transaction) => this.#endSession(transaction, principal, client, event, now));
      throw new ProblemException('rate_limited', { retryAfterSeconds: reservation.retryAfterSeconds });
    }
    if (reservation.delayMs > 0) await this.#sleeper.sleep(reservation.delayMs);
    return { ticket: { scope, reserved: reservation.reserved, active: true }, userId: principal.userId, principal, event };
  }

  /** The try was right (or was not a guess): it gives back its reservation. */
  async pass(transaction: Kysely<Database>, attempt: VerificationTry, now: Date): Promise<void> {
    const { reserved, scope } = attempt.ticket;
    if (reserved !== undefined) await this.#throttle.release(transaction, scope, reserved, now);
  }

  /**
   * The try was wrong: it is counted (and audited as a failed sign-in by `LoginFailures`, the only place a failure is written). When it brings the lock the
   * session ends in this transaction; the caller answers `429` after the commit.
   */
  async fail(
    transaction: Kysely<Database>,
    attempt: VerificationTry,
    reason: 'bad_password' | 'passkey_failed' | 'totp_failed',
    client: ClientInfo,
    now: Date,
  ): Promise<FailedTry> {
    await this.#failures.record(transaction, reason, attempt.userId, client.context, attempt.ticket);
    const lockedForSeconds = await this.#throttle.lockRemaining(transaction, attempt.ticket.scope, now);
    if (lockedForSeconds !== undefined) await this.#endSession(transaction, attempt.principal, client, attempt.event, now);
    return { lockedForSeconds };
  }

  async #endSession(
    transaction: Kysely<Database>,
    principal: Principal,
    client: ClientInfo,
    event: VerificationEvent,
    now: Date,
  ): Promise<void> {
    const actor = { type: 'user', userId: principal.userId } as const;
    for (const sessionId of await revokeSessions(identityTables(transaction), { sessionId: principal.sessionId }, 'step_up_failed', now)) {
      const ended: IdentityEvent = {
        type: 'session.revoked',
        actor,
        outcome: 'success',
        reasonCode: 'rate_limited',
        objectType: 'session',
        objectId: sessionId,
      };
      await this.#events.publish(transaction, ended, { ...client.context, sessionId });
    }
    const refused: IdentityEvent = {
      type: event,
      actor,
      outcome: 'denied',
      reasonCode: 'rate_limited',
      objectType: 'session',
      objectId: principal.sessionId,
    };
    await this.#events.publish(transaction, refused, { ...client.context, sessionId: principal.sessionId });
  }
}

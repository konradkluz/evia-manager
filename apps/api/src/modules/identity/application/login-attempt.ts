/**
 * The first step of a sign-in, as the second step finds it again (EVM-067 AC4; EVM-023 B3; EVM-026 AC1–AC3): shared by the passkey, the code of the authenticator
 * app and the recovery code, so that all three count against ONE budget of failures — the budget of the scope the first step was counted in (the account for
 * the browsers it does not know, or the one browser it knows; fixed when the `loginToken` is made, not by the cookie of the second request) — and refuse
 * in the same way.
 *
 * An attempt that is unknown, already spent or of another account's token is no first step at all (`unauthenticated` — one answer for all); one that
 * ran out is `login_expired` and is audited. A failed second step does not spend the attempt (the person may retry) but is counted on it: the fifth
 * ends it, whatever the method — and on the scope, where ten failures lock (`429`, no session, even for a correct code). The order of a try:
 *
 * 1. `wait` — OUTSIDE any transaction and BEFORE anything is verified: the delay that the failures so far demand (a client that drops the connection after
 *    the verification would otherwise guess at full speed);
 * 2. `open` — in the transaction of the method: the attempt is found, then the try is RESERVED under the lock of the scope (a lock or ten tries refuse it,
 *    whether the token is still good or already ended by that very lock);
 * 3. the method verifies exactly once and settles the try: `fail` or `pass`.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventContext } from '../../../platform/events/event-bus.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import type { Sleeper } from '../../../platform/http/response-floor.ts';
import { CLOCK, DATABASE, SLEEPER } from '../../../platform/tokens.ts';
import { LOGIN_MAX_FAILED_SECOND_STEPS } from '../domain/constants.ts';
import { hashToken } from '../domain/tokens.ts';
import { findLoginAttempt, findUserById, recordFailedKey, type LoginAttemptRecord } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import type { LoginFailure } from './login-failures.ts';
import { LoginFailures } from './login-failures.ts';
import { LoginThrottle, type ThrottleScope, type ThrottleTicket } from './login-throttle.ts';

export type AttemptRefusal =
  | { readonly refusal: 'unauthenticated' | 'login_expired' }
  /** The scope is locked, or its ten tries are used: the same `429` as the limit of an address. */
  | { readonly refusal: 'rate_limited'; readonly retryAfterSeconds: number };
export type OpenedAttempt = { readonly attempt: LoginAttemptRecord; readonly ticket: ThrottleTicket } | AttemptRefusal;

/** The refusals the second-step methods raise after their transaction committed (the counter and the audit rows of a failed try stay). */
export function problemOf(refused: { readonly refusal: string; readonly retryAfterSeconds?: number }): ProblemException {
  return new ProblemException(
    refused.refusal as ConstructorParameters<typeof ProblemException>[0],
    refused.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: refused.retryAfterSeconds },
  );
}

@Injectable()
export class LoginAttemptGate {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #sleeper: Sleeper;
  readonly #failures: LoginFailures;
  readonly #throttle: LoginThrottle;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(SLEEPER) sleeper: Sleeper,
    @Inject(LoginFailures) failures: LoginFailures,
    @Inject(LoginThrottle) throttle: LoginThrottle,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#sleeper = sleeper;
    this.#failures = failures;
    this.#throttle = throttle;
  }

  /** The wait the failures so far demand; nothing for a token that names no attempt. Call it OUTSIDE a transaction, before `open`. */
  async wait(loginToken: string): Promise<void> {
    const attempt = await findLoginAttempt(identityTables(this.#db), hashToken(loginToken));
    if (attempt === undefined) return;
    const scope = await this.#scopeOf(this.#db, attempt);
    const delay = await this.#throttle.delayFor(this.#db, scope.key, this.#clock.now());
    if (delay > 0) await this.#sleeper.sleep(delay);
  }

  async open(transaction: Kysely<Database>, loginToken: string, now: Date, context: EventContext): Promise<OpenedAttempt> {
    const attempt = await findLoginAttempt(identityTables(transaction), hashToken(loginToken));
    if (attempt === undefined) return { refusal: 'unauthenticated' };
    const scope = await this.#scopeOf(transaction, attempt);
    // The lock is decided BEFORE the state of the token: the token that the lock itself ended gets the same 429 as any other try during the lock.
    const reservation = await this.#throttle.reserve(transaction, scope, now);
    if (!reservation.granted) return { refusal: 'rate_limited', retryAfterSeconds: reservation.retryAfterSeconds };
    const ticket: ThrottleTicket = { scope, reserved: reservation.reserved, active: true };
    if (attempt.usedAt === null && attempt.expiresAt > now) return { attempt, ticket };
    // Not a guess: the try gives its reservation back.
    await this.#throttle.release(transaction, scope, reservation.reserved, now);
    if (attempt.usedAt !== null) return { refusal: 'unauthenticated' };
    await this.#failures.record(transaction, 'login_expired', attempt.userId, context);
    return { refusal: 'login_expired' };
  }

  /** Counts a failed second step on the attempt (the fifth ends it) and on the scope (the tenth locks), and audits it. */
  async fail(
    transaction: Kysely<Database>,
    attempt: LoginAttemptRecord,
    ticket: ThrottleTicket,
    reason: Extract<LoginFailure, 'passkey_failed' | 'totp_failed' | 'recovery_code_failed'>,
    now: Date,
    context: EventContext,
  ): Promise<void> {
    await recordFailedKey(identityTables(transaction), attempt.id, now, LOGIN_MAX_FAILED_SECOND_STEPS);
    await this.#failures.record(transaction, reason, attempt.userId, context, ticket);
  }

  /** The key (or the code) was right: the try gives its reservation back. */
  async pass(transaction: Kysely<Database>, ticket: ThrottleTicket, now: Date): Promise<void> {
    if (ticket.reserved !== undefined) await this.#throttle.release(transaction, ticket.scope, ticket.reserved, now);
  }

  /** A `loginToken` made before 0040 has no scope: it is counted in the account's, like a browser the account does not know. */
  async #scopeOf(db: Kysely<Database>, attempt: LoginAttemptRecord): Promise<ThrottleScope> {
    if (attempt.throttleKey !== null) return { key: attempt.throttleKey, kind: 'account' };
    const user = await findUserById(identityTables(db), attempt.userId);
    return this.#throttle.accountScope(user?.email ?? attempt.userId);
  }
}

/**
 * Failed sign-ins (SR-AUTH-05, SR-LOG-03, SR-LOG-06; ASVS V16.3.1–V16.3.3): the reason is known only inside — it goes to
 * the audit trail (a code, the identifier of the account when there is one, the address prefix added by `audit`), to
 * a counter with the single label `reason` and — for the six reasons that are guesses — to the counter against guessing (`LoginThrottle`; EVM-026).
 * The client always gets the same answer for the first step. Nothing that identifies a person is recorded: no password, no token and no e-mail address
 * in the audit trail or the logs.
 *
 * A DELIBERATE CHANGE of the rule (EVM-026, decision of Konrad 2026-10-20): the counters against guessing sit in PostgreSQL under an HMAC-SHA-256 of the
 * normalised address (key of the server `LOGIN_THROTTLE_KEY`), where this module used to keep no address "not even a hash". Without it the lock of an
 * address that has no account (and so the same answer for every address) cannot be counted. The key makes the value useless to anyone who only has
 * the database; the table is cleared 30 minutes after a window ends (RODO art. 5(1)(e); `rodo.md`, DO-P).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Counter, MetricsRegistry } from '../../../platform/metrics/metrics.ts';
import { CLOCK, EVENT_BUS, METRICS } from '../../../platform/tokens.ts';
import { isCountedFailure } from '../domain/throttle-policy.ts';
import type { IdentityEvent } from '../events.ts';
import { LoginThrottle, type ThrottleTicket } from './login-throttle.ts';

export type LoginFailure =
  | 'bad_password'
  | 'unknown_user'
  | 'not_active'
  | 'passkey_failed'
  | 'totp_failed'
  | 'recovery_code_failed'
  | 'login_expired'
  | 'mfa_setup_expired';

export const LOGIN_FAILURES_METRIC = 'evia_login_failures_total';

@Injectable()
export class LoginFailures {
  readonly #events: EventBus;
  readonly #counter: Counter;
  readonly #throttle: LoginThrottle;
  readonly #clock: Clock;

  constructor(
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(METRICS) metrics: MetricsRegistry,
    @Inject(LoginThrottle) throttle: LoginThrottle,
    @Inject(CLOCK) clock: Clock,
  ) {
    this.#events = events;
    this.#counter = metrics.counter(LOGIN_FAILURES_METRIC, ['reason']);
    this.#throttle = throttle;
    this.#clock = clock;
  }

  /**
   * Writes `login.failed` with the transaction of the caller (an unknown account is an anonymous actor without an object),
   * counts it and — when it is a guess and the caller holds a ticket of its scope — settles the try against the counter of guessing (this is
   * the one place where a failed try is counted, and so the one place a lock can start).
   */
  async record(
    transaction: Kysely<Database>,
    reason: LoginFailure,
    userId: string | undefined,
    context: EventContext,
    ticket?: ThrottleTicket,
  ): Promise<void> {
    const event: IdentityEvent =
      userId === undefined
        ? { type: 'login.failed', actor: { type: 'anonymous' }, outcome: 'failed', reasonCode: reason, objectType: 'user' }
        : {
            type: 'login.failed',
            actor: { type: 'user', userId },
            outcome: 'failed',
            reasonCode: reason,
            objectType: 'user',
            objectId: userId,
          };
    await this.#events.publish(transaction, event, context);
    this.#counter.increment({ reason });
    if (ticket !== undefined && isCountedFailure(reason)) {
      await this.#throttle.fail(transaction, ticket, { reason, userId, now: this.#clock.now(), context });
    }
  }
}

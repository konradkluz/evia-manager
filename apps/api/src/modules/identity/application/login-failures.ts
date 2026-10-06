/**
 * Failed sign-ins (SR-AUTH-05, SR-LOG-03, SR-LOG-06; ASVS V16.3.1–V16.3.3): the reason is known only inside — it goes to
 * the audit trail (a code, the identifier of the account when there is one, the address prefix added by `audit`) and to
 * a counter with the single label `reason`. The client always gets the same answer for the first step. Nothing that
 * identifies a person is recorded: no password, no e-mail address (not even a fragment or a hash of it), no token.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Counter, MetricsRegistry } from '../../../platform/metrics/metrics.ts';
import { EVENT_BUS, METRICS } from '../../../platform/tokens.ts';
import type { IdentityEvent } from '../events.ts';

export type LoginFailure = 'bad_password' | 'unknown_user' | 'not_active' | 'passkey_failed' | 'login_expired';

export const LOGIN_FAILURES_METRIC = 'evia_login_failures_total';

@Injectable()
export class LoginFailures {
  readonly #events: EventBus;
  readonly #counter: Counter;

  constructor(@Inject(EVENT_BUS) events: EventBus, @Inject(METRICS) metrics: MetricsRegistry) {
    this.#events = events;
    this.#counter = metrics.counter(LOGIN_FAILURES_METRIC, ['reason']);
  }

  /**
   * Writes `login.failed` with the transaction of the caller (an unknown account is an anonymous actor without an object)
   * and counts it.
   */
  async record(transaction: Kysely<Database>, reason: LoginFailure, userId: string | undefined, context: EventContext): Promise<void> {
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
  }
}

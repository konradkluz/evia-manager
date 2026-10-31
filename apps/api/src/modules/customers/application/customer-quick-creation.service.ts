/** The implementation of the port `CUSTOMER_QUICK_CREATION` (see `system-ports.ts`; EVM-099): the rules of the panel, INSERT only, the device of the session recorded. */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import type { FieldIssue } from '../../../platform/input/field-issues.ts';
import { CLOCK, EVENT_BUS } from '../../../platform/tokens.ts';
import { normalizeQuickCustomer, type QuickCustomerInput } from '../domain/quick-customer.ts';
import type { CustomerEvent } from '../events.ts';
import { countCustomersCreatedBy, insertCustomer } from '../infrastructure/customer-store.ts';
import { customerTables } from '../infrastructure/tables.ts';
import type { CustomerQuickCreation } from '../system-ports.ts';

@Injectable()
export class CustomerQuickCreationService implements CustomerQuickCreation {
  readonly #clock: Clock;
  readonly #events: EventBus;

  constructor(@Inject(CLOCK) clock: Clock, @Inject(EVENT_BUS) events: EventBus) {
    this.#clock = clock;
    this.#events = events;
  }

  check(input: QuickCustomerInput): readonly FieldIssue[] {
    const normalized = normalizeQuickCustomer(input);
    return normalized.ok ? [] : normalized.errors;
  }

  async create(
    tx: Kysely<Database>,
    principal: Principal,
    deviceId: string,
    input: QuickCustomerInput,
    context: EventContext,
  ): Promise<'created' | 'invalid' | 'id_conflict'> {
    const normalized = normalizeQuickCustomer(input);
    if (!normalized.ok) return 'invalid';
    const row = await insertCustomer(customerTables(tx), normalized.customer, principal.userId, this.#clock.now(), deviceId);
    if (row === undefined) return 'id_conflict';
    const event: CustomerEvent = {
      type: 'customer.created',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      objectType: 'customer',
      objectId: row.id,
    };
    await this.#events.publish(tx, event, context);
    return 'created';
  }

  countCreatedBy(tx: Kysely<Database>, deviceId: string, since: Date): Promise<number> {
    return countCustomersCreatedBy(customerTables(tx), deviceId, since);
  }
}

/**
 * The events of the journal (EVM-038 AC1, AC5; SR-API-06, SR-LOG-03, SR-DATA-01; ASVS V2.3.3, V16.5.3): the subscriber that turns the
 * domain events of `work-orders` (the creation, the status, the data and the scope — EVM-035), `procedures` and `payments` (the status of
 * a milestone — EVM-054) into entries of `kind = event`. The event bus is synchronous and runs the handler
 * INSIDE the transaction of the change, so the entry and the change are ONE unit: a failing write rolls the change back with its
 * audit record and its idempotency record (fail closed). The handler writes nothing but what the domain events carry — codes,
 * identifiers and names of fields, validated with a strict schema (`domain/event-payload.ts`); the names of parties and stages are
 * read from the current data when the journal is shown. A failure is logged by the platform with the trace identifier only.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import { CLOCK, EVENT_BUS } from '../../../platform/tokens.ts';
import { PAYMENT_MILESTONE_JOURNAL_EVENT_TYPES, type PaymentMilestoneStatusChangedEvent } from '../../payments/index.ts';
import { PROCEDURE_JOURNAL_EVENT_TYPES, type StageJournalChangeEvent } from '../../procedures/index.ts';
import { WORK_ORDER_JOURNAL_EVENT_TYPES, type WorkOrderJournalChangeEvent } from '../../work-orders/index.ts';
import { toJournalEvent, type CreatedEvent, type JournalSourceEvent } from '../domain/event-payload.ts';
import { timelineTables } from '../infrastructure/tables.ts';
import { insertEvent } from '../infrastructure/timeline-store.ts';

@Injectable()
export class JournalEventRecorder implements OnModuleInit {
  readonly #events: EventBus;
  readonly #clock: Clock;

  constructor(@Inject(EVENT_BUS) events: EventBus, @Inject(CLOCK) clock: Clock) {
    this.#events = events;
    this.#clock = clock;
  }

  onModuleInit(): void {
    const handle = (tx: Kysely<Database>, event: JournalSourceEvent) => this.record(tx, event);
    this.#events.subscribe<CreatedEvent>('work_order.created', handle);
    for (const type of WORK_ORDER_JOURNAL_EVENT_TYPES) this.#events.subscribe<WorkOrderJournalChangeEvent>(type, handle);
    for (const type of PROCEDURE_JOURNAL_EVENT_TYPES) this.#events.subscribe<StageJournalChangeEvent>(type, handle);
    for (const type of PAYMENT_MILESTONE_JOURNAL_EVENT_TYPES) this.#events.subscribe<PaymentMilestoneStatusChangedEvent>(type, handle);
  }

  /** Writes the entry in the transaction of the change. */
  async record(tx: Kysely<Database>, event: JournalSourceEvent): Promise<void> {
    const entry = toJournalEvent(event);
    await insertEvent(
      timelineTables(tx),
      {
        workOrderId: entry.workOrderId,
        code: entry.code,
        payload: entry.payload,
        procedureStageId: entry.procedureStageId,
        actorUserId: entry.actorUserId,
      },
      this.#clock.now(),
    );
  }
}

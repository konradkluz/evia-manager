/**
 * `payments` as a participant of the status change of a work order (EVM-053 AC6, EVM-054 AC3, AC6; the port
 * `WorkOrderTransitionParticipant` of EVM-030; SR-API-06, SR-API-07, SR-AUTHZ-10, SR-LOG-03; domain-model.md → "Zlecenie").
 * `work-orders` calls it in the transaction of the command, with the row of the order LOCKED (`FOR UPDATE`) — a lock that conflicts
 * with the `FOR NO KEY UPDATE` every change of a milestone takes first, so a milestone invoiced in parallel and a cancellation of the
 * order are serialised: the statuses are read HERE, under that lock, never before it.
 * - the conditions (`domain/order-conditions.ts`): `completed → settled` needs every live milestone `paid` or `cancelled`
 *   (`unpaid_milestones`); a cancellation is refused while a milestone is `invoiced` (`invoiced_milestones`, EVM-054 AC6) — a code,
 *   never an amount or a name. An unmet condition writes nothing (no audit event, no journal entry);
 * - the effect of a cancellation (after every check passed): every `planned` milestone becomes `cancelled` through the one point of
 *   write (`version + 1`, the actor of the command), each with the event `payment_milestone.cancelled` for the audit trail (the
 *   actor, trace and session of the command, the amount, the codes `planned` → `cancelled`) and the event for the journal of the
 *   order (EVM-054 AC3: the two codes, no amount). An error rolls the whole command back.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import { EVENT_BUS } from '../../../platform/tokens.ts';
import { WorkOrderTransitionRegistry, type TransitionContext, type WorkOrderTransitionParticipant } from '../../work-orders/index.ts';
import { orderTransitionCondition } from '../domain/order-conditions.ts';
import type { PaymentMilestoneEvent, PaymentMilestoneStatusChangedEvent } from '../events.ts';
import { liveStatuses } from '../infrastructure/milestone-reader.ts';
import { cancelPlannedMilestones } from '../infrastructure/milestone-store.ts';
import { paymentTables } from '../infrastructure/tables.ts';

@Injectable()
export class PaymentsTransitionParticipant implements WorkOrderTransitionParticipant, OnModuleInit {
  readonly name = 'payments';
  readonly order = 100;
  readonly #registry: WorkOrderTransitionRegistry;
  readonly #events: EventBus;

  constructor(@Inject(WorkOrderTransitionRegistry) registry: WorkOrderTransitionRegistry, @Inject(EVENT_BUS) events: EventBus) {
    this.#registry = registry;
    this.#events = events;
  }

  onModuleInit(): void {
    this.#registry.register(this);
  }

  async check(tx: Kysely<Database>, context: TransitionContext): Promise<string | undefined> {
    if (context.to !== 'settled' && context.to !== 'cancelled') return undefined;
    return orderTransitionCondition(context.to, await liveStatuses(paymentTables(tx), context.workOrderId));
  }

  async apply(tx: Kysely<Database>, context: TransitionContext): Promise<void> {
    if (context.to !== 'cancelled') return;
    const cancelled = await cancelPlannedMilestones(paymentTables(tx), context.workOrderId, context.principal.userId, context.now);
    const actor = { type: 'user', userId: context.principal.userId } as const;
    for (const milestone of cancelled) {
      const event: PaymentMilestoneEvent = {
        type: 'payment_milestone.cancelled',
        actor,
        outcome: 'success',
        objectType: 'payment_milestone',
        objectId: milestone.id,
        workOrderId: context.workOrderId,
        amountBeforeMinor: milestone.amountMinor,
        amountAfterMinor: milestone.amountMinor,
        fromCode: 'planned',
        toCode: 'cancelled',
      };
      await this.#events.publish(tx, event, context.request);
      const journal: PaymentMilestoneStatusChangedEvent = {
        type: 'payment_milestone.status_changed',
        actor,
        outcome: 'success',
        objectType: 'payment_milestone',
        objectId: milestone.id,
        workOrderId: context.workOrderId,
        fromStatus: 'planned',
        toStatus: 'cancelled',
      };
      await this.#events.publish(tx, journal, context.request);
    }
  }
}

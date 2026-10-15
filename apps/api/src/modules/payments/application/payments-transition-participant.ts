/**
 * `payments` as a participant of the status change of a work order (EVM-053 AC6; the port `WorkOrderTransitionParticipant` of EVM-030;
 * SR-API-06, SR-API-07, SR-LOG-03; domain-model.md → "Zlecenie"). `work-orders` calls it in the transaction of the command, with the row
 * of the order LOCKED (`FOR NO KEY UPDATE`) — the same lock every change of a milestone takes first, so a milestone added in parallel
 * and a settlement are serialised (never "settled with a planned milestone"):
 * - the condition of `completed → settled`: every live milestone is `paid` or `cancelled` — otherwise `unpaid_milestones` (a code,
 *   never an amount or a name). Any other target has no condition here (the block of a cancellation by an invoiced milestone is EVM-054);
 * - the effect of a cancellation (from any status): every `planned` milestone becomes `cancelled` through the one point of write
 *   (`version + 1`, the actor of the command), each with the event `payment_milestone.cancelled` for the audit trail — the actor, the
 *   trace and the session of the command, the amount of the milestone. An error rolls the whole command back.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import { EVENT_BUS } from '../../../platform/tokens.ts';
import { WorkOrderTransitionRegistry, type TransitionContext, type WorkOrderTransitionParticipant } from '../../work-orders/index.ts';
import type { PaymentMilestoneEvent } from '../events.ts';
import { hasUnsettledMilestone } from '../infrastructure/milestone-reader.ts';
import { cancelPlannedMilestones } from '../infrastructure/milestone-store.ts';
import { paymentTables } from '../infrastructure/tables.ts';

export const UNPAID_MILESTONES = 'unpaid_milestones';

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
    if (context.to !== 'settled') return undefined;
    return (await hasUnsettledMilestone(paymentTables(tx), context.workOrderId)) ? UNPAID_MILESTONES : undefined;
  }

  async apply(tx: Kysely<Database>, context: TransitionContext): Promise<void> {
    if (context.to !== 'cancelled') return;
    const cancelled = await cancelPlannedMilestones(paymentTables(tx), context.workOrderId, context.principal.userId, context.now);
    for (const milestone of cancelled) {
      const event: PaymentMilestoneEvent = {
        type: 'payment_milestone.cancelled',
        actor: { type: 'user', userId: context.principal.userId },
        outcome: 'success',
        objectType: 'payment_milestone',
        objectId: milestone.id,
        workOrderId: context.workOrderId,
        amountBeforeMinor: milestone.amountMinor,
        amountAfterMinor: milestone.amountMinor,
      };
      await this.#events.publish(tx, event, context.request);
    }
  }
}

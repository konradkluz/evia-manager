/**
 * The contribution of `payments` to the creation of a work order (EVM-053 AC1; the port `WorkOrderCompositionContributor` of EVM-022,
 * SR-API-06). It has no HTTP entry of its own: `work-orders` calls it INSIDE the transaction of the creation, with the transaction
 * handle it must write with, so the milestones commit or roll back with the order. It reads the payment plan of the template through
 * the facade of `catalog`, plans the copy (`domain/composition-plan.ts`: positions 1..n, `planned`, no amount) and inserts it through
 * the one point of write of the module. A template without a plan and an order without a template get no milestone. Database work only.
 *
 * Fail closed: a plan of more than 20 milestones is not trimmed — the planner throws and the creation rolls back as a whole.
 * No audit event of its own: the creation of the order is `work_order.created`.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { TEMPLATE_DIRECTORY, type TemplateDirectory } from '../../catalog/index.ts';
import {
  CompositionRejectedError,
  WorkOrderCompositionRegistry,
  type CompositionContext,
  type WorkOrderCompositionContributor,
} from '../../work-orders/index.ts';
import { PaymentPlanLimitError, planMilestones } from '../domain/composition-plan.ts';
import { insertPlannedMilestones } from '../infrastructure/milestone-store.ts';
import { paymentTables } from '../infrastructure/tables.ts';

@Injectable()
export class PaymentsCompositionContributor implements WorkOrderCompositionContributor, OnModuleInit {
  readonly name = 'payments';
  /** After the processes (100): a payment may refer to a process. */
  readonly order = 200;
  readonly #templates: TemplateDirectory;
  readonly #registry: WorkOrderCompositionRegistry;

  constructor(
    @Inject(TEMPLATE_DIRECTORY) templates: TemplateDirectory,
    @Inject(WorkOrderCompositionRegistry) registry: WorkOrderCompositionRegistry,
  ) {
    this.#templates = templates;
    this.#registry = registry;
  }

  onModuleInit(): void {
    this.#registry.register(this);
  }

  async contribute(tx: Kysely<Database>, context: CompositionContext): Promise<void> {
    if (context.templateId === null) return;
    const plan = await this.#templates.findPaymentPlanForCopy(tx, context.templateId);
    const milestones = planned(plan);
    if (milestones.length === 0) return;
    await insertPlannedMilestones(paymentTables(tx), context.workOrderId, milestones, context.principal.userId, context.now);
  }
}

/** More than 20 milestones is the template's limit: told to `work-orders` in its own language (EVM-099); nothing is trimmed. */
function planned(plan: Parameters<typeof planMilestones>[0]): ReturnType<typeof planMilestones> {
  try {
    return planMilestones(plan);
  } catch (error) {
    if (error instanceof PaymentPlanLimitError) throw new CompositionRejectedError({ cause: error });
    throw error;
  }
}

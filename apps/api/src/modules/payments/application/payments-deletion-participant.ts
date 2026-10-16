/**
 * `payments` as a participant of the deletion of a work order (EVM-060 AC2, AC3; the port `WorkOrderDeletionParticipant`; SR-AUTHZ-10,
 * SR-API-06, SR-ERR-01; AB-17). `work-orders` calls it in the transaction of the command, with the row of the order LOCKED
 * (`FOR NO KEY UPDATE` — the lock every command of a milestone takes first), so a milestone invoiced in parallel and the deletion are
 * serialised: the statuses are read HERE, under that lock, never before it. It reads EVERY live milestone (no limit of rows) and
 * answers with two booleans (`domain/deletion-assessment.ts`) — never an amount, a count or an identifier of a milestone.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import {
  WorkOrderDeletionRegistry,
  type DeletionAssessment,
  type DeletionContext,
  type WorkOrderDeletionParticipant,
} from '../../work-orders/index.ts';
import { assessMilestonesForDeletion } from '../domain/deletion-assessment.ts';
import { liveStatuses } from '../infrastructure/milestone-reader.ts';
import { paymentTables } from '../infrastructure/tables.ts';

@Injectable()
export class PaymentsDeletionParticipant implements WorkOrderDeletionParticipant, OnModuleInit {
  readonly name = 'payments';
  readonly order = 100;
  readonly #registry: WorkOrderDeletionRegistry;

  constructor(@Inject(WorkOrderDeletionRegistry) registry: WorkOrderDeletionRegistry) {
    this.#registry = registry;
  }

  onModuleInit(): void {
    this.#registry.register(this);
  }

  async assess(tx: Kysely<Database>, context: DeletionContext): Promise<DeletionAssessment> {
    return assessMilestonesForDeletion(await liveStatuses(paymentTables(tx), context.workOrderId));
  }
}

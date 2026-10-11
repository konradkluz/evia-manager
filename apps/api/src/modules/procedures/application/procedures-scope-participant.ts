/**
 * The contribution of `procedures` to the editing of the scope of a work order (EVM-035 AC2; the port `WorkOrderScopeParticipant` of
 * `work-orders`, SR-API-02, SR-API-06). It has no HTTP entry of its own: `work-orders` calls it INSIDE the transaction of the
 * addition of an item, with the transaction handle it must write with and the order LOCKED, so the processes and stages commit or
 * roll back with the item, the journal, the audit record and the idempotency record. It reads the processes the item of the
 * catalogue brings through the facade of `catalog`, plans the ones the user chose (a copy, every stage `todo`, a code once —
 * `domain/composition-plan.ts`) and inserts them. It does database work only: no I/O outside the database.
 *
 * Fail closed: an order that would pass a limit of the API (30 processes, 30 stages per process) is not trimmed — the planner
 * throws and the command answers `422 limit_exceeded`; the addition rolls back as a whole. A process whose code is already active in
 * the order is SKIPPED (the unique index of the code is the last line of defence, not the rule).
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { CATALOG_ITEM_DIRECTORY, type CatalogItemDirectory } from '../../catalog/index.ts';
import {
  ScopeLimitError,
  WorkOrderScopeRegistry,
  type ScopeAdditionContext,
  type WorkOrderScopeParticipant,
} from '../../work-orders/index.ts';
import { CompositionLimitError, planAddedProcedures } from '../domain/composition-plan.ts';
import { insertProcedures, insertStages, listProcedureCodesOfScopeItem, listProcedures } from '../infrastructure/procedure-store.ts';
import { procedureTables } from '../infrastructure/tables.ts';

@Injectable()
export class ProceduresScopeParticipant implements WorkOrderScopeParticipant, OnModuleInit {
  readonly name = 'procedures';
  readonly order = 100;
  readonly #catalog: CatalogItemDirectory;
  readonly #registry: WorkOrderScopeRegistry;

  constructor(
    @Inject(CATALOG_ITEM_DIRECTORY) catalog: CatalogItemDirectory,
    @Inject(WorkOrderScopeRegistry) registry: WorkOrderScopeRegistry,
  ) {
    this.#catalog = catalog;
    this.#registry = registry;
  }

  onModuleInit(): void {
    this.#registry.register(this);
  }

  async addProcedures(tx: Kysely<Database>, context: ScopeAdditionContext): Promise<readonly string[]> {
    if (context.procedureCodes.length === 0) return [];
    const tables = procedureTables(tx);
    const brought = await this.#catalog.findProcedures(tx, context.scopeItem.sourceCatalogItemId);
    const active = await listProcedures(tables, context.workOrderId);

    let planned;
    try {
      planned = planAddedProcedures({
        brought,
        requestedCodes: context.procedureCodes,
        activeCodes: active.map((procedure) => procedure.code),
        takenPositions: active.map((procedure) => procedure.position),
        scopeItemId: context.scopeItem.id,
      });
    } catch (error) {
      if (error instanceof CompositionLimitError) throw new ScopeLimitError('/procedureCodes', error.reason);
      throw error;
    }
    if (planned.length === 0) return [];

    await insertProcedures(tables, context.workOrderId, planned, context.principal.userId, context.now);
    await insertStages(tables, context.workOrderId, planned, context.principal.userId, context.now);
    return planned.map((procedure) => procedure.code);
  }

  procedureCodesOf(tx: Kysely<Database>, workOrderId: string, scopeItemId: string): Promise<readonly string[]> {
    return listProcedureCodesOfScopeItem(procedureTables(tx), workOrderId, scopeItemId);
  }
}

/**
 * The contribution of `procedures` to the creation of a work order (EVM-031 AC1; the port `WorkOrderCompositionContributor` of
 * EVM-022, SR-API-06, SR-ERR-01). It has no HTTP entry of its own: `work-orders` calls it INSIDE the transaction of the creation,
 * with the transaction handle it must write with, so the processes and stages commit or roll back with the order. It reads the
 * processes the template brings through the facade of `catalog`, plans them (a copy, in the order of the template, every stage
 * `todo`, a code once — `domain/composition-plan.ts`) and inserts them. It does database work only: no I/O outside the database.
 *
 * Fail closed: an order that would pass a limit of the API (30 processes, 30 stages per process) is not trimmed — the planner
 * throws (`CompositionLimitError`), the creation rolls back as a whole, and the cause is the configuration of the template, not a
 * wrong request. A process whose code is already active in the order (cannot happen on a new order) is refused by the unique index.
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
import { CompositionLimitError, planProcedures } from '../domain/composition-plan.ts';
import { insertProcedures, insertStages } from '../infrastructure/procedure-store.ts';
import { procedureTables } from '../infrastructure/tables.ts';

@Injectable()
export class ProceduresCompositionContributor implements WorkOrderCompositionContributor, OnModuleInit {
  readonly name = 'procedures';
  /** The processes come before the payments: a payment may refer to a process (EVM-053). */
  readonly order = 100;
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
    const brought = await this.#templates.findProceduresForCopy(tx, context.templateId);
    const procedures = planned(brought, context);
    if (procedures.length === 0) return;

    const tables = procedureTables(tx);
    await insertProcedures(tables, context.workOrderId, procedures, context.principal.userId, context.now);
    await insertStages(tables, context.workOrderId, procedures, context.principal.userId, context.now);
  }
}

/** The planner refuses to trim: a limit it reports is the template's, so it is told to `work-orders` in its own language (EVM-099). */
function planned(brought: Parameters<typeof planProcedures>[0], context: CompositionContext): ReturnType<typeof planProcedures> {
  try {
    return planProcedures(brought, context.scopeItems);
  } catch (error) {
    if (error instanceof CompositionLimitError) throw new CompositionRejectedError(error.message, { cause: error });
    throw error;
  }
}

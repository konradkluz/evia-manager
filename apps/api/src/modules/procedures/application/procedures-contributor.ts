/**
 * The contribution of `procedures` to the creation of a work order (EVM-031 AC1; the port `WorkOrderCompositionContributor` of
 * EVM-022, SR-API-06, SR-ERR-01). It has no HTTP entry of its own: `work-orders` calls it INSIDE the transaction of the creation,
 * with the transaction handle it must write with, so the processes and stages commit or roll back with the order. It reads the
 * processes the template brings through the facade of `catalog`, plans them (a copy, in the order of the template, every stage
 * `todo`, a code once — `domain/composition-plan.ts`) and inserts them. It does database work only: no I/O outside the database.
 *
 * Fail closed: an order that would pass a limit of the API (30 processes, 30 stages per process) is not trimmed — the contributor
 * throws, the creation rolls back as a whole, and the cause is the configuration of the template, not a wrong request.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { TEMPLATE_DIRECTORY, type TemplateDirectory } from '../../catalog/index.ts';
import { WorkOrderCompositionRegistry, type CompositionContext, type WorkOrderCompositionContributor } from '../../work-orders/index.ts';
import { planProcedures } from '../domain/composition-plan.ts';
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
    const plan = planProcedures(brought, context.scopeItems);
    if (!plan.ok) throw new Error(`the template brings more than the limit of the API allows (${plan.reason})`);
    if (plan.procedures.length === 0) return;

    const tables = procedureTables(tx);
    const inserted = await insertProcedures(tables, context.workOrderId, plan.procedures, context.principal.userId, context.now);
    await insertStages(
      tables,
      context.workOrderId,
      new Map(inserted.map((row) => [row.code, row.id])),
      plan.procedures,
      context.principal.userId,
      context.now,
    );
  }
}

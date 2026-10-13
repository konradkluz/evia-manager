/**
 * The handlers of the domain events that keep the projection current (ADR-0017 → "Przeliczenie w transakcji zapisu"; EVM-034 W2, W11).
 * A handler computes NOTHING: it names the work order (or the orders) the event concerns in the registry of the transaction, and the
 * registry runs the recomputation once, in ascending order of the identifier, before COMMIT. So a change and its projection are one
 * unit, and N events of one order cost one recomputation.
 *
 * Every event of a module that can change a column of the projection has a handler here (a test lists the types of the modules and
 * fails when one has none) — the event bus itself refuses an event nobody handles. A transaction that was not opened through
 * `runInTransaction` has no registry, and the handler fails: a skipped recomputation would let the projection drift (fail closed).
 *
 * Which order an event concerns:
 * - an event of an order (`objectType` is `work_order`) or a journal event with `workOrderId`: that order;
 * - the audit events of a scope item and of a stage carry the identifier of the item or the stage only: a scope item does not feed
 *   the projection, a stage is resolved to its order through the port of `procedures`;
 * - a site or a party: the orders whose projection holds that site (`site_id`) or waits for that party (`work_order_waits.party_id`).
 *   The recomputation is idempotent and cheap, so every update maps to its orders without comparing the fields.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { requirePreCommitRegistry, type PreCommitParticipant } from '../../../platform/database/transactional.ts';
import type { DomainEvent, EventBus } from '../../../platform/events/event-bus.ts';
import { EVENT_BUS } from '../../../platform/tokens.ts';
import { PARTY_EVENT_TYPES } from '../../parties/index.ts';
import { PROCEDURE_EVENT_TYPES, PROCEDURE_JOURNAL_EVENT_TYPES } from '../../procedures/index.ts';
import { PROCEDURE_PROJECTION_SOURCE, type ProcedureProjectionSource } from '../../procedures/system-ports.ts';
import { SITE_EVENT_TYPES } from '../../sites/index.ts';
import { WORK_ORDER_EVENT_TYPES, WORK_ORDER_JOURNAL_EVENT_TYPES } from '../../work-orders/index.ts';
import { overviewTables } from '../infrastructure/tables.ts';
import { ProjectionRecomputer } from './projection-recomputer.ts';

/** The fields of the events this handler reads; the other fields of an event are of no interest here. */
interface EventShape extends DomainEvent {
  readonly objectType?: string;
  readonly objectId?: string;
  readonly workOrderId?: string;
}

/** The event types the projection reacts to — the union of the lists of the modules (the test compares it with them). */
export const PROJECTION_EVENT_TYPES: readonly string[] = [
  ...WORK_ORDER_EVENT_TYPES,
  ...WORK_ORDER_JOURNAL_EVENT_TYPES,
  ...PROCEDURE_EVENT_TYPES,
  ...PROCEDURE_JOURNAL_EVENT_TYPES,
  ...SITE_EVENT_TYPES,
  ...PARTY_EVENT_TYPES,
];

@Injectable()
export class ProjectionRecorder implements OnModuleInit {
  readonly #events: EventBus;
  readonly #procedures: ProcedureProjectionSource;
  readonly #participant: PreCommitParticipant<Set<string>>;

  constructor(
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(PROCEDURE_PROJECTION_SOURCE) procedures: ProcedureProjectionSource,
    @Inject(ProjectionRecomputer) recomputer: ProjectionRecomputer,
  ) {
    this.#events = events;
    this.#procedures = procedures;
    this.#participant = {
      key: Symbol('overview.recompute'),
      create: () => new Set<string>(),
      run: async (ids, tx) => {
        // an event that named no order (a scope item) leaves the set empty: nothing to recompute
        if (ids.size > 0) await recomputer.recompute(tx, ids);
      },
    };
  }

  onModuleInit(): void {
    for (const type of PROJECTION_EVENT_TYPES) {
      this.#events.subscribe<EventShape>(type, (tx, event) => this.handle(tx, event));
    }
  }

  /** Names the orders the event concerns in the registry of the transaction (throws when the transaction has none). */
  async handle(tx: Kysely<Database>, event: EventShape): Promise<void> {
    const pending = requirePreCommitRegistry(tx).enlist(this.#participant);
    for (const id of await this.#ordersOf(tx, event)) pending.add(id);
  }

  async #ordersOf(tx: Kysely<Database>, event: EventShape): Promise<readonly string[]> {
    if (event.workOrderId !== undefined) return [event.workOrderId];
    const { objectType, objectId } = event;
    if (objectId === undefined) return [];
    switch (objectType) {
      case 'work_order':
        return [objectId];
      case 'procedure_stage': {
        const orders = await this.#procedures.workOrderIdsOfStages(tx, [objectId]);
        return [...orders.values()];
      }
      case 'site': {
        const rows = await overviewTables(tx)
          .selectFrom('overview.work_order_summaries')
          .select('work_order_id')
          .where('site_id', '=', objectId)
          .execute();
        return rows.map((row) => row.work_order_id);
      }
      case 'party': {
        const rows = await overviewTables(tx)
          .selectFrom('overview.work_order_waits')
          .select('work_order_id')
          .where('party_id', '=', objectId)
          .execute();
        return rows.map((row) => row.work_order_id);
      }
      default:
        // a scope item (audit event): the scope is not a column of the projection, its journal event names the order
        return [];
    }
  }
}

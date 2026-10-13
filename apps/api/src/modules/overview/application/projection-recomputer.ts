/**
 * The recomputation of the projection (ADR-0017 → "Aktualizacja, przebudowa i weryfikacja"; W5, W10, W11, W12), the ONE writer of
 * `overview.work_order_summaries` and `overview.work_order_waits`: the handlers of the events (in the transaction of a change, before
 * COMMIT) and `rebuild` both call {@link ProjectionRecomputer.recompute}, so there is one rule and one lock order.
 *
 * Order of work for a set of orders — the order is the correctness of the projection under READ COMMITTED:
 * 1. ascending `work_order_id` (a fixed order: two transactions never wait for each other in a cycle);
 * 2. a row that is missing is inserted (`INSERT … ON CONFLICT DO NOTHING`; keys read through the port), then ALL rows are locked
 *    (`SELECT … FOR UPDATE`, ascending);
 * 3. only AFTER the lock the sources are read through the system ports (a new snapshot per statement sees what a transaction that
 *    held the lock before has committed) — no read of a source is ever buffered from before the lock;
 * 4. the pure function computes, then UPDATE of the summary and replacement of the waits of the order.
 * The sources are read in batches by the ports (a constant number of queries for any number of orders — no N+1). `lock_timeout` of
 * 5 s is set locally: a command that cannot get the lock fails with `500 internal_error` and rolls back with its projection.
 */
import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { Counter, MetricsRegistry } from '../../../platform/metrics/metrics.ts';
import { CLOCK, METRICS } from '../../../platform/tokens.ts';
import { PARTY_PROJECTION_SOURCE, type PartyProjectionSource } from '../../parties/system-ports.ts';
import { PROCEDURE_PROJECTION_SOURCE, type ProcedureProjectionSource } from '../../procedures/system-ports.ts';
import { SITE_PROJECTION_SOURCE, type SiteProjectionSource } from '../../sites/system-ports.ts';
import { WORK_ORDER_PROJECTION_SOURCE, type WorkOrderProjectionSource } from '../../work-orders/system-ports.ts';
import { computeProjection, type Projection, type UnfinishedStage } from '../domain/recompute.ts';
import { overviewTables, type OverviewDb } from '../infrastructure/tables.ts';

const SUMMARIES = 'overview.work_order_summaries';
const WAITS = 'overview.work_order_waits';
const INSERT_CHUNK = 1000;

@Injectable()
export class ProjectionRecomputer {
  readonly #orders: WorkOrderProjectionSource;
  readonly #sites: SiteProjectionSource;
  readonly #parties: PartyProjectionSource;
  readonly #procedures: ProcedureProjectionSource;
  readonly #clock: Clock;
  readonly #failures: Counter;

  constructor(
    @Inject(WORK_ORDER_PROJECTION_SOURCE) orders: WorkOrderProjectionSource,
    @Inject(SITE_PROJECTION_SOURCE) sites: SiteProjectionSource,
    @Inject(PARTY_PROJECTION_SOURCE) parties: PartyProjectionSource,
    @Inject(PROCEDURE_PROJECTION_SOURCE) procedures: ProcedureProjectionSource,
    @Inject(CLOCK) clock: Clock,
    @Inject(METRICS) metrics: MetricsRegistry,
  ) {
    this.#orders = orders;
    this.#sites = sites;
    this.#parties = parties;
    this.#procedures = procedures;
    this.#clock = clock;
    this.#failures = metrics.counter('projection_recompute_failed_total', []);
  }

  /** What the projection of the orders SHOULD be now, from the sources (nothing is written; no lock). Absent: the order does not exist. */
  async compute(tx: Kysely<Database>, workOrderIds: readonly string[]): Promise<ReadonlyMap<string, Projection>> {
    const keys = await this.#orders.keysOf(tx, workOrderIds);
    const stages = await this.#procedures.unfinishedStagesOf(
      tx,
      keys.map((key) => key.id),
    );
    const siteIds = [...new Set(keys.flatMap((key) => (key.siteId === null ? [] : [key.siteId])))];
    const partyIds = [
      ...new Set(
        stages.flatMap((stage) => (stage.status === 'waiting' && stage.waitingOnPartyId !== null ? [stage.waitingOnPartyId] : [])),
      ),
    ];
    const siteTypes = await this.#sites.siteTypesOf(tx, siteIds);
    const partyKinds = await this.#parties.kindsOf(tx, partyIds);
    const stagesByOrder = new Map<string, UnfinishedStage[]>();
    for (const stage of stages) {
      const list = stagesByOrder.get(stage.workOrderId) ?? [];
      list.push(stage);
      stagesByOrder.set(stage.workOrderId, list);
    }
    return new Map(
      keys.map((key) => [
        key.id,
        computeProjection(
          key,
          key.siteId === null ? null : (siteTypes.get(key.siteId) ?? null),
          stagesByOrder.get(key.id) ?? [],
          partyKinds,
        ),
      ]),
    );
  }

  /**
   * Recomputes the orders in the transaction of the caller.
   * @returns the identifiers that were written (an order that does not exist is skipped: a purge removed its projection by cascade)
   */
  async recompute(tx: Kysely<Database>, workOrderIds: Iterable<string>): Promise<readonly string[]> {
    const ids = [...new Set(workOrderIds)].sort();
    if (ids.length === 0) return [];
    try {
      await sql`set local lock_timeout = '5s'`.execute(tx);
      const handle = overviewTables(tx);
      await this.#ensureRows(tx, handle, ids);
      const locked = await handle
        .selectFrom(SUMMARIES)
        .select('work_order_id')
        .where('work_order_id', 'in', ids)
        .orderBy('work_order_id')
        .forUpdate()
        .execute();
      // `compute` answers only for the orders that exist: a row whose order a purge removed meanwhile is simply not written
      const projections = await this.compute(
        tx,
        locked.map((row) => row.work_order_id),
      );
      await this.#write(handle, projections);
      return [...projections.keys()];
    } catch (error) {
      this.#failures.increment({});
      throw error;
    }
  }

  async #ensureRows(tx: Kysely<Database>, handle: OverviewDb, ids: readonly string[]): Promise<void> {
    const existing = await handle.selectFrom(SUMMARIES).select('work_order_id').where('work_order_id', 'in', ids).execute();
    const known = new Set(existing.map((row) => row.work_order_id));
    const missing = ids.filter((id) => !known.has(id));
    if (missing.length === 0) return;
    const keys = await this.#orders.keysOf(tx, missing);
    if (keys.length === 0) return;
    const now = this.#clock.now();
    await handle
      .insertInto(SUMMARIES)
      .values(
        keys.map((key) => ({
          work_order_id: key.id,
          number: key.number,
          status: key.status,
          created_at: key.createdAt,
          deleted_at: key.deletedAt,
          coordinator_user_id: key.coordinatorUserId,
          customer_id: key.customerId,
          site_id: key.siteId,
          site_type: null,
          source_template_id: key.sourceTemplateId,
          waiting_count: 0,
          longest_waiting_since: null,
          longest_waiting_on: null,
          longest_waiting_party_id: null,
          next_due_date: null,
          recomputed_at: now,
        })),
      )
      .onConflict((conflict) => conflict.column('work_order_id').doNothing())
      .execute();
  }

  async #write(handle: OverviewDb, projections: ReadonlyMap<string, Projection>): Promise<void> {
    if (projections.size === 0) return;
    const now = this.#clock.now();
    for (const { summary } of projections.values()) {
      await handle
        .updateTable(SUMMARIES)
        .set({
          number: summary.number,
          status: summary.status,
          created_at: summary.createdAt,
          deleted_at: summary.deletedAt,
          coordinator_user_id: summary.coordinatorUserId,
          customer_id: summary.customerId,
          site_id: summary.siteId,
          site_type: summary.siteType,
          source_template_id: summary.sourceTemplateId,
          waiting_count: summary.waitingCount,
          longest_waiting_since: summary.longestWaitingSince,
          longest_waiting_on: summary.longestWaitingOn,
          longest_waiting_party_id: summary.longestWaitingPartyId,
          next_due_date: summary.nextDueDate,
          recomputed_at: now,
        })
        .where('work_order_id', '=', summary.workOrderId)
        .execute();
    }
    await handle
      .deleteFrom(WAITS)
      .where('work_order_id', 'in', [...projections.keys()])
      .execute();
    const waits = [...projections.values()].flatMap((projection) => projection.waits);
    for (let start = 0; start < waits.length; start += INSERT_CHUNK) {
      await handle
        .insertInto(WAITS)
        .values(
          waits.slice(start, start + INSERT_CHUNK).map((wait) => ({
            stage_id: wait.stageId,
            work_order_id: wait.workOrderId,
            waiting_on: wait.waitingOn,
            party_id: wait.partyId,
            party_kind: wait.partyKind,
            waiting_since: wait.waitingSince,
          })),
        )
        .execute();
    }
  }
}

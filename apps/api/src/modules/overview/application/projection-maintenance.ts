/**
 * `rebuild` and `verify` of the projection (ADR-0017 W11, T7; EVM-034): operations of the server command, NOT of the API — no HTTP
 * route and no function of the panel. They run as the application role, in batches (start: 500 orders), one at a time, with the same
 * locks and the same recomputation as the handlers of the events, so they work while the system is running.
 *
 * - `rebuild` recomputes all orders (or the named ones). A batch interrupted by a foreign-key error (`23503`: the purge of an order
 *   removed it meanwhile) is retried order by order, without the order that is gone;
 * - `verify` is read-only for the projection: it compares each stored row with the recomputed one and reports NUMBERS and
 *   IDENTIFIERS only, by group of columns (never a date, a name or an amount — SR-LOG-02, SR-LOG-03). A difference in the
 *   authorisation column (`deleted_at`) is a security alert in the outbox of the platform, not only a number (W2, ADR-0013).
 */
import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { enqueueSecurityAlert } from '../../../platform/alerts/security-alerts.ts';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { Counter, MetricsRegistry } from '../../../platform/metrics/metrics.ts';
import { CLOCK, DATABASE, METRICS } from '../../../platform/tokens.ts';
import { WORK_ORDER_PROJECTION_SOURCE, type WorkOrderProjectionSource } from '../../work-orders/system-ports.ts';
import { COLUMN_GROUPS, differingGroups, type ColumnGroup, type Projection } from '../domain/recompute.ts';
import { overviewTables } from '../infrastructure/tables.ts';
import { ProjectionRecomputer } from './projection-recomputer.ts';

export const DEFAULT_BATCH_SIZE = 500;
const FOREIGN_KEY_VIOLATION = '23503';

export interface RebuildReport {
  /** Orders whose projection was written. */
  readonly rebuilt: number;
  readonly batches: number;
  /** Orders that disappeared (purge) while the batch ran — skipped. */
  readonly skipped: number;
}

export interface VerifyReport {
  readonly checked: number;
  readonly inSync: number;
  /** Orders that have no row of the projection. */
  readonly missing: readonly string[];
  /** Identifiers of the orders that differ, by group of columns. */
  readonly drift: Readonly<Record<ColumnGroup, readonly string[]>>;
}

const isForeignKeyViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === FOREIGN_KEY_VIOLATION;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size) result.push(items.slice(start, start + size));
  return result;
}

@Injectable()
export class ProjectionMaintenance {
  readonly #db: Kysely<Database>;
  readonly #recomputer: ProjectionRecomputer;
  readonly #orders: WorkOrderProjectionSource;
  readonly #clock: Clock;
  readonly #drift: Counter;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(ProjectionRecomputer) recomputer: ProjectionRecomputer,
    @Inject(WORK_ORDER_PROJECTION_SOURCE) orders: WorkOrderProjectionSource,
    @Inject(CLOCK) clock: Clock,
    @Inject(METRICS) metrics: MetricsRegistry,
  ) {
    this.#db = db;
    this.#recomputer = recomputer;
    this.#orders = orders;
    this.#clock = clock;
    this.#drift = metrics.counter('projection_drift_total', []);
  }

  /** @param only the identifiers to rebuild (absent: all orders) */
  async rebuild(options: { readonly only?: readonly string[]; readonly batchSize?: number } = {}): Promise<RebuildReport> {
    const size = options.batchSize ?? DEFAULT_BATCH_SIZE;
    let rebuilt = 0;
    let batches = 0;
    let skipped = 0;
    for await (const batch of this.#batches(options.only, size)) {
      batches += 1;
      try {
        rebuilt += await this.#rebuildBatch(batch);
      } catch (error) {
        if (!isForeignKeyViolation(error)) throw error;
        for (const id of batch) {
          try {
            rebuilt += await this.#rebuildBatch([id]);
          } catch (single) {
            if (!isForeignKeyViolation(single)) throw single;
            skipped += 1;
          }
        }
      }
    }
    return { rebuilt, batches, skipped };
  }

  /** Compares every stored row with the recomputed one (read only); alerts on a difference of the authorisation column. */
  async verify(options: {
    readonly only?: readonly string[];
    readonly batchSize?: number;
    readonly traceId: string;
    /** Enqueue the security alert for a difference of the authorisation column (default: yes). */
    readonly alert?: boolean;
  }): Promise<VerifyReport> {
    const size = options.batchSize ?? DEFAULT_BATCH_SIZE;
    const missing: string[] = [];
    const drift: Record<ColumnGroup, string[]> = { authorization: [], keys: [], waiting: [], deadline: [] };
    let checked = 0;
    let inSync = 0;
    for await (const batch of this.#batches(options.only, size)) {
      const found = await runInTransaction(this.#db, (tx) => this.#compare(tx, batch), { isolationLevel: 'repeatable read' });
      checked += batch.length;
      missing.push(...found.missing);
      for (const [id, groups] of found.differing) {
        for (const group of groups) drift[group].push(id);
      }
      inSync += batch.length - found.missing.length - found.differing.size;
    }
    const differing = new Set(COLUMN_GROUPS.flatMap((group) => drift[group]));
    for (let index = 0; index < differing.size + missing.length; index += 1) this.#drift.increment({});
    if (drift.authorization.length > 0 && options.alert !== false) {
      await runInTransaction(this.#db, (tx) =>
        enqueueSecurityAlert(tx, { code: 'projection_authz_drift', occurredAt: this.#clock.now(), traceId: options.traceId }),
      );
    }
    return { checked, inSync, missing, drift };
  }

  async #rebuildBatch(ids: readonly string[]): Promise<number> {
    const written = await runInTransaction(this.#db, (tx) => this.#recomputer.recompute(tx, ids));
    return written.length;
  }

  async #compare(tx: Kysely<Database>, ids: readonly string[]): Promise<{ missing: string[]; differing: Map<string, ColumnGroup[]> }> {
    const computed = await this.#recomputer.compute(tx, ids);
    const stored = await this.#stored(tx, ids);
    const missing: string[] = [];
    const differing = new Map<string, ColumnGroup[]>();
    for (const [id, projection] of computed) {
      const row = stored.get(id);
      if (row === undefined) {
        missing.push(id);
        continue;
      }
      const groups = differingGroups(row, projection);
      if (groups.length > 0) differing.set(id, groups);
    }
    return { missing, differing };
  }

  async #stored(tx: Kysely<Database>, ids: readonly string[]): Promise<Map<string, Projection>> {
    const handle = overviewTables(tx);
    const summaries = await handle
      .selectFrom('overview.work_order_summaries')
      .select([
        'work_order_id',
        'number',
        'status',
        'created_at',
        'deleted_at',
        'coordinator_user_id',
        'customer_id',
        'site_id',
        'site_type',
        'source_template_id',
        'waiting_count',
        sql<string | null>`to_char(longest_waiting_since, 'YYYY-MM-DD')`.as('longest_waiting_since'),
        'longest_waiting_on',
        'longest_waiting_party_id',
        sql<string | null>`to_char(next_due_date, 'YYYY-MM-DD')`.as('next_due_date'),
      ])
      .where('work_order_id', 'in', ids)
      .execute();
    const waits = await handle
      .selectFrom('overview.work_order_waits')
      .select([
        'stage_id',
        'work_order_id',
        'waiting_on',
        'party_id',
        'party_kind',
        sql<string>`to_char(waiting_since, 'YYYY-MM-DD')`.as('waiting_since'),
      ])
      .where('work_order_id', 'in', ids)
      .execute();
    const result = new Map<string, Projection>();
    for (const row of summaries) {
      result.set(row.work_order_id, {
        summary: {
          workOrderId: row.work_order_id,
          number: row.number,
          status: row.status,
          createdAt: row.created_at,
          deletedAt: row.deleted_at,
          coordinatorUserId: row.coordinator_user_id,
          customerId: row.customer_id,
          siteId: row.site_id,
          siteType: row.site_type,
          sourceTemplateId: row.source_template_id,
          waitingCount: row.waiting_count,
          longestWaitingSince: row.longest_waiting_since,
          longestWaitingOn: row.longest_waiting_on,
          longestWaitingPartyId: row.longest_waiting_party_id,
          nextDueDate: row.next_due_date,
        },
        waits: waits
          .filter((wait) => wait.work_order_id === row.work_order_id)
          .map((wait) => ({
            stageId: wait.stage_id,
            workOrderId: wait.work_order_id,
            waitingOn: wait.waiting_on,
            partyId: wait.party_id,
            partyKind: wait.party_kind,
            waitingSince: wait.waiting_since,
          })),
      });
    }
    return result;
  }

  async *#batches(only: readonly string[] | undefined, size: number): AsyncGenerator<string[]> {
    if (only !== undefined) {
      for (const batch of chunks([...new Set(only)].sort(), size)) yield batch;
      return;
    }
    let after: string | undefined;
    for (;;) {
      const ids = await this.#orders.idsAfter(this.#db, after, size);
      if (ids.length === 0) return;
      yield [...ids];
      const last = ids.at(-1);
      if (last === undefined || ids.length < size) return;
      after = last;
    }
  }
}

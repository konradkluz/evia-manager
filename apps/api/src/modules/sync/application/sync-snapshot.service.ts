/**
 * The snapshot of one work order for the phone (EVM-097 AC3, AC7; ADR-0021 D3; `GET /api/v1/sync/work-orders/{workOrderId}`). The global guard decided before
 * this runs: the `mobile` channel, the role (Administrator or Editor), the Bearer token checked in the database, the state of the device (`session_revoked`,
 * `device_wipe_required`), the version of the app. The user and the device come from that session only - never from the path or a header.
 *
 * The order of the checks is part of the contract: the format of the identifier (`400`), THEN the limit of the device (`429`, counted for EVERY request that
 * reaches it - a `404` too, so identifiers cannot be probed without bound), THEN the read in a transaction `READ ONLY`. An order that does not exist, is deleted
 * (soft or for good), is out of the scope of the phone (closed over N days ago) or that the caller may not read is the SAME `404 not_found` - the existence of an
 * order is information (CWE-204). The aggregate is read by the reader the snapshot of the pull uses, so the two cannot differ. Nothing here logs or labels a metric
 * with an identifier of an order or a user, and a snapshot does not feed the counter of distinct customers (EVM-039; the decision of the owner).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { AppConfig } from '../../../platform/config/config.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import type { MetricsRegistry } from '../../../platform/metrics/metrics.ts';
import { enqueueSecurityAlert } from '../../../platform/alerts/security-alerts.ts';
import type { SyncAuditEvent } from '../../../platform/sync/sync-event.ts';
import { APP_CONFIG, CLOCK, DATABASE, EVENT_BUS, METRICS } from '../../../platform/tokens.ts';
import { WORK_ORDER_SYNC_SOURCE, type WorkOrderSyncSource } from '../../work-orders/system-ports.ts';
import { countSnapshotRequest, markSnapshotAlerted, purgeSnapshotWindows, snapshotWindowStart } from '../infrastructure/sync-queries.ts';
import { AggregateReader } from './aggregate-reader.ts';

const DAY_MS = 24 * 3_600_000;
const HOUR_MS = 3_600_000;
/** An aggregate above this size is only measured (EVM-107 decides about paging; the answer does not change). */
export const SNAPSHOT_OVERSIZE_BYTES = 1_048_576;

export interface WorkOrderSnapshot {
  readonly serverTime: string;
  readonly entities: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

@Injectable()
export class SyncSnapshotService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #settings: AppConfig['sync'];
  readonly #events: EventBus;
  readonly #orders: WorkOrderSyncSource;
  readonly #reader: AggregateReader;
  readonly #requests;
  readonly #oversize;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(METRICS) metrics: MetricsRegistry,
    @Inject(WORK_ORDER_SYNC_SOURCE) orders: WorkOrderSyncSource,
    @Inject(AggregateReader) reader: AggregateReader,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#settings = config.sync;
    this.#events = events;
    this.#orders = orders;
    this.#reader = reader;
    // The label is a closed set (SR-LOG-02): never a user, a device or an order.
    this.#requests = metrics.counter('sync_snapshot_requests_total', ['result']);
    this.#oversize = metrics.counter('sync_snapshot_oversize_total', []);
  }

  async snapshot(principal: Principal, workOrderId: string, context: EventContext): Promise<WorkOrderSnapshot> {
    const { deviceId } = principal;
    if (deviceId === undefined) throw new ProblemException('unauthenticated');
    await this.#admit(principal, deviceId, context);

    const now = this.#clock.now();
    const scope = { closedSince: new Date(now.getTime() - this.#settings.closedOrdersInScopeDays * DAY_MS) };
    const entities = await runInTransaction(
      this.#db,
      async (tx) => {
        const state = (await this.#orders.statesOf(tx, principal, scope, [workOrderId])).get(workOrderId);
        if (state?.kind !== 'upsert') return undefined;
        const groups = await this.#reader.read(tx, principal, [state.projection]);
        return groups.flatMap((group) => group.items.map((item) => (item.change.op === 'upsert' ? item.change.entity : undefined)));
      },
      { accessMode: 'read only' },
    );
    if (entities === undefined) {
      this.#requests.increment({ result: 'not_found' });
      throw new ProblemException('not_found');
    }
    const served = entities.filter((entity) => entity !== undefined);
    const body: WorkOrderSnapshot = { serverTime: now.toISOString(), entities: served };
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > SNAPSHOT_OVERSIZE_BYTES) this.#oversize.increment({});
    await runInTransaction(this.#db, (tx) => this.#publish(tx, principal, deviceId, 'success', context, served.length));
    this.#requests.increment({ result: 'served' });
    return body;
  }

  /**
   * Counts the request of the device in the hour and refuses it above the limit. A short transaction of its own that COMMITS also when the request is refused
   * (the count is the point); the count is one atomic statement in the database, so several processes of the API share ONE limit (SR-API-02).
   */
  async #admit(principal: Principal, deviceId: string, context: EventContext): Promise<void> {
    const now = this.#clock.now();
    const windowStart = snapshotWindowStart(now);
    const retryAfterSeconds = Math.max(1, Math.ceil((windowStart.getTime() + HOUR_MS - now.getTime()) / 1000));
    const allowed = await runInTransaction(this.#db, async (tx) => {
      await purgeSnapshotWindows(tx, deviceId, windowStart);
      const count = await countSnapshotRequest(tx, deviceId, windowStart);
      if (count <= this.#settings.snapshotsPerHour) return true;
      // The first refusal of the device in the hour: one alert and one trace in the audit trail - the next refusals of the window repeat neither.
      if (await markSnapshotAlerted(tx, deviceId, windowStart)) {
        await enqueueSecurityAlert(tx, { code: 'sync_snapshot_rate_exceeded', occurredAt: now, traceId: context.traceId });
        await this.#publish(tx, principal, deviceId, 'denied', context);
      }
      return false;
    });
    if (!allowed) {
      this.#requests.increment({ result: 'limited' });
      throw new ProblemException('rate_limited', { retryAfterSeconds });
    }
  }

  #publish(
    tx: Kysely<Database>,
    principal: Principal,
    deviceId: string,
    outcome: SyncAuditEvent['outcome'],
    context: EventContext,
    entityCount?: number,
  ): Promise<void> {
    const event: SyncAuditEvent = {
      type: 'sync.work_order_snapshot',
      actor: { type: 'user', userId: principal.userId },
      outcome,
      objectType: 'device',
      objectId: deviceId,
      ...(entityCount === undefined ? {} : { entityCount }),
    };
    return this.#events.publish(tx, event, context);
  }
}

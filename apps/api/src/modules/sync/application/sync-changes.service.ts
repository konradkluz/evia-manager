/**
 * The pull of changes (EVM-096; ADR-0021 D1-D6; `GET /api/v1/sync/changes`). The handler has no authorization of its own: the global guard let a Bearer principal
 * of the `mobile` channel through (Administrator or Editor; the token is checked in the database on EVERY request, so a device that was revoked or wiped between
 * two pages gets `401` and no data). The user and the device come from that session only - never from a header, the query or the cursor.
 *
 * - No cursor = a FULL download: the limit per device per rolling day is checked and counted under a lock (AB-08), the horizon of the log is taken BEFORE the
 *   snapshot, and the snapshot is paged by the orders (each page carries the customer and the site of its orders). After the last page the cursor changes the
 *   phase to `changes` at that horizon, and the device is current (`last_full_sync_at`).
 * - A cursor of the phase of changes: the rows of the log after its position, below the horizon (so no transaction that is still open can be missed), each
 *   entity at its CURRENT state under the read policy and the rule of scope (both in the SQL of the ports). Reading is a transaction `READ ONLY`.
 * - A cursor that is not usable: `400 invalid_cursor` or `resync_required` without any data (`decideCursor`).
 * Nothing here logs or returns a cursor, an identifier of a customer or a site, or a row.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { KeyRingCursorCodec } from '../../../platform/crypto/key-ring-cursor.ts';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { AppConfig } from '../../../platform/config/config.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import type { Logger } from '../../../platform/logging/logger.ts';
import type { MetricsRegistry } from '../../../platform/metrics/metrics.ts';
import type { SyncAuditEvent } from '../../../platform/sync/sync-event.ts';
import { APP_CONFIG, CLOCK, DATABASE, EVENT_BUS, LOGGER, METRICS } from '../../../platform/tokens.ts';
import { CUSTOMER_SYNC_SOURCE, type CustomerSyncSource } from '../../customers/system-ports.ts';
import { SITE_SYNC_SOURCE, type SiteSyncSource } from '../../sites/system-ports.ts';
import { WORK_ORDER_SYNC_SOURCE, type SyncScopeRule, type WorkOrderSyncSource } from '../../work-orders/system-ports.ts';
import { assemblePage, entityKey, type ChangeLogRow } from '../domain/changes-page.ts';
import {
  decideCursor,
  type ChangesCursorClaims,
  type CursorClaims,
  type DeviceSyncState,
  type FullDownloadReason,
  type ResyncReason,
  type SnapshotCursorClaims,
} from '../domain/cursor.ts';
import { changeBytes, customerChange, deleteChange, siteChange, workOrderChange, type SyncChange } from '../domain/projection.ts';
import {
  addDownloadedCounts,
  completeFullSync,
  currentHorizon,
  fullDownloadExists,
  horizonLagSeconds,
  lockDeviceState,
  readDeviceState,
  readLogAfter,
  recentFullDownloads,
  startFullDownload,
} from '../infrastructure/sync-queries.ts';
import { SYNC_CURSOR_CODEC } from '../sync.tokens.ts';

const OPERATION = 'getSyncChanges';
const DAY_MS = 24 * 3_600_000;
/** The contract allows 500 changes in a page. */
const MAX_PAGE_ENTITIES = 500;
/** Room for the envelope of the answer (the cursor, the times) inside the byte budget of the changes. */
const ENVELOPE_BYTES = 2048;

export interface PullQuery {
  readonly cursor: string | undefined;
  readonly limit: number;
}

export interface ChangesPage {
  readonly result: 'changes';
  readonly phase: 'snapshot' | 'changes';
  readonly changes: readonly SyncChange[];
  readonly cursor: string;
  readonly hasMore: boolean;
  readonly serverTime: string;
}

export interface ResyncRequired {
  readonly result: 'resync_required';
  readonly reason: ResyncReason;
  readonly serverTime: string;
}

export type PullResponse = ChangesPage | ResyncRequired;

type Step =
  { readonly kind: 'done'; readonly response: PullResponse } | { readonly kind: 'snapshot'; readonly claims: SnapshotCursorClaims };

interface Identity {
  readonly principal: Principal;
  readonly userId: string;
  readonly deviceId: string;
}

@Injectable()
export class SyncChangesService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #settings: AppConfig['sync'];
  readonly #codec: KeyRingCursorCodec;
  readonly #events: EventBus;
  readonly #logger: Logger;
  readonly #orders: WorkOrderSyncSource;
  readonly #customers: CustomerSyncSource;
  readonly #sites: SiteSyncSource;
  readonly #requests;
  readonly #resyncs;
  readonly #rejected;
  readonly #fullDownloads;
  readonly #limited;
  readonly #durationCount;
  readonly #durationSum;
  readonly #horizonLag;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(SYNC_CURSOR_CODEC) codec: KeyRingCursorCodec,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(METRICS) metrics: MetricsRegistry,
    @Inject(LOGGER) logger: Logger,
    @Inject(WORK_ORDER_SYNC_SOURCE) orders: WorkOrderSyncSource,
    @Inject(CUSTOMER_SYNC_SOURCE) customers: CustomerSyncSource,
    @Inject(SITE_SYNC_SOURCE) sites: SiteSyncSource,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#settings = config.sync;
    this.#codec = codec;
    this.#events = events;
    this.#logger = logger;
    this.#orders = orders;
    this.#customers = customers;
    this.#sites = sites;
    // Label values are closed sets (SR-LOG-02): never a user, a device or an identifier.
    this.#requests = metrics.counter('sync_changes_requests_total', ['phase']);
    this.#resyncs = metrics.counter('sync_resync_required_total', ['reason']);
    this.#rejected = metrics.counter('sync_cursor_rejected_total', ['reason']);
    this.#fullDownloads = metrics.counter('sync_full_downloads_total', []);
    this.#limited = metrics.counter('sync_full_downloads_limited_total', []);
    this.#durationCount = metrics.counter('sync_changes_page_duration_seconds_count', []);
    this.#durationSum = metrics.counter('sync_changes_page_duration_seconds_sum', []);
    this.#horizonLag = metrics.gauge('sync_horizon_lag_seconds');
  }

  async pull(principal: Principal, query: PullQuery, context: EventContext): Promise<PullResponse> {
    const { deviceId } = principal;
    if (deviceId === undefined) throw new ProblemException('unauthenticated');
    const identity: Identity = { principal, userId: principal.userId, deviceId };
    const started = performance.now();
    try {
      return query.cursor === undefined
        ? await this.#startFullDownload(identity, query.limit, context)
        : await this.#continue(identity, query.cursor, query.limit);
    } finally {
      this.#durationCount.increment({});
      this.#durationSum.increment({}, (performance.now() - started) / 1000);
    }
  }

  async #continue(identity: Identity, cursor: string, limit: number): Promise<PullResponse> {
    const step = await runInTransaction(this.#db, (tx) => this.#decide(tx, identity, cursor, limit), { accessMode: 'read only' });
    if (step.kind === 'done') return step.response;
    this.#requests.increment({ phase: 'snapshot' });
    return runInTransaction(this.#db, async (tx) => {
      // The snapshot names a download of THIS device (it was started here); anything else is a cursor from nowhere.
      if (!(await fullDownloadExists(tx, step.claims.dl, identity.deviceId, identity.userId))) return this.#resync('cursor_invalid');
      return this.#snapshotPage(tx, identity, step.claims, limit);
    });
  }

  /** Reads the state of the device, judges the cursor and, in the phase of changes, serves the page - all in one transaction `READ ONLY`. */
  async #decide(tx: Kysely<Database>, identity: Identity, cursor: string, limit: number): Promise<Step> {
    const now = this.#clock.now();
    const state = await readDeviceState(tx, identity.deviceId);
    const decision = decideCursor(this.#codec.open(OPERATION, cursor), {
      userId: identity.userId,
      deviceId: identity.deviceId,
      scopeRuleVersion: this.#settings.scopeRuleVersion,
      now,
      periodicResyncMs: this.#settings.periodicResyncDays * DAY_MS,
      state,
    });
    switch (decision.kind) {
      case 'reject':
        this.#rejected.increment({ reason: decision.reason });
        // A security event (SR-SYNC-07): who and why, never the cursor.
        this.#logger.warn(
          { event: 'sync.cursor_rejected', reason: decision.reason, userId: identity.userId, deviceId: identity.deviceId },
          'sync cursor rejected',
        );
        throw new ProblemException('invalid_cursor');
      case 'resync':
        return { kind: 'done', response: this.#resync(decision.reason) };
      case 'proceed':
        break;
    }
    return decision.claims.ph === 'snapshot'
      ? { kind: 'snapshot', claims: decision.claims }
      : { kind: 'done', response: await this.#changesPage(tx, identity, decision.claims, limit) };
  }

  #resync(reason: ResyncReason): ResyncRequired {
    this.#resyncs.increment({ reason });
    return { result: 'resync_required', reason, serverTime: this.#clock.now().toISOString() };
  }

  async #startFullDownload(identity: Identity, limit: number, context: EventContext): Promise<PullResponse> {
    this.#requests.increment({ phase: 'start' });
    const now = this.#clock.now();
    const outcome = await runInTransaction(this.#db, async (tx) => {
      const state = await lockDeviceState(tx, identity.deviceId, now);
      const recent = await recentFullDownloads(tx, identity.deviceId, now);
      if (recent.count >= this.#settings.fullDownloadsPerDay) {
        await this.#publish(tx, identity, 'denied', context);
        const free = (recent.oldest?.getTime() ?? now.getTime()) + DAY_MS - now.getTime();
        return { denied: Math.max(1, Math.ceil(free / 1000)) } as const;
      }
      const id = await startFullDownload(tx, {
        deviceId: identity.deviceId,
        userId: identity.userId,
        reason: this.#reasonOf(state, now),
        now,
      });
      await this.#publish(tx, identity, 'success', context);
      const claims: SnapshotCursorClaims = {
        ph: 'snapshot',
        tx: await currentHorizon(tx),
        after: null,
        dl: id,
        u: identity.userId,
        d: identity.deviceId,
        sv: this.#settings.scopeRuleVersion,
      };
      return { page: await this.#snapshotPage(tx, identity, claims, limit) } as const;
    });
    if ('denied' in outcome) {
      this.#limited.increment({});
      // Counter without a device: the alert "more than 2 in 24 h" reads the rate; the device is in the log and in the audit trail.
      this.#logger.warn(
        { event: 'sync.full_download_limited', userId: identity.userId, deviceId: identity.deviceId },
        'full download refused by the daily limit',
      );
      throw new ProblemException('rate_limited', { retryAfterSeconds: outcome.denied });
    }
    this.#fullDownloads.increment({});
    return outcome.page;
  }

  #reasonOf(state: DeviceSyncState, now: Date): FullDownloadReason {
    if (state.resyncRequestedReason !== null) return state.resyncRequestedReason;
    if (state.lastFullSyncAt === null) return 'initial';
    return now.getTime() - state.lastFullSyncAt.getTime() >= this.#settings.periodicResyncDays * DAY_MS ? 'periodic' : 'requested';
  }

  #publish(tx: Kysely<Database>, identity: Identity, outcome: SyncAuditEvent['outcome'], context: EventContext): Promise<void> {
    const event: SyncAuditEvent = {
      type: 'sync.full_download',
      actor: { type: 'user', userId: identity.userId },
      outcome,
      objectType: 'device',
      objectId: identity.deviceId,
    };
    return this.#events.publish(tx, event, context);
  }

  #scope(): SyncScopeRule {
    return { closedSince: new Date(this.#clock.now().getTime() - this.#settings.closedOrdersInScopeDays * DAY_MS) };
  }

  #budget(): number {
    return this.#settings.pageMaxBytes - ENVELOPE_BYTES;
  }

  /** One page of the snapshot: `limit` orders after the cursor, each with the customer and the site it names (once per page), trimmed to the contract and the budget. */
  async #snapshotPage(tx: Kysely<Database>, identity: Identity, claims: SnapshotCursorClaims, limit: number): Promise<ChangesPage> {
    const { principal } = identity;
    const fetched = await this.#orders.snapshotPage(tx, principal, this.#scope(), claims.after ?? undefined, limit + 1);
    const orders = fetched.slice(0, limit);
    const customerIds = [...new Set(orders.flatMap((order) => (order.customerId === null ? [] : [order.customerId])))];
    const siteIds = [...new Set(orders.flatMap((order) => (order.siteId === null ? [] : [order.siteId])))];
    const customers = await this.#customers.statesOf(tx, principal, customerIds);
    const sites = await this.#sites.statesOf(tx, principal, siteIds);

    const changes: SyncChange[] = [];
    const counts = { workOrders: 0, customers: 0, sites: 0 };
    const seen = new Set<string>();
    let bytes = 0;
    let included = 0;
    for (const order of orders) {
      const group: Array<{ change: SyncChange; kind: keyof typeof counts }> = [{ change: workOrderChange(order), kind: 'workOrders' }];
      const customer = order.customerId === null ? undefined : customers.get(order.customerId);
      if (customer?.kind === 'upsert' && !seen.has(`c:${customer.projection.id}`))
        group.push({ change: customerChange(customer.projection), kind: 'customers' });
      const site = order.siteId === null ? undefined : sites.get(order.siteId);
      if (site?.kind === 'upsert' && !seen.has(`s:${site.projection.id}`))
        group.push({ change: siteChange(site.projection), kind: 'sites' });
      const size = group.reduce((sum, item) => sum + changeBytes(item.change), 0);
      if (included > 0 && (changes.length + group.length > MAX_PAGE_ENTITIES || bytes + size > this.#budget())) break;
      for (const item of group) {
        changes.push(item.change);
        counts[item.kind] += 1;
      }
      if (customer?.kind === 'upsert') seen.add(`c:${customer.projection.id}`);
      if (site?.kind === 'upsert') seen.add(`s:${site.projection.id}`);
      bytes += size;
      included += 1;
    }
    await addDownloadedCounts(tx, claims.dl, counts);
    const more = fetched.length > limit || included < orders.length;
    const last = included === 0 ? undefined : orders[included - 1];
    const now = this.#clock.now();
    if (more && last !== undefined) {
      const cursor = this.#codec.seal(OPERATION, { ...claims, after: last.id } satisfies CursorClaims);
      return { result: 'changes', phase: 'snapshot', changes, cursor, hasMore: true, serverTime: now.toISOString() };
    }
    // The last page of the snapshot: the device is current as of now, and the phase of changes starts at the horizon taken before the snapshot.
    await completeFullSync(tx, identity.deviceId, now);
    const next: ChangesCursorClaims = { ph: 'changes', tx: claims.tx, sq: '0', u: claims.u, d: claims.d, sv: claims.sv };
    return {
      result: 'changes',
      phase: 'changes',
      changes,
      cursor: this.#codec.seal(OPERATION, next),
      hasMore: true,
      serverTime: now.toISOString(),
    };
  }

  async #changesPage(tx: Kysely<Database>, identity: Identity, claims: ChangesCursorClaims, limit: number): Promise<ChangesPage> {
    this.#requests.increment({ phase: 'changes' });
    const now = this.#clock.now();
    const rows = await readLogAfter(tx, claims.tx, claims.sq, limit + 1);
    const taken = rows.slice(0, limit);
    const current = await this.#currentChanges(
      tx,
      identity.principal,
      taken.filter((row) => !row.superseded),
    );
    const page = assemblePage(taken, current, this.#budget());
    const last = page.consumed === 0 ? undefined : taken[page.consumed - 1];
    const position = last === undefined ? { tx: claims.tx, sq: claims.sq } : { tx: last.txid, sq: last.seq };
    this.#horizonLag.set(await horizonLagSeconds(tx));
    const next: ChangesCursorClaims = { ...claims, ...position };
    return {
      result: 'changes',
      phase: 'changes',
      changes: page.changes,
      cursor: this.#codec.seal(OPERATION, next),
      hasMore: page.consumed < taken.length || rows.length > limit,
      serverTime: now.toISOString(),
    };
  }

  /** The change due for each entity the rows name (constant number of queries): its current projection, a marker, or nothing. */
  async #currentChanges(
    tx: Kysely<Database>,
    principal: Principal,
    rows: readonly ChangeLogRow[],
  ): Promise<ReadonlyMap<string, SyncChange>> {
    const idsOf = (type: ChangeLogRow['type']): string[] => [...new Set(rows.filter((row) => row.type === type).map((row) => row.id))];
    const scope = this.#scope();
    const due = new Map<string, SyncChange>();

    const orders = await this.#orders.statesOf(tx, principal, scope, idsOf('work_order'));
    for (const id of idsOf('work_order')) {
      const state = orders.get(id);
      if (state === undefined || state.kind === 'delete') due.set(entityKey({ type: 'work_order', id }), deleteChange('work_order', id));
      else if (state.kind === 'upsert') due.set(entityKey({ type: 'work_order', id }), workOrderChange(state.projection));
    }

    const customerIds = idsOf('customer');
    const customers = await this.#customers.statesOf(tx, principal, customerIds);
    const usedCustomers = await this.#orders.customersInScope(
      tx,
      principal,
      scope,
      customerIds.filter((id) => customers.has(id)),
    );
    for (const id of customerIds) {
      const state = customers.get(id);
      const key = entityKey({ type: 'customer', id });
      if (state === undefined) due.set(key, deleteChange('customer', id));
      else if (usedCustomers.has(id))
        due.set(key, state.kind === 'upsert' ? customerChange(state.projection) : deleteChange('customer', id));
    }

    const siteIds = idsOf('site');
    const sites = await this.#sites.statesOf(tx, principal, siteIds);
    const usedSites = await this.#orders.sitesInScope(
      tx,
      principal,
      scope,
      siteIds.filter((id) => sites.has(id)),
    );
    for (const id of siteIds) {
      const state = sites.get(id);
      const key = entityKey({ type: 'site', id });
      if (state === undefined) due.set(key, deleteChange('site', id));
      else if (usedSites.has(id)) due.set(key, state.kind === 'upsert' ? siteChange(state.projection) : deleteChange('site', id));
    }
    return due;
  }
}

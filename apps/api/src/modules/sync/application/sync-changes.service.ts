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
import { enqueueSecurityAlert } from '../../../platform/alerts/security-alerts.ts';
import type { SyncAuditEvent } from '../../../platform/sync/sync-event.ts';
import { APP_CONFIG, CLOCK, DATABASE, EVENT_BUS, LOGGER, METRICS } from '../../../platform/tokens.ts';
import { effectiveScopeRuleVersion } from '../../../platform/sync/scope-rule.ts';
import { WORK_ORDER_SYNC_SOURCE, type SyncScopeRule, type WorkOrderSyncSource } from '../../work-orders/system-ports.ts';
import { assemblePage } from '../domain/changes-page.ts';
import {
  CURSOR_ROLES,
  decideCursor,
  type ChangesCursorClaims,
  type CursorClaims,
  type DeviceSyncState,
  type FullDownloadReason,
  type ResyncReason,
  type SnapshotCursorClaims,
} from '../domain/cursor.ts';
import { changeBytes, type SyncChange } from '../domain/projection.ts';
import {
  addDownloadedCounts,
  advanceDownload,
  completeDownload,
  completeFullSync,
  currentHorizon,
  type DownloadedCounts,
  horizonLagSeconds,
  lockDeviceState,
  readDeviceState,
  readLogAfter,
  recentFullDownloads,
  snapshotCursorAccepted,
  startFullDownload,
  touchPulled,
} from '../infrastructure/sync-queries.ts';
import { SYNC_CURSOR_CODEC } from '../sync.tokens.ts';
import { AggregateReader, type CountKind } from './aggregate-reader.ts';
import { CurrentStateReader } from './current-state.ts';

/** The role a cursor is bound to: only the roles of the mobile channel pull, the guard has refused the others already. */
function cursorRole(principal: Principal): (typeof CURSOR_ROLES)[number] {
  const role = CURSOR_ROLES.find((candidate) => candidate === principal.role);
  if (role === undefined) throw new ProblemException('forbidden');
  return role;
}

const OPERATION = 'getSyncChanges';
const DAY_MS = 24 * 3_600_000;
/** The contract allows 500 changes in a page. */
/** AB-08: a device downloads the whole snapshot at most this many times in 24 h without a signal; the next one (the third) raises the alert of the operator, once per window. */
const FULL_DOWNLOADS_BEFORE_ALERT = 2;
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
  readonly #reader: AggregateReader;
  readonly #current: CurrentStateReader;
  readonly #scopeRuleVersion: number;
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
    @Inject(AggregateReader) reader: AggregateReader,
    @Inject(CurrentStateReader) current: CurrentStateReader,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#settings = config.sync;
    this.#codec = codec;
    this.#events = events;
    this.#logger = logger;
    this.#orders = orders;
    this.#reader = reader;
    this.#current = current;
    this.#scopeRuleVersion = effectiveScopeRuleVersion({
      configured: config.sync.scopeRuleVersion,
      closedDays: config.sync.closedOrdersInScopeDays,
    });
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
      const response =
        query.cursor === undefined
          ? await this.#startFullDownload(identity, query.limit, context)
          : await this.#continue(identity, query.cursor, query.limit, context);
      if (response.result === 'changes') await touchPulled(this.#db, deviceId, this.#clock.now());
      return response;
    } finally {
      this.#durationCount.increment({});
      this.#durationSum.increment({}, (performance.now() - started) / 1000);
    }
  }

  async #continue(identity: Identity, cursor: string, limit: number, context: EventContext): Promise<PullResponse> {
    const step = await runInTransaction(this.#db, (tx) => this.#decide(tx, identity, cursor, limit), { accessMode: 'read only' });
    if (step.kind === 'done') return step.response;
    this.#requests.increment({ phase: 'snapshot' });
    return runInTransaction(this.#db, async (tx) => {
      // The snapshot names an OPEN download of THIS device, begun within the day, at the position last issued or the one before; anything else is a cursor
      // from nowhere or a replay (AB-08: the snapshot would be handed out again outside the limit). Security event: who and why, never the cursor.
      const download = { id: step.claims.dl, deviceId: identity.deviceId, userId: identity.userId, after: step.claims.after };
      if (!(await snapshotCursorAccepted(tx, download, this.#clock.now()))) {
        this.#rejected.increment({ reason: 'snapshot_replay' });
        this.#logger.warn(
          { event: 'sync.cursor_rejected', reason: 'snapshot_replay', userId: identity.userId, deviceId: identity.deviceId },
          'sync cursor rejected',
        );
        return this.#resync('cursor_invalid');
      }
      return this.#snapshotPage(tx, identity, step.claims, limit, context);
    });
  }

  /** Reads the state of the device, judges the cursor and, in the phase of changes, serves the page - all in one transaction `READ ONLY`. */
  async #decide(tx: Kysely<Database>, identity: Identity, cursor: string, limit: number): Promise<Step> {
    const now = this.#clock.now();
    const state = await readDeviceState(tx, identity.deviceId);
    const decision = decideCursor(this.#codec.open(OPERATION, cursor), {
      userId: identity.userId,
      deviceId: identity.deviceId,
      scopeRuleVersion: this.#scopeRuleVersion,
      role: identity.principal.role,
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
      // The third full download of the device in a rolling day: one alert per window (the device is named by the audit event of the same trace).
      if (recent.count === FULL_DOWNLOADS_BEFORE_ALERT) {
        await enqueueSecurityAlert(tx, { code: 'sync_full_downloads_excess', occurredAt: now, traceId: context.traceId });
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
        sv: this.#scopeRuleVersion,
        r: cursorRole(identity.principal),
      };
      return { page: await this.#snapshotPage(tx, identity, claims, limit, context) } as const;
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

  #publishCompleted(tx: Kysely<Database>, identity: Identity, counts: DownloadedCounts, context: EventContext): Promise<void> {
    const event: SyncAuditEvent = {
      type: 'sync.full_download_completed',
      actor: { type: 'user', userId: identity.userId },
      outcome: 'success',
      objectType: 'device',
      objectId: identity.deviceId,
      counts,
    };
    return this.#events.publish(tx, event, context);
  }

  #scope(): SyncScopeRule {
    return { closedSince: new Date(this.#clock.now().getTime() - this.#settings.closedOrdersInScopeDays * DAY_MS) };
  }

  #budget(): number {
    return this.#settings.pageMaxBytes - ENVELOPE_BYTES;
  }

  /**
   * One page of the snapshot: `limit` orders after the cursor, each as a GROUP - the order with everything the phone needs to show it (`AggregateReader`, the
   * reader the snapshot of one order shares) - trimmed to the contract (500) and the byte budget. A group is never cut between pages, except when ONE group is
   * longer than a page: then its first entities fill the page and the cursor carries `sub` - the order and how many of its entities went out - so the next page
   * continues it (a group of 600 journal entries cannot be a page of 500).
   */
  async #snapshotPage(
    tx: Kysely<Database>,
    identity: Identity,
    claims: SnapshotCursorClaims,
    limit: number,
    context: EventContext,
  ): Promise<ChangesPage> {
    const { principal } = identity;
    const scope = this.#scope();
    // The order that was cut by the previous page is read again under the policy and the scope of NOW (it may be gone: then nothing of it comes).
    const resumed =
      claims.sub === undefined ? undefined : (await this.#orders.statesOf(tx, principal, scope, [claims.sub.o])).get(claims.sub.o);
    const resume = claims.sub !== undefined && resumed?.kind === 'upsert' ? { order: resumed.projection, from: claims.sub.n } : undefined;
    const resumedOrders = resume === undefined ? [] : [resume.order];
    const fetched = await this.#orders.snapshotPage(tx, principal, scope, claims.after ?? undefined, limit + 1);
    const orders = fetched.slice(0, limit);
    const groups = await this.#reader.read(tx, principal, [...resumedOrders, ...orders]);

    const changes: SyncChange[] = [];
    const counts = { workOrders: 0, customers: 0, sites: 0 };
    const add = (item: { readonly change: SyncChange; readonly kind: CountKind }): void => {
      changes.push(item.change);
      if (item.kind !== 'other') counts[item.kind] += 1;
    };
    const seen = new Set<string>();
    let bytes = 0;
    let included = 0;
    let cut: { readonly orderId: string; readonly sent: number } | undefined;
    for (const [index, group] of groups.entries()) {
      const offset = index === 0 && resume !== undefined ? resume.from : 0;
      const fresh = group.items.slice(offset).filter((item) => !seen.has(item.key));
      const size = fresh.reduce((sum, item) => sum + changeBytes(item.change), 0);
      if (changes.length + fresh.length > MAX_PAGE_ENTITIES || bytes + size > this.#budget()) {
        if (included === 0) {
          let taken = 0;
          for (const item of fresh) {
            const itemSize = changeBytes(item.change);
            if (taken > 0 && (changes.length >= MAX_PAGE_ENTITIES || bytes + itemSize > this.#budget())) break;
            add(item);
            bytes += itemSize;
            taken += 1;
          }
          cut = { orderId: group.orderId, sent: offset + taken };
        }
        break;
      }
      for (const item of fresh) {
        add(item);
        seen.add(item.key);
      }
      bytes += size;
      included += 1;
    }
    const more = fetched.length > limit || included < groups.length;
    const lastId = cut?.orderId ?? (included === 0 ? undefined : groups[included - 1]?.orderId);
    const now = this.#clock.now();
    // A page asked again (its answer was lost) is served but not counted twice.
    const advanced = more && lastId !== undefined ? await advanceDownload(tx, claims.dl, claims.after, lastId) : true;
    if (advanced) await addDownloadedCounts(tx, claims.dl, counts);
    if (more && lastId !== undefined) {
      const next: SnapshotCursorClaims = {
        ph: 'snapshot',
        tx: claims.tx,
        after: lastId,
        dl: claims.dl,
        u: claims.u,
        d: claims.d,
        sv: claims.sv,
        r: cursorRole(principal),
        ...(cut === undefined ? {} : { sub: { o: cut.orderId, n: cut.sent } }),
      };
      const cursor = this.#codec.seal(OPERATION, next satisfies CursorClaims);
      return { result: 'changes', phase: 'snapshot', changes, cursor, hasMore: true, serverTime: now.toISOString() };
    }
    // The last page of the snapshot: the device is current as of now, and the phase of changes starts at the horizon taken before the snapshot.
    await completeFullSync(tx, identity.deviceId, now);
    // The end of the download: the trail holds the counts of the entities by type (AC8, AB-08), and the cursors of the snapshot are no longer served.
    await this.#publishCompleted(tx, identity, await completeDownload(tx, claims.dl, now), context);
    const next: ChangesCursorClaims = {
      ph: 'changes',
      tx: claims.tx,
      sq: '0',
      u: claims.u,
      d: claims.d,
      sv: claims.sv,
      r: cursorRole(principal),
    };
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
    const current = await this.#current.changesFor(
      tx,
      identity.principal,
      this.#scope(),
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
}

import { ContactClock } from './contact-clock.ts';
import type { Clock, MonotonicClock, PendingObjectsSource, PullTransport, Random, ReplicaStore, TransportResponse } from './ports.ts';
import { parseChange, parseClientConfig, parsePage, parseSnapshot, parseSnapshotEntity } from './pull-parse.ts';
import {
  CURSOR_PATTERN,
  DEFAULT_CLIENT_CONFIG,
  HYDRATION_REASONS,
  RESYNC_REASONS,
  type ClientConfig,
  type GenerationState,
  type HydrationItem,
  type ParsedChange,
  type PendingObjects,
  type ReplicaEntity,
  type ReplicaState,
  type ResyncReason,
  type Visibility,
} from './pull-types.ts';
import { closedBefore, collectKeys, planPage, planSnapshot, snapshotKeys } from './replica-rules.ts';
import type { SessionGate } from './session-gate.ts';
import { CODE_PATTERN, UUID_PATTERN, type EngineEvent, type PauseReason, type PullFailureCode } from './types.ts';
import { backoffDelay, parseRetryAfter } from './util.ts';

export interface PullResult {
  /**
   * `complete`: pages, snapshots and sweep done; `partial`: limits of the cycle reached (call again); `retry`: transient error
   * (backoff); `paused`: shared pause; `stale`: session/generation changed while a request was in flight, the response was dropped.
   */
  readonly status: 'complete' | 'partial' | 'retry' | 'paused' | 'stale' | 'backoff';
  readonly pages: number;
  readonly paused?: PauseReason;
  readonly nextAttemptAt?: number;
}

export interface PullOptions {
  /** Changes per page requested from the server (1-500). */
  readonly pageLimit?: number;
  /** Pages per cycle; the rest continues in the next cycle (the state is durable). */
  readonly maxPagesPerCycle?: number;
  /** Work-order snapshots per cycle (battery, DoS); the rest stays on the durable list. */
  readonly maxHydrationsPerCycle?: number;
  readonly configRefreshMs?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly maxRetryAfterMs?: number;
  /** `true` (default): a field outside a projection makes a change invalid; `false`: such fields are dropped. */
  readonly strictProjection?: boolean;
}

export interface PullDeps {
  readonly replica: ReplicaStore;
  readonly transport: PullTransport;
  readonly clock: Clock;
  readonly random: Random;
  readonly monotonic: MonotonicClock;
  readonly gate: SessionGate;
  readonly pending: PendingObjectsSource;
  readonly options?: PullOptions;
}

export interface PullCycleOptions {
  /** Network is back: do not wait for the backoff that came from a network error. */
  readonly networkRestored?: boolean;
}

interface Target {
  readonly generation: number;
  readonly isShadow: boolean;
  cursor: string | null;
  complete: boolean;
  hydration: HydrationItem[];
}

interface Ctx {
  readonly userId: string;
  readonly epoch: number;
  pages: number;
  snapshots: number;
  starts: number;
}

type Fetched =
  { readonly kind: 'ok'; readonly body: unknown } | { readonly kind: 'not_found' } | { readonly kind: 'stop'; readonly result: PullResult };

type Step = { readonly next: 'page' } | { readonly next: 'replan' } | { readonly next: 'stop'; readonly result: PullResult };
type PagesStep = Exclude<Step, { next: 'page' }> | { readonly next: 'done'; readonly serverNow: number };

const MAX_INVALID_EVENTS = 10;
const MAX_STARTS = 3;
const MAX_ITERATIONS = 8;

const isReason = (value: unknown): value is ResyncReason =>
  typeof value === 'string' && (RESYNC_REASONS as readonly string[]).includes(value);

function readTarget(generation: GenerationState, isShadow: boolean): Target | 'cursor_unreadable' {
  const raw = generation.cursor;
  let cursor: string | null = null;
  if (raw !== null && raw !== undefined) {
    if (typeof raw !== 'string' || !CURSOR_PATTERN.test(raw)) return 'cursor_unreadable';
    cursor = raw;
  }
  const seen = new Set<string>();
  const hydration: HydrationItem[] = [];
  for (const item of generation.hydration) {
    if (typeof item !== 'object' || item === null) continue;
    const { workOrderId, reason } = item as { workOrderId?: unknown; reason?: unknown };
    if (typeof workOrderId !== 'string' || !UUID_PATTERN.test(workOrderId) || seen.has(workOrderId)) continue;
    if (typeof reason !== 'string' || !(HYDRATION_REASONS as readonly string[]).includes(reason)) continue;
    seen.add(workOrderId);
    hydration.push({ workOrderId, reason: reason as HydrationItem['reason'] });
  }
  return { generation: generation.generation, isShadow, cursor, complete: generation.complete, hydration };
}

function readPendingResync(raw: unknown): ResyncReason | null {
  if (raw === null || raw === undefined) return null;
  const reason = typeof raw === 'object' ? (raw as { reason?: unknown }).reason : undefined;
  return isReason(reason) ? reason : 'periodic';
}

function readConfig(raw: unknown): { config: ClientConfig; fetchedAt: number | undefined } {
  if (typeof raw !== 'object' || raw === null) return { config: DEFAULT_CLIENT_CONFIG, fetchedAt: undefined };
  const fetchedAt = (raw as { fetchedAt?: unknown }).fetchedAt;
  return { config: parseClientConfig(raw), fetchedAt: typeof fetchedAt === 'number' && Number.isFinite(fetchedAt) ? fetchedAt : undefined };
}

/**
 * The pull side (EVM-092): pages of changes (snapshot phase, then changes), version guard, work-order snapshots, resync in a shadow
 * generation, sweep after a complete cycle. The pause/session state is shared with the push side (`SessionGate`); the queue is
 * never touched here. The only writes go through `ReplicaStore`, each in one transaction.
 */
export class PullEngine {
  readonly #d: PullDeps;
  readonly #o: Required<Omit<PullOptions, 'strictProjection'>> & { strict: boolean };
  readonly #contact: ContactClock;
  #running: Promise<PullResult> | undefined;
  #attempts = 0;
  #nextAttemptAt: number | undefined;
  #lastFailure: PullFailureCode | undefined;
  #wipe: Promise<void> = Promise.resolve();
  /** A wipe after `session_revoked` that failed is retried before anything else (privacy). */
  #wipeOwed = false;

  constructor(deps: PullDeps) {
    this.#d = deps;
    const o = deps.options ?? {};
    this.#o = {
      pageLimit: Math.min(Math.max(o.pageLimit ?? 200, 1), 500),
      maxPagesPerCycle: o.maxPagesPerCycle ?? 200,
      maxHydrationsPerCycle: o.maxHydrationsPerCycle ?? 20,
      configRefreshMs: o.configRefreshMs ?? 6 * 3_600_000,
      baseDelayMs: o.baseDelayMs ?? 2000,
      maxDelayMs: o.maxDelayMs ?? 5 * 60_000,
      maxRetryAfterMs: o.maxRetryAfterMs ?? 60 * 60_000,
      strict: o.strictProjection ?? true,
    };
    this.#contact = new ContactClock(deps.replica, deps.clock, deps.monotonic);
    deps.gate.attachContact(this.#contact);
    // Losing the session removes the replica at once, whichever side noticed it first; the queue stays.
    deps.gate.onPause((reason) => {
      if (reason === 'session_revoked') {
        this.#wipeOwed = true;
        this.#wipe = this.#wipe.then(() => this.#wipeNow('session_revoked')).catch(() => undefined);
      }
    });
  }

  /** Single-flight. */
  pull(options: PullCycleOptions = {}): Promise<PullResult> {
    if (this.#running !== undefined) return this.#running;
    const run = this.#run(options).finally(() => {
      this.#running = undefined;
    });
    this.#running = run;
    return run;
  }

  /** Whether the replica may be shown (AC7): hidden, not wiped, when the offline window passed or the clock looks wrong. */
  async visibility(): Promise<Visibility> {
    const state = await this.#d.replica.loadState();
    const { config } = readConfig(state.config);
    const result = await this.#contact.visibility(state.contact, state.hasData, config.offlineContactWindowDays);
    if (!result.visible) this.#emit({ kind: 'data_hidden', reason: result.reason });
    return result;
  }

  async #run(options: PullCycleOptions): Promise<PullResult> {
    const gate = this.#d.gate;
    await this.#wipe;
    if (this.#wipeOwed) {
      try {
        await this.#wipeNow('session_revoked');
      } catch {
        return this.#transient('store_failure', undefined, { userId: '', epoch: gate.epoch, pages: 0, snapshots: 0, starts: 0 });
      }
    }
    if (gate.paused !== undefined) return { status: 'paused', pages: 0, paused: gate.paused };
    const now = this.#d.clock.now();
    if (
      this.#nextAttemptAt !== undefined &&
      now < this.#nextAttemptAt &&
      !(options.networkRestored === true && this.#lastFailure === 'network')
    ) {
      return { status: 'backoff', pages: 0, nextAttemptAt: this.#nextAttemptAt };
    }
    const userId = await gate.currentUserId();
    if (userId === null) {
      gate.pauseWith('auth_required', null);
      return { status: 'paused', pages: 0, paused: 'auth_required' };
    }
    const ctx: Ctx = { userId, epoch: gate.epoch, pages: 0, snapshots: 0, starts: 0 };
    let result: PullResult;
    try {
      result = await this.#cycle(ctx);
    } catch {
      result = this.#transient('store_failure', undefined, ctx);
    }
    await this.#wipe;
    if (result.status === 'complete' || result.status === 'partial') {
      this.#attempts = 0;
      this.#nextAttemptAt = undefined;
      this.#lastFailure = undefined;
    }
    const paused = this.#pausedReason();
    return paused !== undefined && result.status !== 'paused' ? { ...result, paused } : result;
  }

  async #cycle(ctx: Ctx): Promise<PullResult> {
    const { replica } = this.#d;
    let state = await replica.loadState();
    if ((state.ownerUserId !== null || state.hasData) && state.ownerUserId !== ctx.userId) {
      if (state.ownerUserId !== null) this.#d.gate.emit({ kind: 'signal', signal: 'owner_mismatch' });
      await this.#wipeNow('owner_changed');
      state = await replica.loadState();
    }
    const configured = await this.#config(state, ctx);
    if ('status' in configured) return configured;
    const config = configured;

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
      const intent = readPendingResync(state.pendingResync);
      if (state.shadow === null && intent !== null) {
        await replica.beginShadow(intent);
        this.#emit({ kind: 'resync_scheduled', reason: intent });
        state = await replica.loadState();
      }
      const target = this.#target(state);
      if (target === 'cursor_unreadable') {
        await replica.beginShadow('cursor_invalid');
        this.#emit({ kind: 'resync_scheduled', reason: 'cursor_invalid' });
        state = await replica.loadState();
        continue;
      }
      const pages = await this.#pages(target, ctx);
      if (pages.next === 'stop') return pages.result;
      if (pages.next === 'replan') {
        state = await replica.loadState();
        continue;
      }
      const { serverNow } = pages;
      if (!target.complete) return { status: 'partial', pages: ctx.pages };
      const hydrated = await this.#hydrate(target, serverNow, ctx);
      if (hydrated.next === 'stop') return hydrated.result;
      if (hydrated.next === 'replan') {
        state = await replica.loadState();
        continue;
      }
      if (target.hydration.length > 0) return { status: 'partial', pages: ctx.pages };
      if (target.isShadow) {
        if ((await replica.promoteShadow(target.generation)) === 'stale') return { status: 'stale', pages: ctx.pages };
        this.#emit({ kind: 'resync_completed' });
      }
      await this.#sweep(target.generation, config, serverNow, ctx);
      return { status: 'complete', pages: ctx.pages };
    }
    return { status: 'partial', pages: ctx.pages };
  }

  #startAllowed(ctx: Ctx): boolean {
    ctx.starts += 1;
    return ctx.starts <= MAX_STARTS;
  }

  #target(state: ReplicaState): Target | 'cursor_unreadable' {
    return state.shadow === null ? readTarget(state.active, false) : readTarget(state.shadow, true);
  }

  async #config(state: ReplicaState, ctx: Ctx): Promise<ClientConfig | PullResult> {
    const known = readConfig(state.config);
    const now = this.#d.clock.now();
    if (known.fetchedAt !== undefined && now >= known.fetchedAt && now - known.fetchedAt < this.#o.configRefreshMs) return known.config;
    const fetched = await this.#fetch(() => this.#d.transport.getClientConfig(), ctx);
    if (fetched.kind === 'stop') return fetched.result;
    if (fetched.kind === 'not_found') return this.#unexpected(ctx);
    const config = parseClientConfig(fetched.body);
    await this.#d.replica.saveConfig({ ...config, fetchedAt: now });
    return config;
  }

  async #pages(target: Target, ctx: Ctx): Promise<PagesStep> {
    const { transport } = this.#d;
    for (;;) {
      if (ctx.pages >= this.#o.maxPagesPerCycle) return { next: 'stop', result: { status: 'partial', pages: ctx.pages } };
      const request = { limit: this.#o.pageLimit, ...(target.cursor === null ? {} : { cursor: target.cursor }) };
      const fetched = await this.#fetch(() => transport.getChanges(request), ctx);
      if (fetched.kind === 'stop') return { next: 'stop', result: fetched.result };
      if (fetched.kind === 'not_found') return { next: 'stop', result: this.#unexpected(ctx) };
      const parsed = parsePage(fetched.body, this.#o.pageLimit);
      if (!parsed.ok) return { next: 'stop', result: this.#transient('invalid_response', undefined, ctx) };
      ctx.pages += 1;
      if ('resync' in parsed) {
        await this.#d.gate.recordContact(parsed.resync.serverTime, ctx.epoch);
        return this.#onResync(parsed.resync.reason, ctx);
      }
      const { page } = parsed;
      await this.#d.gate.recordContact(page.serverTime, ctx.epoch);
      const outcome = await this.#applyPage(target, page, ctx);
      if (outcome.next !== 'page') return outcome;
      if (!page.hasMore) return { next: 'done', serverNow: page.serverTime };
      if (page.cursor === target.cursor) return { next: 'stop', result: this.#transient('invalid_response', undefined, ctx) };
      target.cursor = page.cursor;
    }
  }

  async #applyPage(
    target: Target,
    page: { phase: 'snapshot' | 'changes'; changes: readonly unknown[]; cursor: string; hasMore: boolean; serverTime: number },
    ctx: Ctx,
  ): Promise<Step> {
    const { replica, gate } = this.#d;
    const parsed = page.changes.map((c) => parseChange(c, { strict: this.#o.strict }));
    const valid: ParsedChange[] = [];
    let invalid = 0;
    let unknown = 0;
    for (const change of parsed) {
      if (change.kind === 'invalid') {
        invalid += 1;
        if (invalid <= MAX_INVALID_EVENTS) this.#emit({ kind: 'change_invalid', reason: change.reason, type: change.type });
      } else if (change.kind === 'unknown') unknown += 1;
      else valid.push(change);
    }
    if (unknown > 0) this.#emit({ kind: 'change_unknown_skipped', count: unknown });
    if (invalid > 0 && target.isShadow) return { next: 'stop', result: this.#transient('invalid_change_in_resync', undefined, ctx) };

    const keys = collectKeys(valid);
    const versions = keys.length === 0 ? new Map() : await replica.readVersions(target.generation, keys);
    const pending = await this.#d.pending.read();
    const plan = await planPage({
      changes: valid,
      versions,
      pending,
      lookupSites: (ids) => replica.findWorkOrdersBySite(target.generation, ids),
    });
    if (gate.paused !== undefined || gate.epoch !== ctx.epoch) return { next: 'stop', result: this.#stale(ctx) };
    const complete = page.phase === 'changes' && !page.hasMore;
    const outcome = await replica.applyPage({
      generation: target.generation,
      ownerUserId: ctx.userId,
      ops: plan.ops,
      cursor: page.cursor,
      phase: page.phase,
      complete,
      serverTime: page.serverTime,
      hydrationAdd: plan.hydrationAdd,
      hydrationRemove: plan.hydrationRemove,
      ...(invalid > 0 ? { plannedResync: 'invalid_change' as const } : {}),
    });
    if (outcome === 'stale') return { next: 'stop', result: this.#stale(ctx) };
    this.#emit({ kind: 'pull_page_applied', count: plan.ops.length, phase: page.phase });
    target.complete = complete;
    const removed = new Set(plan.hydrationRemove);
    target.hydration = target.hydration.filter((h) => !removed.has(h.workOrderId));
    for (const item of plan.hydrationAdd)
      if (!target.hydration.some((h) => h.workOrderId === item.workOrderId)) target.hydration.push(item);
    if (invalid > 0) {
      this.#emit({ kind: 'resync_scheduled', reason: 'invalid_change' });
      return { next: 'replan' };
    }
    return { next: 'page' };
  }

  async #onResync(reason: ResyncReason, ctx: Ctx): Promise<Exclude<Step, { next: 'page' }>> {
    this.#emit({ kind: 'resync_scheduled', reason });
    if (!this.#startAllowed(ctx)) return { next: 'stop', result: this.#transient('server_error', undefined, ctx) };
    if (reason === 'access_changed') await this.#wipeNow('access_changed');
    else await this.#d.replica.beginShadow(reason);
    return { next: 'replan' };
  }

  async #hydrate(target: Target, serverNow: number, ctx: Ctx): Promise<Step> {
    const { replica, transport } = this.#d;
    for (const item of [...target.hydration]) {
      if (ctx.snapshots >= this.#o.maxHydrationsPerCycle) break;
      const fetched = await this.#fetch(() => transport.getWorkOrderSnapshot(item.workOrderId), ctx);
      if (fetched.kind === 'stop') return { next: 'stop', result: fetched.result };
      ctx.snapshots += 1;
      const guard = (): boolean => this.#d.gate.paused !== undefined || this.#d.gate.epoch !== ctx.epoch;
      if (fetched.kind === 'not_found') {
        const pending = await this.#d.pending.read();
        if (guard()) return { next: 'stop', result: this.#stale(ctx) };
        const outcome = await replica.applySnapshot({
          generation: target.generation,
          ownerUserId: ctx.userId,
          ops: [],
          serverTime: serverNow,
          hydrationRemove: [item.workOrderId],
          ...(pending.objectIds.has(item.workOrderId) ? {} : { removeWorkOrderId: item.workOrderId }),
        });
        if (outcome === 'stale') return { next: 'stop', result: this.#stale(ctx) };
        this.#emit({ kind: 'hydration', reason: 'not_found' });
        target.hydration = target.hydration.filter((h) => h !== item);
        continue;
      }
      const snapshot = parseSnapshot(fetched.body);
      if (snapshot === null) return { next: 'stop', result: this.#transient('invalid_response', undefined, ctx) };
      await this.#d.gate.recordContact(snapshot.serverTime, ctx.epoch);
      const entities: ReplicaEntity[] = [];
      let bad = false;
      let unknown = 0;
      for (const raw of snapshot.entities) {
        const change = parseSnapshotEntity(raw, { strict: this.#o.strict });
        if (change.kind === 'upsert') entities.push(change.entity);
        else if (change.kind === 'unknown') unknown += 1;
        else {
          bad = true;
          this.#emit({ kind: 'change_invalid', reason: change.reason, type: change.type });
        }
      }
      if (unknown > 0) this.#emit({ kind: 'change_unknown_skipped', count: unknown });
      const versions = entities.length === 0 ? new Map() : await replica.readVersions(target.generation, snapshotKeys(entities));
      const plan = bad ? ({ ok: false } as const) : planSnapshot({ requestedId: item.workOrderId, entities, versions });
      if (!plan.ok) {
        if (target.isShadow) return { next: 'stop', result: this.#transient('invalid_change_in_resync', undefined, ctx) };
        await replica.beginShadow('invalid_change');
        this.#emit({ kind: 'resync_scheduled', reason: 'invalid_change' });
        return { next: 'replan' };
      }
      if (guard()) return { next: 'stop', result: this.#stale(ctx) };
      const outcome = await replica.applySnapshot({
        generation: target.generation,
        ownerUserId: ctx.userId,
        ops: plan.ops,
        serverTime: snapshot.serverTime,
        hydrationRemove: [item.workOrderId],
      });
      if (outcome === 'stale') return { next: 'stop', result: this.#stale(ctx) };
      this.#emit({ kind: 'hydration', reason: item.reason });
      target.hydration = target.hydration.filter((h) => h !== item);
    }
    return { next: 'page' };
  }

  async #sweep(generation: number, config: ClientConfig, serverNow: number, ctx: Ctx): Promise<void> {
    const pending: PendingObjects = await this.#d.pending.read();
    if (this.#d.gate.paused !== undefined || this.#d.gate.epoch !== ctx.epoch) return;
    const result = await this.#d.replica.sweep({
      generation,
      closedBefore: closedBefore(serverNow, config.closedWorkOrdersInScopeDays),
      keepWorkOrderIds: [...pending.objectIds, ...pending.workOrderIds],
      keepReferencedIds: [...pending.referencedIds],
    });
    this.#emit({ kind: 'sweep_done', removedWorkOrders: result.removedWorkOrders, removedOrphans: result.removedOrphans });
  }

  /** One request through the shared gate: 401 refresh, 426/403 pauses, transient errors with backoff, anything else is unexpected. */
  async #fetch(call: () => Promise<TransportResponse>, ctx: Ctx): Promise<Fetched> {
    const { gate } = this.#d;
    for (let canRefresh = true; ; canRefresh = false) {
      let response: TransportResponse;
      try {
        response = await call();
      } catch {
        response = { kind: 'network' };
      }
      if (gate.paused !== undefined || gate.epoch !== ctx.epoch) return { kind: 'stop', result: this.#stale(ctx) };
      if (response.kind === 'ok') return { kind: 'ok', body: response.body };
      if (response.kind === 'network') return { kind: 'stop', result: this.#transient('network', undefined, ctx) };
      const { status } = response;
      const code = response.code !== undefined && CODE_PATTERN.test(response.code) ? response.code : undefined;
      const verdict = await gate.onHttpFailure(status, code, ctx.userId, canRefresh);
      if (verdict === 'retry') continue;
      if (verdict === 'stop') return { kind: 'stop', result: this.#stale(ctx) };
      if (status === 404) return { kind: 'not_found' };
      if (status === 429 || status === 408 || (status >= 500 && status <= 599)) {
        const failure: PullFailureCode = status === 429 ? 'rate_limited' : status === 408 ? 'timeout' : 'server_error';
        return { kind: 'stop', result: this.#transient(failure, response.retryAfter, ctx) };
      }
      return { kind: 'stop', result: this.#unexpected(ctx) };
    }
  }

  #pausedReason(): PauseReason | undefined {
    return this.#d.gate.paused;
  }

  #unexpected(ctx: Ctx): PullResult {
    this.#emit({ kind: 'pull_failed', code: 'unexpected_status' });
    this.#d.gate.pauseWith('unexpected_response', ctx.userId);
    return { status: 'paused', pages: ctx.pages, paused: 'unexpected_response' };
  }

  #stale(ctx: Ctx): PullResult {
    const paused = this.#d.gate.paused;
    return paused === undefined ? { status: 'stale', pages: ctx.pages } : { status: 'paused', pages: ctx.pages, paused };
  }

  #transient(code: PullFailureCode, retryAfter: string | number | undefined, ctx: Ctx): PullResult {
    const now = this.#d.clock.now();
    this.#attempts += 1;
    const hinted = parseRetryAfter(retryAfter, now, this.#o.maxRetryAfterMs);
    const delayMs = Math.max(backoffDelay(this.#attempts, this.#d.random, this.#o.baseDelayMs, this.#o.maxDelayMs), hinted ?? 0);
    this.#nextAttemptAt = now + delayMs;
    this.#lastFailure = code;
    this.#emit({ kind: 'pull_retry_scheduled', code, attempts: this.#attempts, delayMs });
    return { status: 'retry', pages: ctx.pages, nextAttemptAt: this.#nextAttemptAt };
  }

  async #wipeNow(reason: 'access_changed' | 'session_revoked' | 'owner_changed'): Promise<void> {
    try {
      await this.#d.replica.wipeReplica();
    } catch (error) {
      this.#emit({ kind: 'pull_failed', code: 'store_failure' });
      throw error;
    }
    if (reason === 'session_revoked') this.#wipeOwed = false;
    this.#emit({ kind: 'replica_wiped', reason });
  }

  #emit(event: EngineEvent): void {
    this.#d.gate.emit(event);
  }
}

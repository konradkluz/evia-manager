import type { MutationQueue } from './queue.ts';
import type { Clock, EventSink, QueueStore, Random, RefreshResult, SessionOwner, Transport, TransportResponse } from './ports.ts';
import {
  CODE_PATTERN,
  KNOWN_REJECTION_CODES,
  MAX_BATCH_BYTES,
  MAX_BATCH_MUTATIONS,
  MAX_PENDING_ITEMS,
  QueueError,
  type EngineEvent,
  type PauseReason,
  type QueueRecord,
  type RecordPatch,
  type SettledInfo,
} from './types.ts';
import { backoffDelay, parseRetryAfter } from './util.ts';
import { toWire, wireBytes } from './validate.ts';

export interface EngineOptions {
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly maxRetryAfterMs?: number;
  readonly maxBatchSize?: number;
  readonly maxBatchBytes?: number;
}

export interface EngineDeps {
  readonly store: QueueStore;
  readonly queue: MutationQueue;
  readonly transport: Transport;
  readonly clock: Clock;
  readonly random: Random;
  readonly session: SessionOwner;
  readonly events?: EventSink;
  readonly options?: EngineOptions;
}

export interface FlushOptions {
  /** Network is back: retry mutations waiting only on a network error right now (never ones waiting on `Retry-After`). */
  readonly networkRestored?: boolean;
}

export interface FlushResult {
  readonly settled: number;
  readonly attention: number;
  readonly retryScheduled: boolean;
  readonly paused?: PauseReason;
}

/** State for the indicator and the "needs attention" list (counts are of the signed-in user's entries). */
export interface EngineStatus {
  readonly paused?: PauseReason;
  readonly ownerUserId: string | null;
  readonly pending: number;
  readonly retrying: number;
  readonly needsAttention: number;
  readonly blocked: number;
  readonly corrupt: number;
  /** Entries of other users on this installation (SR-MOB-13): never sent, never touched. */
  readonly foreign: number;
  readonly nextAttemptAt?: number;
  readonly oldestCreatedAt?: number;
}

interface Tally {
  settled: number;
  attention: number;
  retryScheduled: boolean;
}

type Step = 'continue' | 'stop';
const MAX_WARNINGS = 10;
const WORK_ORDER_NUMBER = /^[!-~]{1,32}$/;
const KNOWN_CODES: readonly string[] = KNOWN_REJECTION_CODES;

interface ResultItem {
  readonly outcome: string;
  readonly code?: string;
  readonly info: SettledInfo | undefined;
}

export class SyncEngine {
  readonly #d: EngineDeps;
  readonly #baseDelayMs: number;
  readonly #maxDelayMs: number;
  readonly #maxRetryAfterMs: number;
  readonly #maxBatchSize: number;
  readonly #maxBatchBytes: number;
  #running: Promise<FlushResult> | undefined;
  #requests = 0;
  #pause: PauseReason | undefined;
  #pausedOwner: string | null = null;
  #refreshing: Promise<RefreshResult> | undefined;
  #foreignNotified = false;
  readonly #corruptReported = new Set<number>();

  constructor(deps: EngineDeps) {
    this.#d = deps;
    const o = deps.options ?? {};
    this.#baseDelayMs = o.baseDelayMs ?? 2000;
    this.#maxDelayMs = o.maxDelayMs ?? 5 * 60_000;
    this.#maxRetryAfterMs = o.maxRetryAfterMs ?? 60 * 60_000;
    this.#maxBatchSize = Math.min(o.maxBatchSize ?? MAX_BATCH_MUTATIONS, MAX_BATCH_MUTATIONS);
    this.#maxBatchBytes = Math.min(o.maxBatchBytes ?? MAX_BATCH_BYTES, MAX_BATCH_BYTES);
  }

  /** Single-flight: parallel triggers (network back, foreground) join the running flush; an enqueue meanwhile is picked up. */
  flush(options: FlushOptions = {}): Promise<FlushResult> {
    if (this.#running !== undefined) {
      this.#requests += 1;
      return this.#running;
    }
    const run = this.#run(options).finally(() => {
      this.#running = undefined;
    });
    this.#running = run;
    return run;
  }

  /** Resumes after a pause. `session_revoked` only for the same user after a full sign-in; `device_wipe_required` never. */
  async resume(): Promise<boolean> {
    const pause = this.#pause;
    if (pause === undefined) return true;
    if (pause === 'device_wipe_required') return false;
    if (pause === 'session_revoked') {
      const userId = await this.#d.session.currentUserId();
      if (userId === null) return false;
      if (userId !== this.#pausedOwner) {
        this.#emit({ kind: 'signal', signal: 'owner_mismatch' });
        return false;
      }
    }
    this.#pause = undefined;
    return true;
  }

  async status(): Promise<EngineStatus> {
    const userId = await this.#d.session.currentUserId();
    const entries = await this.#d.queue.entries();
    let pending = 0;
    let retrying = 0;
    let needsAttention = 0;
    let blocked = 0;
    let corrupt = 0;
    let foreign = 0;
    let nextAttemptAt: number | undefined;
    let oldestCreatedAt: number | undefined;
    for (const entry of entries) {
      if (!entry.valid) {
        corrupt += 1;
        needsAttention += 1;
        continue;
      }
      const r = entry.record;
      if (r.ownerUserId !== userId) {
        foreign += 1;
        continue;
      }
      if (r.state === 'pending') pending += 1;
      else if (r.state === 'retrying') retrying += 1;
      else if (r.state === 'needs_attention') needsAttention += 1;
      else blocked += 1;
      if (r.nextAttemptAt !== undefined && (r.state === 'pending' || r.state === 'retrying')) {
        nextAttemptAt = nextAttemptAt === undefined ? r.nextAttemptAt : Math.min(nextAttemptAt, r.nextAttemptAt);
      }
      oldestCreatedAt = oldestCreatedAt === undefined ? r.createdAt : Math.min(oldestCreatedAt, r.createdAt);
    }
    return {
      ...(this.#pause === undefined ? {} : { paused: this.#pause }),
      ownerUserId: userId,
      pending,
      retrying,
      needsAttention,
      blocked,
      corrupt,
      foreign,
      ...(nextAttemptAt === undefined ? {} : { nextAttemptAt }),
      ...(oldestCreatedAt === undefined ? {} : { oldestCreatedAt }),
    };
  }

  async #run(options: FlushOptions): Promise<FlushResult> {
    const tally: Tally = { settled: 0, attention: 0, retryScheduled: false };
    let seen: number;
    do {
      seen = this.#requests;
      while (this.#pause === undefined) {
        if ((await this.#cycle(options, tally)) === 'stop') break;
      }
    } while (this.#requests !== seen && this.#pause === undefined && !tally.retryScheduled);
    return { ...tally, ...(this.#pause === undefined ? {} : { paused: this.#pause }) };
  }

  async #cycle(options: FlushOptions, tally: Tally): Promise<Step> {
    const userId = await this.#d.session.currentUserId();
    if (userId === null) return this.#pauseWith('auth_required', null);
    const entries = await this.#d.queue.entries();
    const mine: QueueRecord[] = [];
    let foreign = 0;
    for (const entry of entries) {
      if (!entry.valid) {
        if (!this.#corruptReported.has(entry.index)) {
          this.#corruptReported.add(entry.index);
          this.#emit({ kind: 'corrupt_record', index: entry.index });
        }
      } else if (entry.record.ownerUserId === userId) mine.push(entry.record);
      else foreign += 1;
    }
    if (foreign > 0 && !this.#foreignNotified) this.#emit({ kind: 'signal', signal: 'owner_mismatch' });
    this.#foreignNotified = foreign > 0;

    const resolved = await this.#resolveDependencies(mine);
    const batch = this.#select(resolved, options);
    if (batch.length === 0) return 'stop';
    return this.#send(batch, Math.min(mine.length, MAX_PENDING_ITEMS), tally, true, true, userId);
  }

  /** Blocks mutations whose parent needs attention (and unblocks those whose parent no longer does); persisted before sending. */
  async #resolveDependencies(mine: readonly QueueRecord[]): Promise<QueueRecord[]> {
    const ids = new Set(mine.map((r) => r.mutationId));
    const stalled = new Set<string>();
    const out: QueueRecord[] = [];
    for (const r of mine) {
      let current = r;
      if (r.parentMutationId !== undefined) {
        const parentStalled = stalled.has(r.parentMutationId) && ids.has(r.parentMutationId);
        if (parentStalled && r.state !== 'blocked' && r.state !== 'needs_attention') {
          current = await this.#patch(r, { state: 'blocked', attempts: r.attempts, lastCode: 'parent_unavailable' });
          this.#emit({ kind: 'blocked', mutationId: r.mutationId });
        } else if (!parentStalled && r.state === 'blocked') {
          current = await this.#patch(r, { state: 'pending', attempts: r.attempts });
        }
      }
      if (current.state === 'needs_attention' || current.state === 'blocked') stalled.add(current.mutationId);
      out.push(current);
    }
    return out;
  }

  /** FIFO per ordering key: a record that waits (backoff, parent, size limit) holds back the later records of its key. */
  #select(records: readonly QueueRecord[], options: FlushOptions): QueueRecord[] {
    const now = this.#d.clock.now();
    const ids = new Set(records.map((r) => r.mutationId));
    const held = new Set<string>();
    const batch: QueueRecord[] = [];
    let bytes = 0;
    for (const r of records) {
      if (r.state === 'needs_attention' || r.state === 'blocked') continue;
      if (held.has(r.orderingKey)) continue;
      if (r.parentMutationId !== undefined && ids.has(r.parentMutationId)) {
        held.add(r.orderingKey);
        continue;
      }
      const due = r.nextAttemptAt === undefined || r.nextAttemptAt <= now || (options.networkRestored === true && r.lastCode === 'network');
      if (!due) {
        held.add(r.orderingKey);
        continue;
      }
      const size = wireBytes(toWire(r));
      if (batch.length >= this.#maxBatchSize || bytes + size > this.#maxBatchBytes) {
        held.add(r.orderingKey);
        continue;
      }
      bytes += size;
      batch.push(r);
    }
    return batch;
  }

  async #send(
    batch: readonly QueueRecord[],
    pendingItems: number,
    tally: Tally,
    canRefresh: boolean,
    canSplit: boolean,
    userId: string,
  ): Promise<Step> {
    this.#emit({ kind: 'batch_sent', size: batch.length });
    let response: TransportResponse;
    try {
      response = await this.#d.transport.sendBatch({ mutations: batch.map(toWire), pendingItems });
    } catch {
      response = { kind: 'network' };
    }
    switch (response.kind) {
      case 'network':
        return this.#transient(batch, 'network', undefined, tally);
      case 'ok':
        return this.#results(batch, response.body, tally);
      case 'http':
        return this.#httpFailure(batch, response, pendingItems, tally, canRefresh, canSplit, userId);
    }
  }

  async #httpFailure(
    batch: readonly QueueRecord[],
    response: Extract<TransportResponse, { kind: 'http' }>,
    pendingItems: number,
    tally: Tally,
    canRefresh: boolean,
    canSplit: boolean,
    userId: string,
  ): Promise<Step> {
    const { status } = response;
    const code = response.code !== undefined && CODE_PATTERN.test(response.code) ? response.code : undefined;
    if (status === 401) {
      if (code === 'device_wipe_required') return this.#pauseWith('device_wipe_required', userId);
      if (code === 'session_revoked') return this.#pauseWith('session_revoked', userId);
      if (!canRefresh) return this.#pauseWith('auth_required', userId);
      const refreshed = await this.#refresh();
      if (refreshed === 'session_revoked') return this.#pauseWith('session_revoked', userId);
      if (refreshed === 'unavailable') return this.#pauseWith('auth_required', userId);
      return this.#send(batch, pendingItems, tally, false, canSplit, userId);
    }
    if (status === 426) return this.#pauseWith('upgrade_required', userId);
    if (status === 403) return this.#pauseWith('forbidden', userId);
    if (status === 400 || status === 413) {
      if (batch.length > 1 && canSplit) {
        for (const record of batch) {
          if ((await this.#send([record], pendingItems, tally, canRefresh, false, userId)) === 'stop') return 'stop';
        }
        return 'continue';
      }
      for (const record of batch) await this.#attention(record, status === 413 ? 'payload_too_large' : 'envelope_rejected', tally);
      return 'continue';
    }
    if (status === 429 || status === 408 || (status >= 500 && status <= 599)) {
      const transientCode = status === 429 ? 'rate_limited' : status === 408 ? 'timeout' : 'server_error';
      return this.#transient(batch, transientCode, response.retryAfter, tally);
    }
    return this.#pauseWith('unexpected_response', userId);
  }

  /** One refresh for all callers: concurrent 401s wait for the same promise. */
  #refresh(): Promise<RefreshResult> {
    this.#refreshing ??= this.#d.session
      .refresh()
      .catch((): RefreshResult => 'unavailable')
      .finally(() => {
        this.#refreshing = undefined;
      });
    return this.#refreshing;
  }

  async #results(batch: readonly QueueRecord[], body: unknown, tally: Tally): Promise<Step> {
    const list = typeof body === 'object' && body !== null ? (body as { results?: unknown }).results : undefined;
    if (!Array.isArray(list)) return this.#transient(batch, 'invalid_response', undefined, tally);
    const sent = new Set(batch.map((r) => r.mutationId));
    const byId = new Map<string, ResultItem>();
    for (const item of list as unknown[]) {
      const id = typeof item === 'object' && item !== null ? (item as { mutationId?: unknown }).mutationId : undefined;
      if (typeof id !== 'string' || !sent.has(id) || byId.has(id)) {
        this.#emit({ kind: 'ignored_result' });
        continue;
      }
      byId.set(id, parseResult(item as Record<string, unknown>));
    }
    const missing: QueueRecord[] = [];
    const inProgress: QueueRecord[] = [];
    for (const record of batch) {
      const result = byId.get(record.mutationId);
      if (result === undefined) {
        missing.push(record);
      } else if (result.info !== undefined) {
        const { info } = result;
        await this.#guard(() => this.#d.store.settle(record.mutationId, info));
        tally.settled += 1;
        this.#emit({ kind: 'mutation_settled', mutationId: record.mutationId, outcome: info.outcome });
      } else if (result.outcome === 'rejected' && result.code === 'idempotency_in_progress') {
        inProgress.push(record);
      } else if (result.outcome === 'rejected' || result.outcome === 'conflict') {
        const fallback = result.outcome === 'conflict' ? 'id_conflict' : 'unknown';
        const code = result.code === undefined ? fallback : KNOWN_CODES.includes(result.code) ? result.code : 'unknown';
        await this.#attention(record, code, tally);
      } else {
        await this.#attention(record, 'unknown', tally);
      }
    }
    let step: Step = 'continue';
    if (inProgress.length > 0) step = await this.#transient(inProgress, 'idempotency_in_progress', undefined, tally);
    if (missing.length > 0) step = await this.#transient(missing, 'missing_result', undefined, tally);
    return step;
  }

  async #transient(records: readonly QueueRecord[], code: string, retryAfter: string | number | undefined, tally: Tally): Promise<Step> {
    const now = this.#d.clock.now();
    const attempts = records.reduce((max, r) => Math.max(max, r.attempts), 0) + 1;
    const hinted = parseRetryAfter(retryAfter, now, this.#maxRetryAfterMs);
    const delayMs = Math.max(backoffDelay(attempts, this.#d.random, this.#baseDelayMs, this.#maxDelayMs), hinted ?? 0);
    for (const r of records) {
      await this.#patch(r, { state: 'retrying', attempts: r.attempts + 1, lastCode: code, nextAttemptAt: now + delayMs });
    }
    tally.retryScheduled = true;
    this.#emit({ kind: 'retry_scheduled', code, attempts, delayMs, size: records.length });
    return 'stop';
  }

  async #attention(record: QueueRecord, code: string, tally: Tally): Promise<void> {
    await this.#patch(record, { state: 'needs_attention', attempts: record.attempts + 1, lastCode: code });
    tally.attention += 1;
    this.#emit({ kind: 'needs_attention', mutationId: record.mutationId, mutationType: record.type, code });
  }

  async #patch(record: QueueRecord, patch: RecordPatch): Promise<QueueRecord> {
    await this.#guard(() => this.#d.store.update(record.mutationId, patch));
    const next: Record<string, unknown> = { ...record, ...patch };
    if (patch.lastCode === undefined) delete next['lastCode'];
    if (patch.nextAttemptAt === undefined) delete next['nextAttemptAt'];
    return next as unknown as QueueRecord;
  }

  async #guard(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch {
      throw new QueueError('storage_failure');
    }
  }

  #pauseWith(reason: PauseReason, owner: string | null): Step {
    if (this.#pause === 'device_wipe_required') return 'stop';
    if (this.#pause !== reason) {
      this.#pause = reason;
      this.#pausedOwner = owner;
      this.#emit({ kind: 'paused', reason });
      if (
        reason === 'session_revoked' ||
        reason === 'device_wipe_required' ||
        reason === 'upgrade_required' ||
        reason === 'auth_required'
      ) {
        this.#emit({ kind: 'signal', signal: reason });
      }
    }
    return 'stop';
  }

  #emit(event: EngineEvent): void {
    try {
      this.#d.events?.emit(event);
    } catch {
      // diagnostics must never break synchronization
    }
  }
}

function parseResult(item: Record<string, unknown>): ResultItem {
  const outcome = typeof item['outcome'] === 'string' && CODE_PATTERN.test(item['outcome']) ? item['outcome'] : 'unknown';
  const code = typeof item['code'] === 'string' && CODE_PATTERN.test(item['code']) ? item['code'] : undefined;
  let info: SettledInfo | undefined;
  if (outcome === 'applied' || outcome === 'duplicate') {
    const rawWarnings: unknown = item['warnings'];
    const warnings = Array.isArray(rawWarnings)
      ? (rawWarnings as unknown[]).filter((w): w is string => typeof w === 'string' && CODE_PATTERN.test(w)).slice(0, MAX_WARNINGS)
      : [];
    const number = item['workOrderNumber'];
    info = {
      outcome,
      warnings,
      ...(typeof number === 'string' && WORK_ORDER_NUMBER.test(number) ? { workOrderNumber: number } : {}),
    };
  }
  return { outcome, ...(code === undefined ? {} : { code }), info };
}

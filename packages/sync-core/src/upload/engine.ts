import { backoffDelayMs } from './backoff.ts';
import { mapFailure } from './outcome.ts';
import { planParts, type PartRange } from './planner.ts';
import { isTrustedPartUrl } from './url.ts';
import {
  SNAPSHOT_SCHEMA_VERSION,
  UPLOAD_LIMITS,
  UploadFailure,
  type AttentionReason,
  type EngineDeps,
  type JobSnapshot,
  type Outcome,
} from './types.ts';

const SESSION_ID = /^[A-Za-z0-9-]{1,64}$/;
const ETAG = /^[A-Za-z0-9"\-_=+/.]{1,128}$/;

/** Terminal result of a run, thrown from inside the steps. */
class Stop extends Error {
  readonly outcome: Outcome;
  constructor(outcome: Outcome) {
    super(outcome.type);
    this.outcome = outcome;
  }
}
/** The server says the session cannot continue (`409 invalid_state_transition`: expired, aborted or completed). */
class SessionGone extends Error {}
/** `403` on the address of a part: renew the address of this part only. */
class UrlExpired extends Error {}

const attention = (reason: AttentionReason): Stop => new Stop({ type: 'needs_attention', reason });

interface RunContext {
  snapshot: JobSnapshot;
  /** True once this run generated a new session id and key; a second renewal in one run is `needs_attention`. */
  regenerated: boolean;
}

/**
 * Engine of one file upload (EVM-109 AC1, AC2, AC3). `run` is safe to call again after any interruption: ListParts is the source of truth
 * for the parts, `complete` is idempotent, the session id and the idempotency key are persisted before the first POST.
 * The engine has no way to delete a file or a queue entry; after `device_wipe` the instance sends nothing more.
 */
export class UploadEngine {
  private readonly deps: EngineDeps;
  private wiped = false;

  constructor(deps: EngineDeps) {
    this.deps = deps;
  }

  async run(assetId: string, size: number): Promise<Outcome> {
    if (this.wiped) return { type: 'device_wipe' };
    const context = await this.start(assetId, size);
    if (context.snapshot.state === 'uploaded') return { type: 'uploaded' };
    try {
      return await this.drive(context);
    } catch (error) {
      if (!(error instanceof Stop)) throw error;
      return this.finish(context, error.outcome);
    }
  }

  private async finish(context: RunContext, outcome: Outcome): Promise<Outcome> {
    const { store } = this.deps;
    if (outcome.type === 'device_wipe') this.wiped = true;
    if (outcome.type === 'paused_revoked') await store.save({ ...context.snapshot, state: 'paused_revoked' });
    if (outcome.type === 'retry_checksum') await store.clear(context.snapshot.assetId);
    return outcome;
  }

  private async start(assetId: string, size: number): Promise<RunContext> {
    const stored = await this.deps.store.load(assetId);
    if (stored !== null && stored.schemaVersion === SNAPSHOT_SCHEMA_VERSION && stored.size === size) {
      return { snapshot: { ...stored, state: stored.state === 'uploaded' ? 'uploaded' : 'active' }, regenerated: false };
    }
    // Nothing stored, an unknown schema version or a changed file: start from the beginning (the server hands back an active session).
    const snapshot = this.freshSnapshot(assetId, size);
    await this.deps.store.save(snapshot);
    return { snapshot, regenerated: true };
  }

  private freshSnapshot(assetId: string, size: number): JobSnapshot {
    return {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      assetId,
      size,
      uploadSessionId: this.deps.newId(),
      idempotencyKey: this.deps.newId(),
      partSize: null,
      partCount: null,
      completeSent: false,
      state: 'active',
      etags: {},
    };
  }

  private async update(context: RunContext, change: Partial<JobSnapshot>): Promise<void> {
    context.snapshot = { ...context.snapshot, ...change };
    await this.deps.store.save(context.snapshot);
  }

  private async drive(context: RunContext): Promise<Outcome> {
    for (;;) {
      try {
        if (context.snapshot.partSize === null) await this.openSession(context);
        const plan = this.plan(context.snapshot.size, context.snapshot.partSize, context.snapshot.partCount);
        if (!context.snapshot.completeSent) {
          const done = await this.reconcile(context, plan);
          await this.transfer(context, plan, done);
        }
        return await this.complete(context);
      } catch (error) {
        if (!(error instanceof SessionGone)) throw error;
        if (context.regenerated) throw attention('invalid_state');
        // Session expired or aborted: one new session per run, with a new id and key, only when the file state allows it.
        const { assetId, size } = context.snapshot;
        context.snapshot = this.freshSnapshot(assetId, size);
        context.regenerated = true;
        await this.deps.store.save(context.snapshot);
      }
    }
  }

  private plan(size: number, partSize: number | null, partCount: number | null): readonly PartRange[] {
    try {
      return planParts(size, partSize ?? 0, partCount ?? 0);
    } catch {
      // planParts is pure and fails only with PlanMismatchError.
      throw attention('plan_mismatch');
    }
  }

  private async openSession(context: RunContext): Promise<void> {
    const { assetId, uploadSessionId, idempotencyKey } = context.snapshot;
    const session = await this.call(() => this.deps.api.createSession(assetId, uploadSessionId, idempotencyKey));
    if (!SESSION_ID.test(session.id)) throw attention('invalid_server_response');
    this.plan(context.snapshot.size, session.partSize, session.partCount);
    // The server may hand back an already active session of this asset (another id): adopt it.
    await this.update(context, { uploadSessionId: session.id, partSize: session.partSize, partCount: session.partCount });
    await this.deps.checkpoint?.('afterSession');
  }

  /** ListParts is the source of truth. A part counts as sent only when its size equals the expected length. */
  private async reconcile(context: RunContext, plan: readonly PartRange[]): Promise<ReadonlySet<number>> {
    const listed = await this.call(() => this.deps.api.listParts(context.snapshot.uploadSessionId));
    const done = new Set<number>();
    const seen = new Set<number>();
    for (const part of listed) {
      const valid = Number.isInteger(part.partNumber) && part.partNumber >= 1 && part.partNumber <= plan.length;
      if (!valid || seen.has(part.partNumber) || !Number.isInteger(part.size) || part.size < 0) throw attention('invalid_server_response');
      seen.add(part.partNumber);
      if (part.size === plan[part.partNumber - 1]?.length) done.add(part.partNumber);
    }
    const etags = Object.fromEntries(Object.entries(context.snapshot.etags).filter(([number]) => done.has(Number(number))));
    await this.update(context, { etags });
    return done;
  }

  private async transfer(context: RunContext, plan: readonly PartRange[], done: ReadonlySet<number>): Promise<void> {
    const { api, transport, allowedHosts } = this.deps;
    for (const part of plan) {
      if (done.has(part.partNumber)) continue;
      let renewals = 0;
      for (;;) {
        // The address is fetched right before its part is sent and lives only in memory (SR-FILE-02).
        const target = await this.call(() => api.partUrl(context.snapshot.uploadSessionId, part.partNumber));
        if (!isTrustedPartUrl(target.url, allowedHosts)) throw attention('untrusted_part_url');
        if (target.contentLength !== part.length) throw attention('plan_mismatch');
        let etag: string | null;
        try {
          const request = { url: target.url, offset: part.offset, length: part.length, headers: { 'Content-Length': String(part.length) } };
          etag = await this.call(() => transport.put(request), true);
        } catch (error) {
          if (!(error instanceof UrlExpired)) throw error;
          renewals += 1;
          if (renewals > UPLOAD_LIMITS.maxRenewals) throw attention('url_renewal_exhausted');
          continue;
        }
        await this.deps.checkpoint?.('afterPartPut');
        if (etag !== null && !ETAG.test(etag)) throw attention('invalid_server_response');
        const etags = etag === null ? context.snapshot.etags : { ...context.snapshot.etags, [String(part.partNumber)]: etag };
        await this.update(context, { etags });
        await this.deps.checkpoint?.('afterPartSaved');
        break;
      }
    }
  }

  private async complete(context: RunContext): Promise<Outcome> {
    // The mark is persisted before the request: after a lost answer the next run repeats `complete` (idempotent on the server).
    await this.update(context, { completeSent: true });
    await this.deps.checkpoint?.('beforeComplete');
    const result = await this.call(() => this.deps.api.complete(context.snapshot.uploadSessionId));
    const outcome = mapFailure({ kind: 'fileState', state: result.state, reasonCode: result.reasonCode });
    await this.deps.checkpoint?.('afterCompleteBeforeSave');
    if (outcome.type !== 'uploaded') throw new Stop(outcome);
    await this.update(context, { state: 'uploaded' });
    return outcome;
  }

  /** One call with bounded in-process retries; what cannot be retried ends the run through `Stop`. */
  private async call<T>(action: () => Promise<T>, expiredOn403 = false): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await action();
      } catch (error) {
        if (!(error instanceof UploadFailure)) throw error;
        const { failure } = error;
        if (failure.kind === 'http' && failure.status === 403 && expiredOn403) throw new UrlExpired();
        if (failure.kind === 'http' && failure.status === 409 && failure.code === 'invalid_state_transition') throw new SessionGone();
        const outcome = mapFailure(failure);
        if (outcome.type !== 'retry_later') throw new Stop(outcome);
        attempt += 1;
        const delayMs = backoffDelayMs(attempt - 1, this.deps.rng());
        if (attempt >= UPLOAD_LIMITS.maxAttempts) throw new Stop({ type: 'retry_later', delayMs });
        await this.deps.sleep(delayMs);
      }
    }
  }
}

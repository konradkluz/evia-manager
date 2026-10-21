// Reference engine of the upload protocol (ADR-0007 Android strategy: one task per file, parts sequentially from file ranges).
// On the device the same loop runs in Kotlin (the system job runs without JS after force-stop / reboot); this TypeScript
// version is the executable specification, tested in Node against a real S3-compatible server.
// Rules: ListParts is the source of truth for parts; one ETag is written per part immediately after the PUT; a 403 on a part
// means "renew the URL and repeat this one part", never a file error; 401 session_revoked pauses and deletes nothing.
import { backoffDelayMs } from './backoff.ts';
import { planParts } from './planner.ts';
import { ApiError, TransportError, emptyMetrics, type JobStore, type PartTransport, type UploadApi, type UploadJob } from './types.ts';

export interface EngineDeps {
  api: UploadApi;
  transport: PartTransport;
  store: JobStore;
  sleep?: (ms: number) => Promise<void>;
  rng?: () => number;
  now?: () => number;
  /** Test hook: called at named points; throwing here simulates the process being killed exactly there. */
  checkpoint?: (name: Checkpoint, job: UploadJob) => void | Promise<void>;
  maxAttemptsPerPart?: number;
  maxRenewalsPerPart?: number;
}

export type Checkpoint =
  | 'afterSession'
  | 'afterPartPut' // PUT succeeded, ETag not yet saved locally
  | 'afterPartSaved'
  | 'beforeComplete'
  | 'afterCompleteBeforeSave'; // S3 assembled the object, local state not yet updated

export type RunResult = 'uploaded' | 'paused_revoked' | 'retry_later' | 'id_conflict';

export function newJob(p: Pick<UploadJob, 'assetId' | 'deviceId' | 'filePath' | 'size' | 'sha256' | 'contentType'>): UploadJob {
  return { ...p, state: 'pending', etags: {}, metrics: emptyMetrics() };
}

export async function runUpload(initial: UploadJob, deps: EngineDeps): Promise<RunResult> {
  const { api, transport, store } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const maxAttempts = deps.maxAttemptsPerPart ?? 6;
  const maxRenewals = deps.maxRenewalsPerPart ?? 3;
  const hook = async (name: Checkpoint, j: UploadJob) => deps.checkpoint?.(name, j);
  const job = structuredClone(initial);
  job.startedAt ??= now();

  try {
    if (job.state === 'uploaded' || job.state === 'verified' || job.state === 'local_deleted') return 'uploaded';

    // 1. Idempotent session (same assetId -> same session on the server).
    job.session = await api.createSession({
      assetId: job.assetId,
      deviceId: job.deviceId,
      size: job.size,
      sha256: job.sha256,
      contentType: job.contentType,
    });
    job.state = 'uploading';
    await store.save(job);
    await hook('afterSession', job);

    // 2. Reconcile with the server: ListParts decides which parts exist.
    const listed = await api.listParts(job.assetId);
    if (listed.completed) {
      job.state = 'uploaded';
      job.finishedAt = now();
      await store.save(job);
      return 'uploaded';
    }
    const remote = new Map(listed.parts.map((p) => [p.number, p]));
    job.etags = {};
    for (const p of listed.parts) job.etags[p.number] = p.etag;

    const plan = planParts(job.size, {}, job.session.partSize);
    for (const part of plan.parts) {
      if (remote.has(part.number)) {
        job.metrics.skippedParts++;
        continue;
      }
      let attempt = 0;
      let renewals = 0;
      for (;;) {
        const { url } = await api.partUrl(job.assetId, part.number);
        try {
          const { etag } = await transport.put(url, job.filePath, part.offset, part.length);
          job.metrics.partPuts++;
          await hook('afterPartPut', job);
          job.etags[part.number] = etag;
          await store.save(job);
          await hook('afterPartSaved', job);
          break;
        } catch (e) {
          if (e instanceof TransportError && e.status === 403) {
            // Signature expired (TTL): renew and repeat only this part.
            if (++renewals > maxRenewals) throw new ApiError(403, 'url_renewal_exhausted');
            job.metrics.renewals++;
            continue;
          }
          if (e instanceof TransportError) {
            job.metrics.retries++;
            if (++attempt >= maxAttempts) {
              await store.save(job);
              return 'retry_later';
            }
            await sleep(backoffDelayMs(attempt - 1, undefined, deps.rng));
            continue;
          }
          throw e;
        }
      }
    }

    // 3. Complete (idempotent on the server) and only then record the new local state.
    await hook('beforeComplete', job);
    const parts = plan.parts.map((p) => ({ number: p.number, etag: job.etags[p.number]! }));
    await api.complete(job.assetId, parts);
    await hook('afterCompleteBeforeSave', job);
    job.state = 'uploaded';
    job.finishedAt = now();
    await store.save(job);
    return 'uploaded';
  } catch (e) {
    if (e instanceof ApiError && e.code === 'session_revoked') {
      // SR-SYNC-03: queue, pending files and the installation secret stay; nothing is deleted.
      job.state = 'paused_revoked';
      await store.save(job);
      return 'paused_revoked';
    }
    if (e instanceof ApiError && e.code === 'id_conflict') return 'id_conflict';
    if (e instanceof TransportError || (e instanceof ApiError && e.status >= 500)) {
      await store.save(job);
      return 'retry_later';
    }
    throw e;
  }
}

/** Integrity verification: only a matching SHA-256 of the stored object moves the job to `verified`. */
export async function markVerified(store: JobStore, job: UploadJob, remoteSha256: string): Promise<UploadJob> {
  if (job.state !== 'uploaded') throw new Error(`cannot verify a job in state ${job.state}`);
  if (remoteSha256 !== job.sha256) throw new Error('integrity mismatch: stored object differs from the local file');
  const next = { ...job, state: 'verified' as const };
  await store.save(next);
  return next;
}

/**
 * The local original may be removed only after server confirmation. Spike: "verified" = SHA-256 of the object in S3 equals
 * the local one. The production condition is stricter: the media asset must reach state `clean` after the AV scan (SR-FILE-05).
 */
export async function deleteLocalIfVerified(store: JobStore, job: UploadJob, remove: (path: string) => Promise<void>): Promise<UploadJob> {
  if (job.state !== 'verified') throw new Error(`refusing to delete the local file in state ${job.state}`);
  await remove(job.filePath);
  const next = { ...job, state: 'local_deleted' as const };
  await store.save(next);
  return next;
}

/**
 * The worker side of the ZIP export (EVM-052 AC1, AC4; ADR-0009; P10; SR-FILE-07, SR-DATA-07, SR-INFRA-11, CWE-400, CWE-367). The table is the queue (as for the scan of
 * files): a loop of the worker takes ONE export at a time (concurrency one - a 10 GiB archive is a heavy job; `FOR UPDATE SKIP LOCKED`), builds the archive and sweeps
 * the exports whose life is over.
 *
 * BUILD. The set of the photos and the size are computed AGAIN here (files may have come, gone or been erased since the order): none left -> `failed` /
 * `no_media`, above 10 GiB -> `failed` / `too_large`. Every original is read pinned to the version and the ETag that passed the scan (a replaced object is never
 * served in place of the scanned one), counted against `size_bytes` of the database (a difference aborts the archive), streamed through the STORE writer into a
 * multipart upload of the bucket of the exports (parts of 8 MiB; no temporary file; add-only). Before the export becomes `ready` the set is read once more: when
 * a file of the archive has been erased (or deleted) meanwhile, the archive is NOT offered - the exports of the order end and the object goes (SR-PRIV-04).
 * A failure leaves only a closed code in the row (`failure_code`), never the message of the storage; the audit has `media_export.ready` / `media_export.failed`.
 * A stop of the worker (a deploy, `stop_grace_period`) aborts the multipart upload and puts the export back in the queue: the next pass builds the SAME export again.
 *
 * SWEEP. An export is alive for 24 hours (the clock is injected). After that - or after an early end - the object is removed (`DeleteObject` on a bucket without
 * versioning, so the bytes are really gone) and only THEN the row is `expired` with `object_removed_at`; a storage that fails leaves the row for the next pass.
 * Reading and the address already answer `404` from `expires_at` on, whatever the sweep has done. The bucket's own lifecycle rule (one day) is the second line.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import { newTraceId } from '../../../platform/http/request-context.ts';
import type { Logger } from '../../../platform/logging/logger.ts';
import { EXPORT_STORAGE, OBJECT_STORAGE, ObjectStorageError, type ObjectStorage } from '../../../platform/object-storage/object-storage.ts';
import { CLOCK, DATABASE, EVENT_BUS, LOGGER } from '../../../platform/tokens.ts';
import { EXPORT_MAX_BYTES, EXPORT_MAX_FILES, isExportable, planEntries, planSizes, type PlannedEntry } from '../domain/export-plan.ts';
import { zipStream, type ZipEntry } from '../domain/zip-writer.ts';
import type { MediaAuditEvent } from '../events.ts';
import {
  claimNextExport,
  exportCandidates,
  expireExportsOfOrder,
  lockDueExports,
  markFailed,
  markObjectRemoved,
  markReady,
  requeueExport,
  type ExportRow,
  type FailureCode,
} from '../infrastructure/export-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';

const SWEEP_BATCH = 50;
const ARCHIVE_TYPE = 'application/zip';
const ARCHIVE_CACHE_CONTROL = 'private, no-store';

/** The worker was told to stop: the multipart upload is aborted and the export goes back to the queue. */
class StopRequested extends Error {
  constructor() {
    super('stop_requested');
    this.name = 'StopRequested';
  }
}

/** The build ended in a refusal we know (a closed code). */
class BuildRefused extends Error {
  readonly code: FailureCode;

  constructor(code: FailureCode) {
    super(code);
    this.code = code;
    this.name = 'BuildRefused';
  }
}

/** Maps whatever the build threw to a closed code of the row. */
export function failureCodeOf(error: unknown): FailureCode {
  if (error instanceof BuildRefused) return error.code;
  if (error instanceof ObjectStorageError && error.code === 'unavailable') return 'storage_unavailable';
  return 'processing_error';
}

@Injectable()
export class MediaExportBuilder {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #logger: Logger;
  readonly #originals: ObjectStorage | null;
  readonly #exports: ObjectStorage | null;
  #pass: Promise<number> | undefined;
  #stop: AbortController | undefined;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(LOGGER) logger: Logger,
    @Inject(OBJECT_STORAGE) originals: ObjectStorage | null,
    @Inject(EXPORT_STORAGE) exportStorage: ObjectStorage | null,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#logger = logger;
    this.#originals = originals;
    this.#exports = exportStorage;
  }

  /** Both buckets are needed: the originals to read, the bucket of the exports to write. */
  get enabled(): boolean {
    return this.#originals !== null && this.#exports !== null;
  }

  /** Starts the loop; @returns the function that stops it - it aborts the build in progress (back to the queue) and settles once the pass has finished. */
  start(intervalMs = 5000): () => Promise<void> {
    const timer = setInterval(() => {
      this.runOnce().catch(() => {
        this.#logger.error({ job: 'media.export' }, 'media export: pass failed');
      });
    }, intervalMs);
    timer.unref();
    return async () => {
      clearInterval(timer);
      this.#stop?.abort();
      await this.#pass?.catch(() => undefined);
    };
  }

  /** One pass: the sweep of the exports whose life is over, then at most one build. @returns the number of the exports handled */
  runOnce(): Promise<number> {
    if (!this.enabled || this.#pass !== undefined) return Promise.resolve(0);
    this.#pass = this.#run().finally(() => {
      this.#pass = undefined;
    });
    return this.#pass;
  }

  async #run(): Promise<number> {
    const swept = await this.#sweep();
    const built = await this.#buildNext();
    return swept + built;
  }

  // ---- the build ----

  async #buildNext(): Promise<number> {
    const claimed = await runInTransaction(this.#db, (tx) => claimNextExport(mediaTables(tx), this.#clock.now()));
    if (claimed === undefined) return 0;
    const stop = new AbortController();
    this.#stop = stop;
    try {
      await this.#build(claimed, stop.signal);
    } catch (error) {
      await this.#settle(claimed, error);
    } finally {
      this.#stop = undefined;
    }
    return 1;
  }

  async #settle(row: ExportRow, error: unknown): Promise<void> {
    if (error instanceof StopRequested) {
      await runInTransaction(this.#db, (tx) => requeueExport(mediaTables(tx), row.id));
      this.#logger.warn({ job: 'media.export', exportId: row.id }, 'media export: stopped, back in the queue');
      return;
    }
    const code = failureCodeOf(error);
    const failed = await runInTransaction(this.#db, async (tx) => {
      const changed = await markFailed(mediaTables(tx), { exportId: row.id, code });
      if (changed) await this.#publish(tx, 'media_export.failed', 'failed', row.id);
      return changed;
    });
    this.#logger.warn({ job: 'media.export', exportId: row.id, failureCode: code, ended: failed }, 'media export: failed');
  }

  async #build(row: ExportRow, signal: AbortSignal): Promise<void> {
    const originals = this.#originals as ObjectStorage;
    const exports = this.#exports as ObjectStorage;
    const entries = await this.#plan(row);
    const sizes = planSizes(entries);
    if (entries.length === 0) throw new BuildRefused('no_media');
    if (entries.length > EXPORT_MAX_FILES || sizes.archiveBytes > EXPORT_MAX_BYTES) throw new BuildRefused('too_large');

    const zipEntries: ZipEntry[] = entries.map((entry) => ({
      name: entry.name,
      size: entry.size,
      open: () => originals.getObjectStream(entry.objectKey, { versionId: entry.versionId, ifMatch: entry.etag }),
    }));
    const stream = zipStream(zipEntries, row.created_at);
    const onStop = (): void => {
      stream.destroy(new StopRequested());
    };
    signal.addEventListener('abort', onStop, { once: true });
    try {
      await exports.uploadStreamIfAbsent({
        key: row.object_key,
        body: stream,
        size: sizes.archiveBytes,
        contentType: ARCHIVE_TYPE,
        cacheControl: ARCHIVE_CACHE_CONTROL,
      });
    } catch (error) {
      // a repeat after a crash between the upload and the mark: the object of THIS export is already there and complete when its size is the planned one
      if (!(error instanceof ObjectStorageError && error.code === 'precondition_failed')) throw error;
      if ((await exports.head(row.object_key))?.size !== sizes.archiveBytes) {
        await exports.deleteObject(row.object_key);
        throw new BuildRefused('processing_error');
      }
    } finally {
      signal.removeEventListener('abort', onStop);
    }
    await this.#finish(row, entries, sizes.archiveBytes);
  }

  /** The set of the photos as it is NOW (the files may have come, gone or been erased since the order). */
  async #plan(row: ExportRow): Promise<PlannedEntry[]> {
    return planEntries(await runInTransaction(this.#db, (tx) => exportCandidates(mediaTables(tx), row.work_order_id)));
  }

  /** `ready` only when every file of the archive is still a file that may be exported (SR-PRIV-04); otherwise the archive is not offered. */
  async #finish(row: ExportRow, entries: readonly PlannedEntry[], archiveBytes: number): Promise<void> {
    const now = this.#clock.now();
    const ready = await runInTransaction(this.#db, async (tx) => {
      const tables = mediaTables(tx);
      const current = new Map((await exportCandidates(tables, row.work_order_id)).filter(isExportable).map((c) => [c.mediaAssetId, c]));
      const intact = entries.every((entry) => {
        const live = current.get(entry.mediaAssetId);
        return live !== undefined && live.versionId === entry.versionId && live.etag === entry.etag;
      });
      if (!intact) {
        await expireExportsOfOrder(tables, row.work_order_id);
        return false;
      }
      const changed = await markReady(tables, { exportId: row.id, sizeBytes: archiveBytes, fileCount: entries.length, now });
      if (changed) await this.#publish(tx, 'media_export.ready', 'success', row.id);
      return changed;
    });
    if (!ready)
      this.#logger.warn(
        { job: 'media.export', exportId: row.id },
        'media export: ended before it was ready; the object is removed by the sweep',
      );
    else this.#logger.info({ job: 'media.export', exportId: row.id, files: entries.length }, 'media export: ready');
  }

  // ---- the sweep ----

  async #sweep(): Promise<number> {
    const exports = this.#exports as ObjectStorage;
    let removed = 0;
    for (;;) {
      const batch = await runInTransaction(this.#db, async (tx) => {
        const tables = mediaTables(tx);
        const due = await lockDueExports(tables, this.#clock.now(), SWEEP_BATCH);
        let done = 0;
        for (const item of due) {
          try {
            await exports.deleteObject(item.objectKey);
          } catch {
            this.#logger.warn({ job: 'media.export', exportId: item.id }, 'media export: the object could not be removed; it is retried');
            return { taken: due.length, done, failed: true };
          }
          await markObjectRemoved(tables, item.id, this.#clock.now());
          await this.#publish(tx, 'media_export.expired', 'success', item.id);
          done += 1;
        }
        return { taken: due.length, done, failed: false };
      });
      removed += batch.done;
      if (batch.failed || batch.taken < SWEEP_BATCH) break;
    }
    if (removed > 0) this.#logger.info({ job: 'media.export', removed }, 'media export: expired exports removed');
    return removed;
  }

  #publish(tx: Kysely<Database>, type: MediaAuditEvent['type'], outcome: MediaAuditEvent['outcome'], exportId: string): Promise<void> {
    const event: MediaAuditEvent = { type, actor: { type: 'system' }, outcome, objectType: 'media_export', objectId: exportId };
    return this.#events.publish(tx, event, { origin: 'cli', traceId: newTraceId() });
  }
}

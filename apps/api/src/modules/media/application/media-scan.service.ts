/**
 * The scan of uploaded files — the worker's job (EVM-044 AC2, AC3, AC5; ADR-0009, ADR-0010; SR-FILE-03, SR-FILE-05, SR-CRYPTO-05, SR-ERR-01,
 * SR-ERR-02). The API only records `uploaded`; THIS reads the object.
 *
 * Why a polling loop and not one queue message per file: the API has no producer for the queue and the sending of a job is not part of the
 * transaction of `complete`, so a message could be lost silently. The table is the queue: the loop takes the files in `uploaded` and those
 * in `scanning` that nobody has touched for {@link STALE_SCANNING_MS} (a worker died or the scanner was unreachable) — a file never gets stuck
 * without being retried, and the retry is slow enough to be a backoff. Taking a file is a compare-and-set, so two workers (or a repeat) never
 * scan the same file twice; every later change moves from the state it expects.
 *
 * ONE pass over ONE pinned version of the object (`VersionId` and `If-Match`): the same bytes feed the SHA-256, the byte count, the type
 * (the first 4100 bytes) and `INSTREAM` — the three verdicts concern the same file, streamed (the worker has 512 MB). The order of the
 * verdicts is `scan-outcome.ts`. Fail closed: when the scanner cannot give a verdict the file stays `scanning` and the error is a counter
 * and a code in the log, nothing else — a file is `clean` only after an explicit `stream: OK`.
 */
import { createHash } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import { newTraceId } from '../../../platform/http/request-context.ts';
import type { Logger } from '../../../platform/logging/logger.ts';
import { MalwareScanError, type MalwareScanner } from '../../../platform/malware-scan/malware-scanner.ts';
import type { ObjectStorage } from '../../../platform/object-storage/object-storage.ts';
import { normalizeContentType, typeAgrees } from '../domain/file-rules.ts';
import { decideOutcome } from '../domain/scan-outcome.ts';
import type { MediaAuditEvent } from '../events.ts';
import { claimForScan, countStuck, findUnscanned, transitionFile } from '../infrastructure/media-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';

/** A file in `scanning` that nobody has touched for this long is taken again. */
export const STALE_SCANNING_MS = 2 * 60_000;
/** A file still unscanned after this long is reported (warning with a count). */
export const STUCK_WARNING_MS = 30 * 60_000;
const BATCH = 5;
/** What `file-type` needs to recognise the formats of the allow-list. */
const SNIFF_BYTES = 4100;

/** The stream is longer than the file was declared: the transfer is damaged — no verdict of the scanner is needed. */
class OversizeError extends Error {}

export interface ScanDependencies {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
  readonly events: EventBus;
  readonly logger: Logger;
  readonly storage: ObjectStorage | null;
  readonly scanner: MalwareScanner | null;
}

export class MediaScanService {
  readonly #deps: ScanDependencies;
  #running = false;
  #pass: Promise<number> | undefined;

  constructor(deps: ScanDependencies) {
    this.#deps = deps;
  }

  /** Both the storage and the scanner are configured; without them nothing is scanned (and nothing becomes `clean`). */
  get enabled(): boolean {
    return this.#deps.storage !== null && this.#deps.scanner !== null;
  }

  /** Starts the loop; @returns the function that stops it - its promise settles once the pass in progress has finished (no half-scanned file on exit). */
  start(intervalMs = 5000): () => Promise<void> {
    const timer = setInterval(() => {
      this.runOnce().catch(() => {
        this.#deps.logger.error({ job: 'media.scan' }, 'media: scan pass failed');
      });
    }, intervalMs);
    timer.unref();
    return async () => {
      clearInterval(timer);
      await this.#pass?.catch(() => undefined);
    };
  }

  /** One pass: at most {@link BATCH} files, one after another. @returns how many reached a verdict */
  runOnce(): Promise<number> {
    if (!this.enabled || this.#running) return Promise.resolve(0);
    this.#running = true;
    const pass = this.#scanWaiting();
    this.#pass = pass;
    return pass.finally(() => {
      this.#running = false;
    });
  }

  async #scanWaiting(): Promise<number> {
    const { db, clock, logger } = this.#deps;
    const now = clock.now();
    const staleBefore = new Date(now.getTime() - STALE_SCANNING_MS);
    const waiting = await findUnscanned(mediaTables(db), staleBefore, BATCH);
    let decided = 0;
    for (const { id } of waiting) {
      if (await this.scanFile(id)) decided += 1;
    }
    const stuck = await countStuck(mediaTables(db), new Date(now.getTime() - STUCK_WARNING_MS));
    if (stuck > 0) logger.warn({ job: 'media.scan', stuck }, 'media: files wait for a scan for over 30 minutes');
    return decided;
  }

  /** @returns whether the file reached a verdict (`false`: taken by someone else, or the scanner could not decide — it is retried) */
  async scanFile(storedFileId: string): Promise<boolean> {
    const { db, clock, logger, storage, scanner } = this.#deps;
    // runOnce checks `enabled` first; the guard keeps a direct call from scanning without a scanner
    if (storage === null || scanner === null) return false;
    const now = clock.now();
    const file = await claimForScan(mediaTables(db), storedFileId, new Date(now.getTime() - STALE_SCANNING_MS), now);
    if (file === undefined) return false;

    const declaredSize = Number(file.declared_size_bytes);
    const hash = createHash('sha256');
    // mutated by the observer while the scanner reads: one object, so the later reads see the final values
    const seen = { bytes: 0, head: Buffer.alloc(0), oversize: false };
    let infected = false;
    try {
      const body = await storage.getObjectStream(file.object_key, {
        ...(file.s3_version_id === null ? {} : { versionId: file.s3_version_id }),
        ...(file.s3_etag === null ? {} : { ifMatch: file.s3_etag }),
      });
      async function* observed(): AsyncGenerator<Uint8Array> {
        for await (const chunk of body as AsyncIterable<Uint8Array>) {
          seen.bytes += chunk.length;
          if (seen.bytes > declaredSize) {
            seen.oversize = true; // set before the throw: the client of the scanner turns every error of its source into its own
            throw new OversizeError();
          }
          hash.update(chunk);
          if (seen.head.length < SNIFF_BYTES) seen.head = Buffer.concat([seen.head, chunk.subarray(0, SNIFF_BYTES - seen.head.length)]);
          yield chunk;
        }
      }
      infected = (await scanner.scan(observed())).status === 'infected';
    } catch (error) {
      if (!seen.oversize) {
        // no verdict: the file stays `scanning` and is taken again after the stale period (never clean without a scan)
        logger.warn(
          { job: 'media.scan', storedFileId, errorType: error instanceof MalwareScanError ? 'scanner' : 'storage' },
          'media: a file could not be scanned; it stays in scanning and is retried',
        );
        return false;
      }
    }

    const sha256 = seen.oversize ? null : hash.digest('hex');
    const detected = seen.oversize ? undefined : await fileTypeFromBuffer(seen.head);
    const outcome = decideOutcome({
      infected,
      checksumMatches: !seen.oversize && sha256 === file.declared_sha256 && seen.bytes === declaredSize,
      typeMatches: typeAgrees(detected?.mime, file.declared_content_type, file.original_filename),
    });
    return runInTransaction(db, async (tx) => {
      const moved = await transitionFile(
        mediaTables(tx),
        file.id,
        'scanning',
        {
          state: outcome.state,
          reason: outcome.reason,
          sizeBytes: seen.oversize ? null : seen.bytes,
          sha256,
          contentType: detected === undefined ? null : (normalizeContentType(detected.mime) ?? null),
        },
        this.#deps.clock.now(),
      );
      if (!moved) return false;
      if (outcome.state === 'quarantined' && file.media_asset_id !== null) {
        const event: MediaAuditEvent = {
          type: 'media_file.quarantined',
          actor: { type: 'system' },
          outcome: 'success',
          objectType: 'media_asset',
          objectId: file.media_asset_id,
        };
        await this.#deps.events.publish(tx, event, { origin: 'cli', traceId: newTraceId() });
      }
      logger.info({ job: 'media.scan', storedFileId: file.id, state: outcome.state }, 'media: a file was scanned');
      return true;
    });
  }
}

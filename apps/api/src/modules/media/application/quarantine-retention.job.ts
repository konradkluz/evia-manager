/**
 * The retention of the quarantine (EVM-049 AC5; SR-DATA-07, P4, ADR-0009): a job of the worker, every hour, removes the object of every file
 * that has been in quarantine for 30 days. It is a TECHNICAL retention, not an entry of the register of deletions: the row of metadata stays
 * (the tile "Plik usunięty po 30 dniach kwarantanny"), `purged_at` marks the removal, and a database restored from a backup repeats the removal
 * by itself (the delete of the storage is idempotent).
 *
 * The deadline is `media.quarantine_expires_at` (the start of the business day of the first entry + 30 calendar days, `Europe/Warsaw`), the
 * very expression the API shows. One batch (100) per transaction, the rows locked `FOR UPDATE SKIP LOCKED`: two workers never take the same
 * file, and a new scan or a late verdict of a scan cannot slip in - a file held in `scanning` past its deadline is first returned to
 * `quarantined` (its verdict, if it comes later, finds nothing to move), a request for a new scan after the deadline is refused by its own
 * compare-and-set. The order for each file: the storage first (`DeleteObject` WITHOUT a version = a delete marker; ADR-0009 allows the
 * application nothing more, the older versions go with the lifecycle of the bucket), then `purged_at` and the audit event. A failure of the
 * storage leaves `purged_at` empty and the file is taken again by the next run; the batch stops at the first failure (an outage must not hold
 * a transaction open for every file). The result is counts only; the log has counts, never a key or a name.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import { newTraceId } from '../../../platform/http/request-context.ts';
import { JobFailure, type JobCounts, type JobDefinition, type JobSchedule } from '../../../platform/jobs/index.ts';
import type { Logger } from '../../../platform/logging/logger.ts';
import { OBJECT_STORAGE, type ObjectStorage } from '../../../platform/object-storage/object-storage.ts';
import { CLOCK, DATABASE, EVENT_BUS, LOGGER } from '../../../platform/tokens.ts';
import type { Kysely } from 'kysely';
import type { MediaAuditEvent } from '../events.ts';
import { eventOwnerOfFile } from './quarantine-alert.ts';
import { lockDueForPurge, markPurged, transitionFile } from '../infrastructure/media-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';

export const QUARANTINE_RETENTION_JOB = 'media.quarantine-retention';
export const QUARANTINE_RETENTION_FAILED = 'quarantine_retention_failed';
/** Every hour, five minutes past (the deadline is midnight of the business day): a failed run is made up by the next one. */
export const QUARANTINE_RETENTION_SCHEDULE: JobSchedule = { cron: '5 * * * *', timezone: 'Europe/Warsaw' };
const BATCH = 100;
/** One run takes at most this many batches, so a large backlog is worked off over a few runs without holding the worker. */
const MAX_BATCHES = 20;

@Injectable()
export class QuarantineRetentionJob {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #logger: Logger;
  readonly #storage: ObjectStorage | null;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(LOGGER) logger: Logger,
    @Inject(OBJECT_STORAGE) storage: ObjectStorage | null,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#logger = logger;
    this.#storage = storage;
  }

  definition(): JobDefinition {
    return { name: QUARANTINE_RETENTION_JOB, schedule: QUARANTINE_RETENTION_SCHEDULE, handler: () => this.run() };
  }

  async run(): Promise<JobCounts> {
    const storage = this.#storage;
    if (storage === null) {
      this.#logger.warn({ job: QUARANTINE_RETENTION_JOB }, 'quarantine retention: the storage is not configured; nothing is removed');
      return { purged: 0, failed: 0 };
    }
    let purged = 0;
    let failed = 0;
    try {
      for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const done = await this.#batch(storage);
        purged += done.purged;
        failed += done.failed;
        if (done.taken < BATCH || done.failed > 0) break;
      }
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      this.#logger.error(
        {
          job: QUARANTINE_RETENTION_JOB,
          errorType: error instanceof Error ? error.name : 'unknown',
          errorCode: typeof code === 'string' ? code : undefined,
        },
        'quarantine retention: failed',
      );
      throw new JobFailure(QUARANTINE_RETENTION_FAILED);
    }
    this.#logger.info({ job: QUARANTINE_RETENTION_JOB, purged, failed }, 'quarantine retention: done');
    return { purged, failed };
  }

  async #batch(storage: ObjectStorage): Promise<{ taken: number; purged: number; failed: number }> {
    return runInTransaction(this.#db, async (tx) => {
      const now = this.#clock.now();
      const tables = mediaTables(tx);
      const due = await lockDueForPurge(tables, now, BATCH);
      let purged = 0;
      let failed = 0;
      for (const file of due) {
        // a file held in a new scan past its deadline goes back to `quarantined` first: its verdict, if it comes later, finds nothing to move
        if (file.state === 'scanning') {
          await transitionFile(tables, file.id, 'scanning', { state: 'quarantined', reason: 'malware_detected' }, now);
        }
        try {
          await storage.deleteObject(file.objectKey);
        } catch {
          failed += 1;
          this.#logger.warn(
            { job: QUARANTINE_RETENTION_JOB, storedFileId: file.id },
            'quarantine retention: the object could not be removed; it is retried',
          );
          break;
        }
        if (await markPurged(tables, file.id, now)) {
          purged += 1;
          const owner = await eventOwnerOfFile(tx, { media_asset_id: file.mediaAssetId, document_version_id: file.documentVersionId });
          if (owner !== undefined) {
            const event: MediaAuditEvent = {
              type: 'media_file.quarantine_purged',
              actor: { type: 'system' },
              outcome: 'success',
              objectType: owner.objectType,
              objectId: owner.objectId,
            };
            await this.#events.publish(tx, event, { origin: 'cli', traceId: newTraceId() });
          }
        }
      }
      return { taken: due.length, purged, failed };
    });
  }
}

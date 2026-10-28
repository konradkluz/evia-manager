/**
 * The sweeper of abandoned uploads (EVM-049 D9, RR-NOC-T1-4; ADR-0009): a job of the worker, every night, marks the files that have waited in
 * `pending_upload` for longer than `MEDIA_ABANDON_AFTER_DAYS` (7) WITHOUT an active, unexpired upload session as `failed` with the reason
 * `abandoned`, closes their sessions that are still marked `active` (expired) and aborts the multipart upload in the storage. Nothing is
 * deleted and no identifier is lost: `create-upload-session` resumes a file `failed`/`abandoned` exactly like a `checksum_mismatch` (the same
 * key of the object, a new session), so a phone that was offline for longer than the sweeper waits ("zero utraty danych") only starts the upload
 * again. A medium also leaves the count of the unfinished ones (the limits of D9), because only `pending_upload` counts.
 *
 * One batch (100) per transaction; the rows are locked `FOR UPDATE SKIP LOCKED` with the lock the creation of a session also takes, and the
 * check "no active session" is made in the same statement as the lock - a session opened at the same moment either wins or finds the file
 * already `abandoned` and resumes it. The abort in the storage runs AFTER the commit and uses only the upload id and the key from the database;
 * a failure is counted and logged (a code, no key): an upload not aborted is removed by the lifecycle of the bucket (abort of incomplete uploads).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { AppConfig } from '../../../platform/config/config.ts';
import { DEFAULT_MEDIA_LIMITS, type MediaLimits } from '../../../platform/config/media-config.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import { JobFailure, type JobCounts, type JobDefinition, type JobSchedule } from '../../../platform/jobs/index.ts';
import type { Logger } from '../../../platform/logging/logger.ts';
import { OBJECT_STORAGE, type ObjectStorage } from '../../../platform/object-storage/object-storage.ts';
import { APP_CONFIG, CLOCK, DATABASE, LOGGER } from '../../../platform/tokens.ts';
import { lockAbandoned, setSessionState, transitionFile, type AbandonedFile } from '../infrastructure/media-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';

export const ABANDONED_UPLOADS_JOB = 'media.abandoned-uploads';
export const ABANDONED_UPLOADS_FAILED = 'abandoned_uploads_failed';
/** Every night at 02:40 (the business zone), when nobody uploads. */
export const ABANDONED_UPLOADS_SCHEDULE: JobSchedule = { cron: '40 2 * * *', timezone: 'Europe/Warsaw' };
const BATCH = 100;
const MAX_BATCHES = 20;
const DAY_MS = 24 * 3_600_000;

@Injectable()
export class AbandonedUploadsJob {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #storage: ObjectStorage | null;
  readonly #limits: MediaLimits;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(LOGGER) logger: Logger,
    @Inject(OBJECT_STORAGE) storage: ObjectStorage | null,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#logger = logger;
    this.#storage = storage;
    this.#limits = config.media?.limits ?? DEFAULT_MEDIA_LIMITS;
  }

  definition(): JobDefinition {
    return { name: ABANDONED_UPLOADS_JOB, schedule: ABANDONED_UPLOADS_SCHEDULE, handler: () => this.run() };
  }

  async run(): Promise<JobCounts> {
    let abandoned = 0;
    let aborted = 0;
    let abortFailed = 0;
    try {
      for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const taken = await this.#batch();
        abandoned += taken.length;
        for (const file of taken) {
          for (const session of file.sessions) {
            if (await this.#abort(file.objectKey, session.uploadId, file.id)) aborted += 1;
            else abortFailed += 1;
          }
        }
        if (taken.length < BATCH) break;
      }
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      this.#logger.error(
        {
          job: ABANDONED_UPLOADS_JOB,
          errorType: error instanceof Error ? error.name : 'unknown',
          errorCode: typeof code === 'string' ? code : undefined,
        },
        'abandoned uploads: failed',
      );
      throw new JobFailure(ABANDONED_UPLOADS_FAILED);
    }
    this.#logger.info({ job: ABANDONED_UPLOADS_JOB, abandoned, aborted, abortFailed }, 'abandoned uploads: done');
    return { abandoned, aborted, abortFailed };
  }

  async #batch(): Promise<AbandonedFile[]> {
    return runInTransaction(this.#db, async (tx) => {
      const now = this.#clock.now();
      const tables = mediaTables(tx);
      const cutoff = new Date(now.getTime() - this.#limits.abandonAfterDays * DAY_MS);
      const files = await lockAbandoned(tables, cutoff, now, BATCH);
      for (const file of files) {
        await transitionFile(tables, file.id, 'pending_upload', { state: 'failed', reason: 'abandoned' }, now);
        for (const session of file.sessions) await setSessionState(tables, session.id, 'active', 'expired', now);
      }
      return files;
    });
  }

  async #abort(objectKey: string, uploadId: string, storedFileId: string): Promise<boolean> {
    if (this.#storage === null) return false;
    try {
      await this.#storage.abortMultipartUpload(objectKey, uploadId);
      return true;
    } catch {
      this.#logger.warn({ job: ABANDONED_UPLOADS_JOB, storedFileId }, 'abandoned uploads: the upload could not be aborted in the storage');
      return false;
    }
  }
}

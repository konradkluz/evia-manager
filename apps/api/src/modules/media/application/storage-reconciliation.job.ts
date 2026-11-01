/**
 * The reconciliation of the storage with the database (EVM-051 AC5; SR-FILE-11, SR-LOG-02): a job of the worker, once a night, lists the bucket and compares it with
 * the rows. It REPORTS and never deletes or repairs anything.
 *   - `orphan_objects`: an object in the bucket that no row knows (not an original, not a derivative) and that is older than the grace period (an object
 *     written a moment ago may only wait for its row);
 *   - `missing_objects`: a file that is `ready` (not erased) - or its derivative - with no object in the bucket, older than the grace period.
 * A file still on its way (`pending_upload`, `uploaded`, `scanning`, `clean`, `processing`) is not compared, and an erased file (`erased_at`) never raises an alert.
 * The result is two numbers: a gauge each and, when either is above zero, ONE log entry with the stable fields `alert: "storage_reconciliation"` and
 * `alertCode: "storage_discrepancy"` (the rule of EVM-062 matches on them) - never a key, a name, a description or an identifier. The listing needs
 * `s3:ListBucket`, which only the key of the worker has: the keys handed to the clients never do (tofu, a test keeps it so). The walk is paged and bounded
 * in pages and in time; a walk that stops early says so (`complete: false`), sets no gauge and compares nothing it did not see.
 */
import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { JobFailure, type JobCounts, type JobDefinition, type JobSchedule } from '../../../platform/jobs/index.ts';
import type { Logger } from '../../../platform/logging/logger.ts';
import type { Gauge, MetricsRegistry } from '../../../platform/metrics/metrics.ts';
import { OBJECT_STORAGE, type ObjectStorage } from '../../../platform/object-storage/object-storage.ts';
import { CLOCK, DATABASE, LOGGER, METRICS } from '../../../platform/tokens.ts';

export const STORAGE_RECONCILIATION_JOB = 'media.storage-reconciliation';
export const STORAGE_RECONCILIATION_FAILED = 'storage_reconciliation_failed';
export const STORAGE_RECONCILIATION_SCHEDULE: JobSchedule = { cron: '30 3 * * *', timezone: 'Europe/Warsaw' };
export const ORPHAN_OBJECTS_METRIC = 'storage_reconciliation_orphan_objects';
export const MISSING_OBJECTS_METRIC = 'storage_reconciliation_missing_objects';
export const RECONCILIATION_ALERT_CODE = 'storage_discrepancy';
const PREFIXES = ['media/', 'documents/'] as const;
export const PAGE_SIZE = 1000;
export const MAX_PAGES = 500;
export const MAX_DURATION_MS = 15 * 60_000;
export const GRACE_MS = 3_600_000;

@Injectable()
export class StorageReconciliationJob {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #storage: ObjectStorage | null;
  readonly #orphans: Gauge;
  readonly #missing: Gauge;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(LOGGER) logger: Logger,
    @Inject(OBJECT_STORAGE) storage: ObjectStorage | null,
    @Inject(METRICS) metrics: MetricsRegistry,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#logger = logger;
    this.#storage = storage;
    this.#orphans = metrics.gauge(ORPHAN_OBJECTS_METRIC);
    this.#missing = metrics.gauge(MISSING_OBJECTS_METRIC);
  }

  definition(): JobDefinition {
    return { name: STORAGE_RECONCILIATION_JOB, schedule: STORAGE_RECONCILIATION_SCHEDULE, handler: () => this.run() };
  }

  async run(): Promise<JobCounts> {
    const storage = this.#storage;
    if (storage === null) {
      this.#logger.warn({ job: STORAGE_RECONCILIATION_JOB }, 'storage reconciliation: the storage is not configured; nothing is compared');
      return { orphanObjects: 0, missingObjects: 0, complete: 0 };
    }
    const started = this.#clock.now();
    const deadline = started.getTime() + MAX_DURATION_MS;
    const youngerThan = new Date(started.getTime() - GRACE_MS);
    let orphanObjects = 0;
    let missingObjects = 0;
    let pages = 0;
    let complete = true;
    try {
      for (const prefix of PREFIXES) {
        let token: string | undefined;
        let previousLast: string | undefined;
        do {
          if (pages >= MAX_PAGES || this.#clock.now().getTime() > deadline) {
            complete = false;
            break;
          }
          pages += 1;
          const page = await storage.listObjects(prefix, PAGE_SIZE, token);
          const last = page.objects.at(-1)?.key;
          const upper = page.nextToken === undefined ? undefined : last;
          const listed = new Set(page.objects.map((object) => object.key));
          const known = await this.#known(prefix, previousLast, upper);
          orphanObjects += page.objects.filter((object) => !known.has(object.key) && object.modifiedAt < youngerThan).length;
          const expected = await this.#expected(prefix, previousLast, upper, youngerThan);
          missingObjects += expected.filter((key) => !listed.has(key)).length;
          token = page.nextToken;
          previousLast = last;
        } while (token !== undefined);
        if (!complete) break;
      }
    } catch (error) {
      this.#logger.error(
        { job: STORAGE_RECONCILIATION_JOB, errorType: error instanceof Error ? error.name : 'unknown' },
        'storage reconciliation: failed',
      );
      throw new JobFailure(STORAGE_RECONCILIATION_FAILED);
    }
    if (complete) {
      this.#orphans.set(orphanObjects);
      this.#missing.set(missingObjects);
    }
    if (complete && orphanObjects + missingObjects > 0) {
      this.#logger.error(
        { alert: 'storage_reconciliation', alertCode: RECONCILIATION_ALERT_CODE, orphanObjects, missingObjects },
        'storage reconciliation: the bucket and the database disagree',
      );
    } else {
      this.#logger.info({ job: STORAGE_RECONCILIATION_JOB, orphanObjects, missingObjects, complete }, 'storage reconciliation: done');
    }
    return { orphanObjects, missingObjects, complete: complete ? 1 : 0 };
  }

  /** Every key a row knows in the range (an original or a derivative, whatever the state - an object of a file on its way is not an orphan). */
  async #known(prefix: string, after: string | undefined, upTo: string | undefined): Promise<Set<string>> {
    const rows = await sql<{ key: string }>`
      select object_key as key from media.stored_files where ${rangeOf(sql.ref('object_key'), prefix, after, upTo)}
      union
      select object_key as key from media.file_derivatives where ${rangeOf(sql.ref('object_key'), prefix, after, upTo)}`.execute(this.#db);
    return new Set(rows.rows.map((row) => row.key));
  }

  /** The keys that must exist: `ready` and not erased, older than the grace period. */
  async #expected(prefix: string, after: string | undefined, upTo: string | undefined, olderThan: Date): Promise<string[]> {
    const rows = await sql<{ key: string }>`
      select f.object_key as key from media.stored_files f
        where f.state = 'ready' and f.erased_at is null and f.state_changed_at < ${olderThan} and ${rangeOf(sql.ref('f.object_key'), prefix, after, upTo)}
      union
      select d.object_key as key from media.file_derivatives d join media.stored_files f on f.id = d.stored_file_id
        where f.state = 'ready' and f.erased_at is null and f.state_changed_at < ${olderThan} and ${rangeOf(sql.ref('d.object_key'), prefix, after, upTo)}`.execute(
      this.#db,
    );
    return rows.rows.map((row) => row.key);
  }
}

/** The window of a page in the order of the bucket (bytes: `COLLATE "C"`): after the last key of the previous page, up to the last key of this one. */
function rangeOf(col: RawBuilder<unknown>, prefix: string, after: string | undefined, upTo: string | undefined) {
  const lower = after === undefined ? sql`true` : sql`${col} collate "C" > ${after}::text collate "C"`;
  const upper = upTo === undefined ? sql`true` : sql`${col} collate "C" <= ${upTo}::text collate "C"`;
  return sql`(${col} collate "C" like ${`${prefix}%`} and ${lower} and ${upper})`;
}

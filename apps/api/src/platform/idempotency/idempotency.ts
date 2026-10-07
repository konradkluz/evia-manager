/**
 * Idempotency of mutations (api-guidelines.md → Idempotencja; ADR-0004; SR-API-05, AB-09; EVM-020 AC4). An explicit port the use
 * case calls INSIDE its unit of work — not an interceptor: the record and the change are one transaction, so the record exists
 * exactly when the change committed and nothing is left behind by a crash or a rollback (no `in_progress` state to expire).
 *
 * `run(tx, request, operation)`:
 * 1. `pg_try_advisory_xact_lock` on (user, device, key): a request that does not get it runs in parallel with the same key —
 *    `409 idempotency_in_progress` with `Retry-After: 1` (it never waits on a lock or an index);
 * 2. a live record (not expired) of the same scope and body hash — a REPEAT: the stored minimal result is returned and the
 *    operation does not run again (no second audit event); another scope or hash — `422 idempotency_mismatch`, whoever's the key
 *    was (the key is bound to the user, so another user's key never replays a result to this one);
 * 3. no record — the operation runs and the record is written in the same transaction. Only a 2xx result is stored: an error
 *    throws, the transaction rolls back, the key stays free. An expired record is overwritten
 *    (`ON CONFLICT … DO UPDATE WHERE expires_at <= now`).
 * The result is minimal — status, code, id of the resource — never the response body (it is read again with the permissions of
 * the moment). The lock key excludes the scope on purpose: uniqueness is per (user, device, key), so the same key on another
 * operation is held off or answered as a mismatch, never executed next to the first.
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Clock } from '../clock/clock.ts';
import type { Database } from '../database/database.ts';
import { ProblemException } from '../http/problem.ts';
import type { Counter, MetricsRegistry } from '../metrics/metrics.ts';

export const IDEMPOTENCY = Symbol('IDEMPOTENCY');

/** Retention of a record (ADR-0004): 30 days. */
export const IDEMPOTENCY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_MISMATCH_METRIC = 'idempotency_mismatch';
export const IDEMPOTENCY_IN_PROGRESS_METRIC = 'idempotency_in_progress';

export interface IdempotencyRequest {
  readonly userId: string;
  /** The device of the session; `null` for the web channel. */
  readonly deviceId: string | null;
  /** The `Idempotency-Key` header (UUIDv7, validated by the caller). */
  readonly key: string;
  /** Method and route template, e.g. `POST /api/v1/customers`. */
  readonly scope: string;
  /** `requestHash` of the parsed body. */
  readonly bodyHash: string;
}

/** What is remembered of an operation that succeeded. */
export interface StoredResult {
  /** 2xx */
  readonly status: number;
  readonly code: string | null;
  readonly resourceId: string | null;
}

export type IdempotentOutcome<T> =
  | { readonly replayed: false; readonly value: T; readonly result: StoredResult }
  | { readonly replayed: true; readonly result: StoredResult };

export interface Idempotency {
  run<T>(
    tx: Kysely<Database>,
    request: IdempotencyRequest,
    operation: () => Promise<{ readonly value: T; readonly result: StoredResult }>,
  ): Promise<IdempotentOutcome<T>>;
}

interface RecordsTable {
  id: string;
  user_id: string;
  device_id: string | null;
  idempotency_key: string;
  scope: string;
  request_hash: string;
  result_status: number;
  result_code: string | null;
  result_resource_id: string | null;
  created_at: Date;
  expires_at: Date;
}

type PlatformTables = { 'platform.idempotency_records': Omit<RecordsTable, 'id'> & { id?: string } };

const tables = (db: Kysely<Database>): Kysely<PlatformTables> => db.$extendTables<PlatformTables>();

export class PgIdempotency implements Idempotency {
  readonly #clock: Clock;
  readonly #mismatches: Counter;
  readonly #inProgress: Counter;

  constructor(clock: Clock, metrics: MetricsRegistry) {
    this.#clock = clock;
    this.#mismatches = metrics.counter(IDEMPOTENCY_MISMATCH_METRIC, []);
    this.#inProgress = metrics.counter(IDEMPOTENCY_IN_PROGRESS_METRIC, []);
  }

  async run<T>(
    tx: Kysely<Database>,
    request: IdempotencyRequest,
    operation: () => Promise<{ readonly value: T; readonly result: StoredResult }>,
  ): Promise<IdempotentOutcome<T>> {
    const now = this.#clock.now();
    await this.#lock(tx, request);

    const existing = await this.#liveRecord(tx, request, now);
    if (existing !== undefined) {
      if (existing.scope !== request.scope || existing.request_hash !== request.bodyHash) {
        this.#mismatches.increment({});
        throw new ProblemException('idempotency_mismatch');
      }
      return {
        replayed: true,
        result: { status: existing.result_status, code: existing.result_code, resourceId: existing.result_resource_id },
      };
    }

    const { value, result } = await operation();
    await this.#store(tx, request, result, now);
    return { replayed: false, value, result };
  }

  async #lock(tx: Kysely<Database>, request: IdempotencyRequest): Promise<void> {
    const name = `idempotency|${request.userId}|${request.deviceId ?? ''}|${request.key}`;
    const { rows } = await sql<{ locked: boolean }>`select pg_try_advisory_xact_lock(hashtextextended(${name}, 0)) as locked`.execute(tx);
    if (rows[0]?.locked !== true) {
      this.#inProgress.increment({});
      throw new ProblemException('idempotency_in_progress', { retryAfterSeconds: 1 });
    }
  }

  #liveRecord(tx: Kysely<Database>, request: IdempotencyRequest, now: Date) {
    const query = tables(tx)
      .selectFrom('platform.idempotency_records')
      .select(['scope', 'request_hash', 'result_status', 'result_code', 'result_resource_id'])
      .where('user_id', '=', request.userId)
      .where('idempotency_key', '=', request.key)
      .where('expires_at', '>', now);
    return (
      request.deviceId === null ? query.where('device_id', 'is', null) : query.where('device_id', '=', request.deviceId)
    ).executeTakeFirst();
  }

  async #store(tx: Kysely<Database>, request: IdempotencyRequest, result: StoredResult, now: Date): Promise<void> {
    const values = {
      scope: request.scope,
      request_hash: request.bodyHash,
      result_status: result.status,
      result_code: result.code,
      result_resource_id: result.resourceId,
      created_at: now,
      expires_at: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
    };
    const stored = await tables(tx)
      .insertInto('platform.idempotency_records')
      .values({ user_id: request.userId, device_id: request.deviceId, idempotency_key: request.key, ...values })
      .onConflict((conflict) =>
        conflict
          .columns(['user_id', 'device_id', 'idempotency_key'])
          .doUpdateSet(values)
          .where('platform.idempotency_records.expires_at', '<=', now),
      )
      .executeTakeFirst();
    // Under the advisory lock the only row that can be in the way is an expired one, which the update takes over.
    if (stored.numInsertedOrUpdatedRows !== 1n) throw new Error('idempotency record was not stored');
  }
}

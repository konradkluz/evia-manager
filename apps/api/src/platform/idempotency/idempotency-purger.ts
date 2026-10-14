/**
 * The cleanup of expired idempotency records (EVM-079; ADR-0004): one call removes one batch through the SECURITY DEFINER function
 * of the migration 0032 — the application role has no `DELETE` on the table, and the function deletes only rows that are expired
 * at the instant of the application clock and not in the future of the database clock. The port is what the job knows; the adapter is the only code that names the function.
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Clock } from '../clock/clock.ts';
import type { Database } from '../database/database.ts';

export const IDEMPOTENCY_PURGER = Symbol('IDEMPOTENCY_PURGER');

export interface IdempotencyPurger {
  /** @returns the number of expired records deleted (at most `batch`) */
  purgeBatch(batch: number): Promise<number>;
}

export class PgIdempotencyPurger implements IdempotencyPurger {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;

  constructor(db: Kysely<Database>, clock: Clock) {
    this.#db = db;
    this.#clock = clock;
  }

  async purgeBatch(batch: number): Promise<number> {
    const { rows } = await sql<{
      purged: number;
    }>`select platform.purge_expired_idempotency_records(${batch}, ${this.#clock.now()}) as purged`.execute(this.#db);
    return rows[0]?.purged ?? 0;
  }
}

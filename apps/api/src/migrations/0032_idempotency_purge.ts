/**
 * 0032 — the purge of expired idempotency records (EVM-079; ADR-0004; SR-API-05). Expand only: an index and a function, nothing
 * existing changes. The application role still has NO `DELETE` on the table (0012): it may only call
 * `platform.purge_expired_idempotency_records(batch, as_of)`, a SECURITY DEFINER function (it runs with the rights of the
 * migrator, its owner) that is the narrowest grant possible:
 * - it deletes ONLY expired rows: `expires_at <= least(as_of, clock_timestamp())`. The instant `as_of` comes from the clock of the
 *   application (ADR-0014: business time is not read from the database, so the tests control it), and it is capped by the clock
 *   of the database, so a caller can never push it into the future and remove a record that is still valid (a key that is still
 *   valid keeps replaying its result);
 * - one call is one batch (at most `batch` rows, 1…5000; a fixed upper bound), picked with `FOR UPDATE SKIP LOCKED`: two
 *   instances at once take different rows (nothing is deleted twice, nothing waits), and a row that a request holds is left for
 *   the next run — the lock of the writers of the API is never contended for long;
 * - it returns the number of deleted rows only; `search_path` is pinned (pg_catalog first, objects fully qualified) so a schema of
 *   the caller cannot hijack it; EXECUTE is revoked from PUBLIC and granted to `evia_app` only.
 * The index on `expires_at` keeps a batch cheap however large the table is.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`create index idempotency_records_expires_at_idx on platform.idempotency_records (expires_at)`.execute(db);
  await sql`
    create function platform.purge_expired_idempotency_records(batch integer, as_of timestamptz) returns integer
    language sql volatile security definer set search_path = pg_catalog, pg_temp
    as $$
      with doomed as (
        select id from platform.idempotency_records
        where expires_at <= least(as_of, pg_catalog.clock_timestamp())
        order by expires_at
        limit least(greatest(batch, 1), 5000)
        for update skip locked
      ), purged as (
        delete from platform.idempotency_records records using doomed where records.id = doomed.id returning 1
      )
      select pg_catalog.count(*)::integer from purged
    $$
  `.execute(db);
  await sql`revoke all on function platform.purge_expired_idempotency_records(integer, timestamptz) from public`.execute(db);
  await sql`grant execute on function platform.purge_expired_idempotency_records(integer, timestamptz) to evia_app`.execute(db);
}

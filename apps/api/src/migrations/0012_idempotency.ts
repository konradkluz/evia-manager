/**
 * 0012 — idempotency records (ADR-0004, api-guidelines.md → Idempotencja; EVM-020; SR-API-05). Expand only. A record is written
 * IN THE TRANSACTION of the operation it protects, so it exists only when the operation committed: there is no `in_progress`
 * state to be left behind by a crash (a parallel request is held off by a transaction advisory lock instead). Rules:
 * - the key is (user, device, `Idempotency-Key`); the device is NULL for the web channel, so the uniqueness is
 *   `UNIQUE NULLS NOT DISTINCT` (PostgreSQL 15+) and the primary key is a surrogate (no nullable column in a key);
 * - `scope` (method + route template) and `request_hash` (SHA-256 of the canonical JSON of the parsed body) are compared on a
 *   repeat: another scope or hash is `422 idempotency_mismatch`; the same key on another operation never replays another result;
 * - the result is minimal — status (only 2xx are stored), a code, the id of the resource — never the response body, which is
 *   read again with the permissions of the moment;
 * - `expires_at` is 30 days; an expired record is overwritten by the next use of the key (`ON CONFLICT … DO UPDATE WHERE
 *   expires_at <= now`). Deleting expired rows is a job of its own (DELETE is not granted until it exists);
 * - the hash of a body with personal data is not reversible (the body carries a random identifier), the class is WEW.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table platform.idempotency_records (
      id uuid primary key default uuidv7(),
      user_id uuid not null,
      device_id uuid,
      idempotency_key uuid not null,
      scope text not null check (length(scope) between 1 and 200),
      request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
      result_status integer not null check (result_status between 200 and 299),
      result_code text check (length(result_code) between 1 and 64),
      result_resource_id uuid,
      created_at timestamptz not null,
      expires_at timestamptz not null,
      constraint idempotency_records_key_unique unique nulls not distinct (user_id, device_id, idempotency_key)
    )
  `.execute(db);
  await sql`grant select, insert, update on platform.idempotency_records to evia_app`.execute(db);
}

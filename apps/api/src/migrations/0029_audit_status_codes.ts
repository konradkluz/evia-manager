/**
 * 0029 — the codes of the status before and after in the audit trail (domain-model.md → AuditEvent `fromCode`, `toCode`; EVM-054 AC1,
 * AC3; SR-LOG-03): a transition of a payment milestone is recorded with the two status codes. Expand only: two NULLABLE columns (no
 * default, no rewrite, no event touched); the append-only triggers and the grants of 0003 stay as they are (INSERT and SELECT of the
 * application role cover the new columns). Defence in depth: both are empty or both are a code (`^[a-z][a-z_]{0,39}$` — a closed list
 * of the application, never free text). Only the events `payment_milestone.*` fill them in EVM-054 (the application decides; the
 * events of work orders are not backfilled). The check is added `NOT VALID` and validated separately (as in 0027).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table audit.events
      add column from_code text,
      add column to_code text,
      add constraint events_status_codes check (
        (from_code is null and to_code is null)
        or (from_code is not null and to_code is not null and from_code ~ '^[a-z][a-z_]{0,39}$' and to_code ~ '^[a-z][a-z_]{0,39}$')
      ) not valid
  `.execute(db);
  await sql`alter table audit.events validate constraint events_status_codes`.execute(db);
}

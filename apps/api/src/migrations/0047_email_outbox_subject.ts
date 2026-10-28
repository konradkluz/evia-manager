/**
 * 0047 — the subject of an e-mail (EVM-049; P5, SR-LOG-07). Expand only: one nullable column, no key (ADR-0001: a module never holds a key
 * into the tables of another). `subject_id` is the identifier of the thing an alert is about (the work order of a file put in quarantine):
 * the composer builds the link of the alert from it, and the writer does not add a second pending message for the same recipient, variant
 * and subject. The partial index serves that check.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`alter table platform.email_outbox add column subject_id uuid`.execute(db);
  await sql`
    create index email_outbox_pending_subject_idx on platform.email_outbox (recipient_user_id, variant, subject_id)
      where state = 'pending' and subject_id is not null
  `.execute(db);
}

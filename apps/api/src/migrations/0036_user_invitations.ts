/**
 * 0036 — activation links issued by an invitation (EVM-024). Expand: the vocabulary of `identity.one_time_links.issued_by` gets
 * the value `invitation` (a link the worker issues when it sends the e-mail of an invitation); `cli` stays (the command that
 * activates the first Administrator). The CHECK is dropped and added again in this one migration — the table is small, and the code
 * that is still running writes `'cli'`, which both versions of the constraint accept. No data changes.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table identity.one_time_links
      drop constraint one_time_links_issued_by_check,
      add constraint one_time_links_issued_by_check check (issued_by in ('cli', 'invitation'))
  `.execute(db);
}

/**
 * 0035 — the outbox of transactional e-mails (EVM-024; ADR-0010; SR-DATA-01, TM-26, TM-72). Expand only: a new table, nothing
 * existing changes.
 *
 * A row is written in the transaction of the change that wants a message (an invitation) and says WHAT to send and TO WHOM by
 * identifier — never an address, a name, a token or a text: the address is read from `identity` at the moment of sending, the token
 * is created by the worker at that moment and only its hash is stored (in `identity.one_time_links`). The relay of the worker
 * hands the row to the queue `email.send` (the payload of the job is the id of the row alone); the handler owns the state:
 * `pending` → `sent` | `failed` (retries exhausted or a permanent refusal) | `superseded` (a newer message replaced it, the account
 * is no longer in the state the message needs).
 *
 * - no foreign key to `identity.users`: `platform` does not know the tables of a module (ADR-0001); the module checks the account;
 * - `kind` and `variant` are small closed vocabularies (CHECK; a new value widens it); `variant` selects the text of an alert;
 * - times come from the application clock (no defaults); `id` is a UUIDv7 of the database;
 * - the application role has NO `DELETE`: a row is history (the retention of `sent` and `superseded` rows is a decision of EVM-089);
 * - indexes: the rows still to hand over (partial, by age) and the latest message of a recipient (the list of users, W-16).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table platform.email_outbox (
      id uuid primary key default uuidv7(),
      kind text not null check (kind in ('user_invitation', 'administrator_alert')),
      variant text check (variant ~ '^[a-z][a-z_]{0,39}$'),
      recipient_user_id uuid not null,
      state text not null default 'pending' check (state in ('pending', 'sent', 'failed', 'superseded')),
      attempts smallint not null default 0 check (attempts between 0 and 20),
      enqueued_at timestamptz,
      sent_at timestamptz,
      created_at timestamptz not null,
      check ((state = 'sent') = (sent_at is not null))
    )
  `.execute(db);
  await sql`create index email_outbox_to_relay_idx on platform.email_outbox (created_at) where state = 'pending'`.execute(db);
  await sql`
    create index email_outbox_latest_of_recipient_idx on platform.email_outbox (recipient_user_id, kind, created_at desc)
  `.execute(db);
  await sql`grant select, insert, update on platform.email_outbox to evia_app`.execute(db);
}

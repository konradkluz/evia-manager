/**
 * 0027 — the exception of the audit trail for payments (domain-model.md → AuditEvent; EVM-053 AC3, AC6; SR-LOG-03): an event of a
 * payment milestone carries the amount before and after the change, in grosze, with the currency. Expand only: three NULLABLE
 * columns are added (no default, no rewrite of the table, no event is touched); the append-only triggers and the grants of 0003 stay as
 * they are (the application role has INSERT and SELECT on the table — the new columns included — and nothing else). Defence in depth
 * in the database: an amount is positive, and the three columns are empty unless the action is one of `payment_milestone.*` with the
 * currency `PLN` — no other event can carry an amount, whatever the application does.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table audit.events
      add column amount_before_minor bigint check (amount_before_minor > 0),
      add column amount_after_minor bigint check (amount_after_minor > 0),
      add column currency text,
      add constraint events_payment_amounts check (
        (amount_before_minor is null and amount_after_minor is null and currency is null)
        or (
          currency is not null
          and currency = 'PLN'
          and starts_with(action, 'payment_milestone.')
          and (amount_before_minor is not null or amount_after_minor is not null)
        )
      )
  `.execute(db);
}

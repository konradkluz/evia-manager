/**
 * 0043 - the anonymization of a customer (EVM-041; ADR-0003; domain-model.md, "Usuwanie danych"; SR-DATA-08, ASVS V14.2.7). Expand only: two
 * nullable columns, one CHECK and one trigger; no column, table or index is dropped, renamed or rewritten, and there is no backfill (every
 * existing customer keeps `anonymized_at` NULL, which the CHECK accepts).
 * - `anonymized_at` / `anonymized_by`: the mark "anonymized" and the Administrator who set it (a pseudonymous identifier, internal);
 * - the CHECK `customers_anonymized_neutral`: the two columns are set together or not at all, and a customer that carries the mark holds
 *   NEUTRAL values only - the telephone is the domain constant `+48000000000` (the column is NOT NULL and has a format, and the constant is
 *   not a real number), the names are "Klient zanonimizowany" (a person: first name "Klient", last name "zanonimizowany"; a company: the
 *   company name), and the tax id, the contact person, the e-mail, the address and the notes are empty. `search_text`, `display_name` and
 *   `sort_name` are generated from these columns, so they are recomputed by the database itself. The application writes the same values
 *   (`anonymized-customer.ts`); a test keeps the two equal;
 * - the trigger `customers.keep_anonymization()`: once the mark is set it can be neither changed nor cleared - there is no way back. The
 *   trigger does not list the other columns on purpose: the CHECK already pins their values, and a list would have to be remembered by every
 *   later migration that adds a column. `deleted_*`, `version` and `updated_*` stay writable (a deleted customer may be restored, a
 *   customer that is anonymized may be deleted).
 * Version N-1 keeps working on this schema for everything but one case: it patches a customer with the full set of columns, so the edit of
 * a customer that is ALREADY anonymized would violate the CHECK (a `500`, nothing is written). That is the window of a rollout and it fails
 * closed; version N answers `409 customer_anonymized` first. N-1 never writes `anonymized_*`.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table customers.customers
      add column anonymized_at timestamptz,
      add column anonymized_by uuid
  `.execute(db);
  await sql`
    alter table customers.customers
      add constraint customers_anonymized_neutral check (
        (anonymized_at is null) = (anonymized_by is null)
        and (
          anonymized_at is null
          or (
            phone = '+48000000000'
            and tax_id is null and contact_person_name is null and email is null
            and street is null and building_number is null and apartment_number is null and postal_code is null and city is null
            and notes is null
            and case kind
              when 'person' then first_name = 'Klient' and last_name = 'zanonimizowany'
              else company_name = 'Klient zanonimizowany'
            end
          )
        )
      )
  `.execute(db);
  await sql`
    create function customers.keep_anonymization() returns trigger
      language plpgsql
      set search_path = pg_catalog
      as $$
      begin
        if old.anonymized_at is not null
           and (new.anonymized_at, new.anonymized_by) is distinct from (old.anonymized_at, old.anonymized_by) then
          raise exception 'customers.customers: the anonymization cannot be changed or undone' using errcode = 'EV001';
        end if;
        return new;
      end
      $$
  `.execute(db);
  await sql`revoke all on function customers.keep_anonymization() from public`.execute(db);
  await sql`
    create trigger customers_keep_anonymization before update on customers.customers
      for each row execute function customers.keep_anonymization()
  `.execute(db);
}

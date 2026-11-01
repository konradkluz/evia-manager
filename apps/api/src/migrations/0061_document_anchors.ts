/**
 * 0061 - documents of a site and of a customer (EVM-050; SR-AUTHZ-08, AB-19; domain-model.md, `Document`). Expand only: two partial indexes and one
 * constraint; the anchor columns, `documents_one_anchor` and the immutability trigger already exist (0059).
 *
 * Numbering: 0058 belongs to track A (EVM-099), 0059 to EVM-047 and 0060 to EVM-048; this one takes 0061 (the Kysely migrator runs without
 * `allowUnorderedMigrations`).
 *
 * - `documents_site_list_idx` and `documents_customer_list_idx` serve the lists "Dokumenty lokalizacji" and "Dokumenty klienta" (the same order as the list of
 *   an order: `created_at desc, id`); they grow with the years, the lists must not scan the table.
 * - `documents_no_identity_on_site`: a document of a SITE is shown in the orders of every customer of that site, so its override can never be
 *   `identity_data` (the next customer would see the previous one's data). The class of the KIND cannot be checked here (it lives in the catalog); that part of
 *   the rule is in the application. Existing rows hold no site document (the API of EVM-047 wrote orders only), so the constraint is valid at once.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create index documents_site_list_idx on media.documents (site_id, created_at desc, id)
      where site_id is not null and deleted_at is null
  `.execute(db);
  await sql`
    create index documents_customer_list_idx on media.documents (customer_id, created_at desc, id)
      where customer_id is not null and deleted_at is null
  `.execute(db);
  await sql`
    alter table media.documents
      add constraint documents_no_identity_on_site
        check (site_id is null or confidentiality_override is distinct from 'identity_data')
  `.execute(db);
}

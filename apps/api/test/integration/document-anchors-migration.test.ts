import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedClock } from '../support/clock.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createUser } from '../support/identity-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
let userId = '';
let siteId = '';
let customerId = '';
beforeAll(async () => {
  database = await migratedDatabase({ checkProjection: false });
  userId = (await createUser(database.admin, new FixedClock('2026-11-01T08:00:00.000Z'), { role: 'editor' })).id;
  customerId = await insertCustomer(database.admin, { email: 'kotwice-migracja@example.invalid' });
  siteId = await insertSite(database.admin);
});
afterAll(async () => {
  await database.close();
});

const T = '2026-11-01T08:00:00Z';
const insert = (anchor: { site?: string; customer?: string }, override: string | null = null) =>
  sql`insert into media.documents (id, kind_code, title, site_id, customer_id, confidentiality_override, created_at, created_by, updated_at, updated_by)
      values (${uuidv7()}, 'building_documentation', 'Title', ${anchor.site ?? null}, ${anchor.customer ?? null}, ${override}, ${T}, ${userId}, ${T}, ${userId})`.execute(
    database.admin,
  );

describe('migration 0061 - documents of a site and of a customer (EVM-050; expand only)', () => {
  it('EVM-050 AC1 a site document and a customer document are admitted, with the class of the kind or raised to building_security', async () => {
    await insert({ site: siteId });
    await insert({ site: siteId }, 'building_security');
    await insert({ customer: customerId }, 'identity_data');
  });

  it('EVM-050 AC5 the database refuses identity_data on a site document at the insert and at a raise (AB-19)', async () => {
    await expect(insert({ site: siteId }, 'identity_data')).rejects.toMatchObject({ code: '23514' });
    const id = uuidv7();
    await sql`insert into media.documents (id, kind_code, title, site_id, created_at, created_by, updated_at, updated_by)
      values (${id}, 'building_documentation', 'Title', ${siteId}, ${T}, ${userId}, ${T}, ${userId})`.execute(database.admin);
    await expect(
      sql`update media.documents set confidentiality_override = 'identity_data' where id = ${id}`.execute(database.admin),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('EVM-050 AC2 the partial indexes of the lists exist', async () => {
    const rows = await sql<{
      indexname: string;
    }>`select indexname from pg_indexes where schemaname = 'media' and tablename = 'documents'`.execute(database.admin);
    const names = rows.rows.map((row) => row.indexname);
    expect(names).toContain('documents_site_list_idx');
    expect(names).toContain('documents_customer_list_idx');
  });
});

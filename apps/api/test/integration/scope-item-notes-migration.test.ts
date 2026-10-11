import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { insertScopeItems, insertWorkOrders } from '../support/work-order-fixtures.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
let app: Kysely<Database>;
beforeAll(async () => {
  database = await migratedDatabase();
  app = createDatabase({ url: database.appUrl, logger: createLogger({ level: 'fatal' }), pool: { max: 1 } });
});
afterAll(async () => {
  await app.destroy();
  await database.close();
});

const admin = () => database.admin;
const fails = async (statement: Promise<unknown>, code: string): Promise<void> => {
  await expect(statement).rejects.toMatchObject({ code });
};

let numbering = 0;
async function orderWithItem(): Promise<string> {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: 'jan@example.invalid' });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [{ number: `ZL-3300-${String(numbering).padStart(4, '0')}`, customerId, siteId }]);
  const orderId = [...ids.values()][0] ?? '';
  const [itemId] = await insertScopeItems(admin(), orderId, [{ position: 1 }]);
  return itemId ?? '';
}

describe('migration 0022 — the notes of a scope item (EVM-035; ADR-0003, SR-DATA-02; expand only)', () => {
  it('EVM-035 AC4 the column is nullable text (expand): an item written before the migration has none, and it is not a key of the JSONB', async () => {
    const { rows } = await sql<{ column_name: string; is_nullable: string; data_type: string }>`
      select column_name, is_nullable, data_type from information_schema.columns
      where table_schema = 'work_orders' and table_name = 'scope_items' and column_name = 'notes'`.execute(admin());
    expect(rows).toEqual([{ column_name: 'notes', is_nullable: 'YES', data_type: 'text' }]);
    const itemId = await orderWithItem();
    const { rows: stored } = await sql<{ notes: string | null; parameters: unknown }>`
      select notes, parameters from work_orders.scope_items where id = ${itemId}`.execute(admin());
    expect(stored).toEqual([{ notes: null, parameters: {} }]);
  });

  it('EVM-035 AC4 SR-INPUT-01 the notes are 1-1000 characters: an empty text and a longer one are refused by the database, a text of 1000 is stored', async () => {
    const itemId = await orderWithItem();
    await fails(sql`update work_orders.scope_items set notes = '' where id = ${itemId}`.execute(admin()), '23514');
    await fails(sql`update work_orders.scope_items set notes = ${'a'.repeat(1001)} where id = ${itemId}`.execute(admin()), '23514');
    await sql`update work_orders.scope_items set notes = ${'ą'.repeat(1000)} where id = ${itemId}`.execute(admin());
    const { rows } = await sql<{
      length: number;
    }>`select char_length(notes) as length from work_orders.scope_items where id = ${itemId}`.execute(admin());
    expect(rows).toEqual([{ length: 1000 }]);
  });

  it('EVM-035 AC1 the application role may write the column (the grant of the table covers it) and still has no DELETE', async () => {
    const itemId = await orderWithItem();
    await sql`update work_orders.scope_items set notes = 'Trasa przez garaż' where id = ${itemId}`.execute(app);
    const { rows } = await sql<{ notes: string }>`select notes from work_orders.scope_items where id = ${itemId}`.execute(app);
    expect(rows).toEqual([{ notes: 'Trasa przez garaż' }]);
    await fails(sql`delete from work_orders.scope_items where id = ${itemId}`.execute(app), '42501');
  });
});

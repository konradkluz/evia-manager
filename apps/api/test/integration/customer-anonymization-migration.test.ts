import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
beforeAll(async () => {
  database = await migratedDatabase();
});
afterAll(async () => {
  await database.close();
});

const admin = () => database.admin;
const T = '2026-10-28T08:00:00Z';
const ACTOR = '0198b0a0-0000-7000-8000-0000000000aa';
const V7 = (n: number): string => `0198b0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const fails = async (statement: Promise<unknown>, code: string): Promise<void> => {
  await expect(statement).rejects.toMatchObject({ code });
};

let counter = 500;
/** A customer that is anonymized already, written the way the application writes it (neutral values and the mark). */
const anonymized = async (kind: 'person' | 'company' = 'person'): Promise<string> => {
  counter += 1;
  const id = V7(counter);
  const person = kind === 'person';
  await sql`
    insert into customers.customers (id, kind, first_name, last_name, company_name, phone, created_at, updated_at, anonymized_at, anonymized_by)
    values (${id}, ${kind}, ${person ? 'Klient' : null}, ${person ? 'zanonimizowany' : null},
            ${person ? null : 'Klient zanonimizowany'}, '+48000000000', ${T}, ${T}, ${T}, ${ACTOR})`.execute(admin());
  return id;
};
const live = async (): Promise<string> => {
  counter += 1;
  const id = V7(counter);
  await sql`
    insert into customers.customers (id, kind, first_name, last_name, phone, email, notes, created_at, updated_at)
    values (${id}, 'person', 'Jan', 'Przykładowy', '+48600000001', 'jan@example.invalid', 'notatka', ${T}, ${T})`.execute(admin());
  return id;
};

describe('migration 0043 - the anonymization of a customer (EVM-041 AC4; ADR-0003; SR-DATA-08; expand only)', () => {
  it('EVM-041 AC4 the columns are nullable and a customer that exists keeps NULL in both', async () => {
    const id = await live();
    const { rows } = await sql<{ at: Date | null; by: string | null }>`
      select anonymized_at as at, anonymized_by as by from customers.customers where id = ${id}`.execute(admin());
    expect(rows[0]).toEqual({ at: null, by: null });
  });

  it('EVM-041 AC4 the mark is a pair: one column without the other is refused', async () => {
    const id = await live();
    await fails(sql`update customers.customers set anonymized_at = ${T} where id = ${id}`.execute(admin()), '23514');
    await fails(sql`update customers.customers set anonymized_by = ${ACTOR} where id = ${id}`.execute(admin()), '23514');
  });

  it('EVM-041 AC4 the mark is refused while the data are not neutral (each personal column is checked)', async () => {
    const id = await live();
    await fails(
      sql`update customers.customers set anonymized_at = ${T}, anonymized_by = ${ACTOR} where id = ${id}`.execute(admin()),
      '23514',
    );
    const neutral = sql`first_name = 'Klient', last_name = 'zanonimizowany', phone = '+48000000000', email = null, notes = null`;
    // the neutral set is accepted
    await sql`update customers.customers set ${neutral}, anonymized_at = ${T}, anonymized_by = ${ACTOR} where id = ${id}`.execute(admin());
    const { rows } = await sql<{ display_name: string; search_text: string }>`
      select display_name, search_text from customers.customers where id = ${id}`.execute(admin());
    expect(rows[0]?.display_name).toBe('Klient zanonimizowany');
    expect(rows[0]?.search_text).not.toMatch(/jan|przyk|600000001|example/);
  });

  it('EVM-041 AC4 a company is neutral with the company name only; a leftover tax id, address or contact person is refused', async () => {
    counter += 1;
    const id = V7(counter);
    await sql`
      insert into customers.customers (id, kind, company_name, tax_id, contact_person_name, phone, street, building_number, postal_code, city, created_at, updated_at)
      values (${id}, 'company', 'Firma Testowa', '5260250274', 'Anna Przykładowa', '+48600000002', 'Piotrkowska', '1', '90-001', 'Łódź', ${T}, ${T})`.execute(
      admin(),
    );
    const mark = sql`anonymized_at = ${T}, anonymized_by = ${ACTOR}`;
    await fails(
      sql`update customers.customers set company_name = 'Klient zanonimizowany', phone = '+48000000000', ${mark} where id = ${id}`.execute(
        admin(),
      ),
      '23514',
    );
    await sql`
      update customers.customers set company_name = 'Klient zanonimizowany', tax_id = null, contact_person_name = null, phone = '+48000000000',
        street = null, building_number = null, postal_code = null, city = null, ${mark} where id = ${id}`.execute(admin());
  });

  it('EVM-041 AC4 an anonymized customer cannot get its data back: the data and the mark are refused (CHECK and trigger)', async () => {
    const id = await anonymized();
    await fails(sql`update customers.customers set first_name = 'Jan' where id = ${id}`.execute(admin()), '23514');
    await fails(sql`update customers.customers set phone = '+48600000001' where id = ${id}`.execute(admin()), '23514');
    await fails(sql`update customers.customers set email = 'jan@example.invalid' where id = ${id}`.execute(admin()), '23514');
    await fails(sql`update customers.customers set notes = 'notatka' where id = ${id}`.execute(admin()), '23514');
    await fails(sql`update customers.customers set kind = 'company' where id = ${id}`.execute(admin()), '23514');
  });

  it('EVM-041 AC4 the mark cannot be cleared or changed once it is set (the trigger)', async () => {
    const id = await anonymized();
    await fails(sql`update customers.customers set anonymized_at = null, anonymized_by = null where id = ${id}`.execute(admin()), 'EV001');
    await fails(sql`update customers.customers set anonymized_at = '2026-10-29T08:00:00Z' where id = ${id}`.execute(admin()), 'EV001');
    await fails(sql`update customers.customers set anonymized_by = ${V7(1)} where id = ${id}`.execute(admin()), 'EV001');
    const { rows } = await sql<{ at: Date }>`select anonymized_at as at from customers.customers where id = ${id}`.execute(admin());
    expect(rows[0]?.at.toISOString()).toBe('2026-10-28T08:00:00.000Z');
  });

  it('EVM-041 AC1 AC3 the deletion marks and the version stay writable on an anonymized customer (it can be deleted and restored)', async () => {
    const id = await anonymized();
    await sql`update customers.customers set deleted_at = ${T}, deleted_by = ${ACTOR}, version = version + 1, updated_at = ${T} where id = ${id}`.execute(
      admin(),
    );
    await sql`update customers.customers set deleted_at = null, deleted_by = null, version = version + 1 where id = ${id}`.execute(admin());
    const { rows } = await sql<{ version: number; deleted_at: Date | null }>`
      select version, deleted_at from customers.customers where id = ${id}`.execute(admin());
    expect(rows[0]).toEqual({ version: 3, deleted_at: null });
  });

  it('EVM-041 AC4 the application role may update the table and nothing else changed in its privileges (no DELETE)', async () => {
    const { rows } = await sql<{ update: boolean; delete: boolean }>`
      select has_table_privilege('evia_app', 'customers.customers', 'update') as "update",
             has_table_privilege('evia_app', 'customers.customers', 'delete') as "delete"`.execute(admin());
    expect(rows[0]).toEqual({ update: true, delete: false });
  });

  it('EVM-041 AC4 the trigger function has a fixed search_path and is not callable by everybody', async () => {
    const { rows } = await sql<{ config: string[] | null; executable: boolean }>`
      select proconfig as config, has_function_privilege('public', oid, 'execute') as executable
      from pg_proc where proname = 'keep_anonymization'`.execute(admin());
    expect(rows[0]?.config).toEqual(['search_path=pg_catalog']);
    expect(rows[0]?.executable).toBe(false);
  });
});

describe('migration 0044 - the index of the view "Usunięci" (EVM-041 AC1, AC3; ADR-0003; expand only)', () => {
  it('EVM-041 AC3 the deleted customers have a partial index on (sort_name, id)', async () => {
    const { rows } = await sql<{ indexdef: string }>`
      select indexdef from pg_indexes where indexname = 'customers_deleted_sort_name_id_idx'`.execute(admin());
    expect(rows[0]?.indexdef).toMatch(/\(sort_name, id\)/);
    expect(rows[0]?.indexdef).toMatch(/WHERE \(deleted_at IS NOT NULL\)/);
  });

  it('EVM-041 AC3 the index of the live customers (0017) is untouched', async () => {
    const { rows } = await sql<{ indexdef: string }>`
      select indexdef from pg_indexes where indexname = 'customers_sort_name_id_idx'`.execute(admin());
    expect(rows[0]?.indexdef).toMatch(/WHERE \(deleted_at IS NULL\)/);
  });
});

import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
beforeAll(async () => {
  database = await migratedDatabase();
});
afterAll(async () => {
  await database.close();
});

const admin = () => database.admin;
const T = '2026-10-09T08:00:00Z';
const fails = async (statement: Promise<unknown>, code: string): Promise<void> => {
  await expect(statement).rejects.toMatchObject({ code });
};

let counter = 0;
async function insertOrder(): Promise<string> {
  counter += 1;
  const customerId = await insertCustomer(admin(), { email: `jan${counter}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [{ number: `ZL-${3100 + counter}-0001`, customerId, siteId }]);
  return [...ids.values()][0] ?? '';
}
const insertProcess = async (workOrderId: string, code: string, position: number, extra: { deletedAt?: string } = {}): Promise<string> => {
  const id = uuidv7();
  await sql`insert into procedures.procedures (id, work_order_id, code, name, position, created_at, updated_at, deleted_at)
    values (${id}, ${workOrderId}, ${code}, 'Proces syntetyczny', ${position}, ${T}, ${T}, ${extra.deletedAt ?? null})`.execute(admin());
  return id;
};
const insertStage = (
  workOrderId: string,
  procedureId: string,
  code: string,
  position: number,
  extra: { status?: string; waitingOn?: string | null; partyId?: string | null; dueDate?: string | null; deletedAt?: string } = {},
) =>
  sql`insert into procedures.procedure_stages (procedure_id, work_order_id, code, name, position, status, waiting_on,
        waiting_on_party_id, due_date, created_at, updated_at, deleted_at)
      values (${procedureId}, ${workOrderId}, ${code}, 'Etap syntetyczny', ${position}, ${extra.status ?? 'todo'}, ${extra.waitingOn ?? null},
        ${extra.partyId ?? null}, ${extra.dueDate ?? null}, ${T}, ${T}, ${extra.deletedAt ?? null})`.execute(admin());

describe('migration 0019 — processes and stages (EVM-031 AC1, AC6; ADR-0003; SR-AUTHZ-02; expand only)', () => {
  it('EVM-031 AC1 a stage starts as todo, the status is one of the six values, and the identifiers are UUIDv7', async () => {
    const orderId = await insertOrder();
    const processId = await insertProcess(orderId, 'osd', 1);
    await insertStage(orderId, processId, 'submit', 1);
    const { rows } = await sql<{ status: string; version: number }>`
      select status, version from procedures.procedure_stages where procedure_id = ${processId}`.execute(admin());
    expect(rows).toEqual([{ status: 'todo', version: 1 }]);
    await fails(insertStage(orderId, processId, 'other', 2, { status: 'finished' }), '23514');
    await fails(
      sql`insert into procedures.procedures (id, work_order_id, code, name, position, created_at, updated_at)
          values (${'00000000-0000-4000-8000-000000000001'}, ${orderId}, 'bad_id', 'Proces', 2, ${T}, ${T})`.execute(admin()),
      '23514',
    );
  });

  it('EVM-031 AC6 SR-AUTHZ-02 a stage cannot belong to a process of another order: the composite key (procedure_id, work_order_id) refuses it', async () => {
    const orderA = await insertOrder();
    const orderB = await insertOrder();
    const processA = await insertProcess(orderA, 'osd', 1);
    await fails(insertStage(orderB, processA, 'submit', 1), '23503');
    await insertStage(orderA, processA, 'submit', 1);
  });

  it('EVM-031 AC1 an order has at most one ACTIVE process per code and per position; a stage per code and position in its process; soft delete frees them', async () => {
    const orderId = await insertOrder();
    const processId = await insertProcess(orderId, 'osd', 1);
    await fails(insertProcess(orderId, 'osd', 2), '23505');
    await fails(insertProcess(orderId, 'other', 1), '23505');
    await insertStage(orderId, processId, 'submit', 1);
    await fails(insertStage(orderId, processId, 'submit', 2), '23505');
    await fails(insertStage(orderId, processId, 'review', 1), '23505');
    await sql`update procedures.procedure_stages set deleted_at = ${T} where procedure_id = ${processId}`.execute(admin());
    await insertStage(orderId, processId, 'submit', 1);
    await sql`update procedures.procedures set deleted_at = ${T} where id = ${processId}`.execute(admin());
    await insertProcess(orderId, 'osd', 1);
  });

  it('EVM-031 AC3 the due date is a business day (2000-01-01 .. 2100-12-31) and "waiting for" is required exactly in the status waiting', async () => {
    const orderId = await insertOrder();
    const processId = await insertProcess(orderId, 'osd', 1);
    await insertStage(orderId, processId, 'stage_a', 1, { dueDate: '2000-01-01' });
    await insertStage(orderId, processId, 'stage_b', 2, { dueDate: '2100-12-31' });
    await fails(insertStage(orderId, processId, 'stage_c', 3, { dueDate: '1999-12-31' }), '23514');
    await fails(insertStage(orderId, processId, 'stage_d', 4, { dueDate: '2101-01-01' }), '23514');
    await fails(insertStage(orderId, processId, 'stage_e', 5, { status: 'waiting' }), '23514');
    await fails(insertStage(orderId, processId, 'stage_f', 6, { waitingOn: 'customer' }), '23514');
    await fails(insertStage(orderId, processId, 'stage_g', 7, { status: 'waiting', waitingOn: 'party' }), '23514');
    await insertStage(orderId, processId, 'stage_h', 8, { status: 'waiting', waitingOn: 'customer' });
  });

  it('EVM-031 AC3 the person responsible must exist (foreign key) and the keys are ON DELETE RESTRICT — no cascade anywhere in the schema', async () => {
    const orderId = await insertOrder();
    const processId = await insertProcess(orderId, 'osd', 1);
    await fails(
      sql`insert into procedures.procedure_stages (procedure_id, work_order_id, code, name, position, responsible_user_id, created_at, updated_at)
          values (${processId}, ${orderId}, 'stage_a', 'Etap', 1, ${uuidv7()}, ${T}, ${T})`.execute(admin()),
      '23503',
    );
    await insertStage(orderId, processId, 'stage_b', 2);
    await fails(sql`delete from work_orders.work_orders where id = ${orderId}`.execute(admin()), '23001');
    await fails(sql`delete from procedures.procedures where id = ${processId}`.execute(admin()), '23001');
    const { rows } = await sql<{ on_delete: string }>`
      select confdeltype as on_delete from pg_constraint where contype = 'f' and connamespace = 'procedures'::regnamespace`.execute(
      admin(),
    );
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(rows.every((row) => row.on_delete === 'r')).toBe(true);
  });

  it('EVM-031 SR-DATA-03 the application role has SELECT, INSERT and UPDATE on both tables and no DELETE or TRUNCATE; the schema is not open to PUBLIC', async () => {
    for (const table of ['procedures.procedures', 'procedures.procedure_stages']) {
      const { rows } = await sql<Record<string, boolean>>`
        select has_table_privilege('evia_it_app', ${table}, 'select') as "select",
               has_table_privilege('evia_it_app', ${table}, 'insert') as "insert",
               has_table_privilege('evia_it_app', ${table}, 'update') as "update",
               has_table_privilege('evia_it_app', ${table}, 'delete') as "delete",
               has_table_privilege('evia_it_app', ${table}, 'truncate') as "truncate"`.execute(admin());
      expect(rows[0], table).toEqual({ select: true, insert: true, update: true, delete: false, truncate: false });
    }
    const { rows } = await sql<{ usage: boolean }>`
      select has_schema_privilege('evia_it_app', 'procedures', 'usage') as "usage"`.execute(admin());
    expect(rows[0]?.usage).toBe(true);
    const { rows: open } = await sql<{ n: string }>`
      select count(*)::text as n from information_schema.table_privileges
      where table_schema = 'procedures' and grantee = 'PUBLIC'`.execute(admin());
    expect(open[0]?.n).toBe('0');
  });
});

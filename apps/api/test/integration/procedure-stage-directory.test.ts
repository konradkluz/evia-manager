import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProcedureStageDirectoryService } from '../../src/modules/procedures/application/stage-directory.service.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { insertProcedure } from '../support/procedure-fixtures.ts';
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

const directory = new ProcedureStageDirectoryService();
let counter = 0;
async function insertOrder(): Promise<string> {
  counter += 1;
  const customerId = await insertCustomer(database.admin, { email: `jan${counter}@example.invalid` });
  const siteId = await insertSite(database.admin);
  const ids = await insertWorkOrders(database.admin, [{ number: `ZL-${3300 + counter}-0001`, customerId, siteId }]);
  return [...ids.values()][0] ?? '';
}

describe('the facade of the stages for the journal (EVM-037 AC7; SR-AUTHZ-02; CWE-639)', () => {
  it('EVM-037 AC7 a stage of the order exists in it; a stage of another order, a missing one and a deleted one do not', async () => {
    const orderA = await insertOrder();
    const orderB = await insertOrder();
    const live = await insertProcedure(database.admin, orderA, { stages: [{}, { deletedAt: new Date('2026-10-10T08:00:00Z') }] });
    const [liveStage, deletedStage] = live.stageIds;
    const deletedProcess = await insertProcedure(database.admin, orderA, {
      position: 2,
      deletedAt: new Date('2026-10-10T08:00:00Z'),
      stages: [{}],
    });
    expect(await directory.existsInOrder(database.admin, orderA, liveStage ?? '')).toBe(true);
    expect(await directory.existsInOrder(database.admin, orderB, liveStage ?? '')).toBe(false);
    expect(await directory.existsInOrder(database.admin, orderA, deletedStage ?? '')).toBe(false);
    expect(await directory.existsInOrder(database.admin, orderA, deletedProcess.stageIds[0] ?? '')).toBe(false);
    expect(await directory.existsInOrder(database.admin, orderA, uuidv7())).toBe(false);
  });

  it('EVM-037 AC7 the lock is taken FOR SHARE in the transaction of the caller and held to its end (no deletion between check and write)', async () => {
    const orderId = await insertOrder();
    const { stageIds } = await insertProcedure(database.admin, orderId, { stages: [{}] });
    const stageId = stageIds[0] ?? '';
    await database.admin.transaction().execute(async (tx) => {
      expect(await directory.existsInOrder(tx, orderId, stageId, { lock: true })).toBe(true);
      const { rows } = await sql<{ locked: boolean }>`
        select exists (select 1 from pg_locks l join pg_class c on c.oid = l.relation
          where c.relname = 'procedure_stages' and l.mode = 'RowShareLock' and l.granted) as locked`.execute(tx);
      expect(rows[0]?.locked).toBe(true);
    });
  });

  it('EVM-037 AC1 names come in one query, only for the order given; a deleted stage keeps its name', async () => {
    const orderA = await insertOrder();
    const orderB = await insertOrder();
    const a = await insertProcedure(database.admin, orderA, {
      stages: [{ name: 'Etap A1' }, { name: 'Etap A2', deletedAt: new Date('2026-10-10T08:00:00Z') }],
    });
    const b = await insertProcedure(database.admin, orderB, { stages: [{ name: 'Etap B1' }] });
    const names = await directory.namesOf(database.admin, orderA, [...a.stageIds, ...b.stageIds, ...a.stageIds]);
    expect([...names.values()].sort()).toEqual(['Etap A1', 'Etap A2']);
    expect(names.has(b.stageIds[0] ?? '')).toBe(false);
    expect((await directory.namesOf(database.admin, orderA, [])).size).toBe(0);
  });
});

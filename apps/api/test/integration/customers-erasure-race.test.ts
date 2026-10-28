import { sql, type Transaction } from 'kysely';
import type { Database } from '../../src/platform/database/database.ts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  canaryCustomer,
  codeOf,
  CUSTOMERS,
  NOW,
  orderOf,
  rowOf,
  signInTo,
  startErasureApp,
  tag,
  type Browser,
  type ErasureApp,
} from '../support/customer-erasure.ts';
import { clearCustomers } from '../support/customer-fixtures.ts';
import { rebuildProjection } from '../support/projection.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation } from '../support/work-order-fixtures.ts';

let app: ErasureApp;
beforeAll(async () => {
  app = await startErasureApp();
});
afterAll(async () => {
  await app.current.close();
});
beforeEach(async () => {
  app.current.clock.set(NOW);
  app.register().recover();
  app.register().calls.length = 0;
  app.register().objects.length = 0;
  await clearWorkOrderCreation(app.current.database.admin);
  await clearCustomers(app.current.database.admin);
});

const admin = () => app.current.database.admin;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const url = (id: string, suffix = '') => `${CUSTOMERS}/${id}${suffix}`;
const remove = (browser: Browser, id: string, version = 1) => browser.panel.delete(url(id), { 'If-Match': tag(version) });
const countOf = async (customerId: string): Promise<number> =>
  Number(
    (await sql<{ n: string }>`select count(*)::text as n from work_orders.work_orders where customer_id = ${customerId}`.execute(admin()))
      .rows[0]?.n,
  );

async function creation(customerId: string) {
  const siteId = await insertSite(admin());
  const templateId = (
    await sql<{ id: string }>`select id from catalog.work_order_templates where code = 'garage_full_process'`.execute(admin())
  ).rows[0]?.id;
  return { id: uuidv7(), customerId, siteId, templateId };
}

/** Holds a transaction open until `release()`: the way a command that has not committed yet looks to the others. */
interface Held {
  readonly ready: Promise<void>;
  release(): void;
  readonly done: Promise<void>;
}
function held(work: (trx: Transaction<Database>) => Promise<void>): Held {
  let release: () => void = () => undefined;
  let ready: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const readyPromise = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const done = admin()
    .transaction()
    .execute(async (trx) => {
      await work(trx);
      ready();
      await gate;
    });
  return { ready: readyPromise, release, done };
}

describe('EVM-041 AC1 AC2 - the deletion of a customer and the creation of its order are serialised (D7, CWE-367, ASVS V15.4)', () => {
  it('EVM-041 AC1 the deletion commits FIRST: the creation of an order that was waiting for the customer is refused as for a customer that does not exist - no open order of a deleted customer appears', async () => {
    const customerId = await canaryCustomer(app.current);
    const editor = await signInTo(app.current, 'editor');
    const body = await creation(customerId);
    // the deletion as it stands inside its transaction: the row is changed and locked, the commit is still to come
    const deletion = held(async (trx) => {
      await sql`select id from customers.customers where id = ${customerId} for update`.execute(trx);
      await sql`update customers.customers set deleted_at = ${NOW}, version = version + 1 where id = ${customerId}`.execute(trx);
    });
    await deletion.ready;
    const attempt = editor.panel.post('/api/v1/work-orders', body, { 'Idempotency-Key': uuidv7() }).then((answer) => answer);
    await sleep(400);
    deletion.release();
    await deletion.done;
    const answer = await attempt;
    expect([answer.status, codeOf(answer.body)]).toEqual([404, 'not_found']);
    expect(await countOf(customerId)).toBe(0);
  });

  it('EVM-041 AC2 the creation commits FIRST: the deletion that was waiting for the customer counts the new order (it is committed before the lock is taken) and is 409 with openWorkOrders = 1', async () => {
    const customerId = await canaryCustomer(app.current);
    const administrator = await signInTo(app.current, 'administrator');
    // the creation as it stands inside its transaction: the customer is locked FOR KEY SHARE and the order is inserted, the commit is still to come
    const created = held(async (trx) => {
      await sql`select id from customers.customers where id = ${customerId} for key share`.execute(trx);
      await sql`insert into work_orders.work_orders (number, title, status, customer_id, created_at, updated_at)
                values ('ZL-9001-0001', 'Zlecenie', 'new', ${customerId}, ${NOW}, ${NOW})`.execute(trx);
    });
    await created.ready;
    const attempt = remove(administrator, customerId).then((answer) => answer);
    await sleep(400);
    created.release();
    await created.done;
    const answer = await attempt;
    await rebuildProjection(admin()); // the order was written by plain SQL: the projection of the list is rebuilt for the check at the end of the test
    expect([answer.status, codeOf(answer.body)]).toEqual([409, 'has_active_dependents']);
    expect((answer.body as { openWorkOrders: number }).openWorkOrders).toBe(1);
    expect(await rowOf(app.current, customerId)).toMatchObject({ version: 1, deleted_at: null });
  });

  it('EVM-041 AC2 the same for the anonymization: an order that is committed first blocks it, the register is not asked', async () => {
    const customerId = await canaryCustomer(app.current);
    const administrator = await signInTo(app.current, 'administrator', { fresh: true });
    const created = held(async (trx) => {
      await sql`select id from customers.customers where id = ${customerId} for key share`.execute(trx);
      await sql`insert into work_orders.work_orders (number, title, status, customer_id, created_at, updated_at)
                values ('ZL-9002-0001', 'Zlecenie', 'in_progress', ${customerId}, ${NOW}, ${NOW})`.execute(trx);
    });
    await created.ready;
    const attempt = administrator.panel.post(url(customerId, '/anonymize'), undefined, { 'If-Match': tag(1) }).then((answer) => answer);
    await sleep(400);
    created.release();
    await created.done;
    const answer = await attempt;
    await rebuildProjection(admin()); // the order was written by plain SQL: the projection of the list is rebuilt for the check at the end of the test
    expect([answer.status, codeOf(answer.body)]).toEqual([409, 'has_active_dependents']);
    expect(app.register().calls).toHaveLength(0);
    expect((await rowOf(app.current, customerId))?.first_name).toBe('Zdzisław');
  });

  it('EVM-041 AC1 AC2 both requests at once, repeated: exactly one wins every time - an order is created and the deletion is 409, or the customer is deleted and the creation is 404; never both and never an open order of a deleted customer', async () => {
    const editor = await signInTo(app.current, 'editor');
    const administrator = await signInTo(app.current, 'administrator');
    let deleted = 0;
    let created = 0;
    for (let round = 0; round < 8; round += 1) {
      const customerId = await canaryCustomer(app.current, { lastName: `Wyscig${round}` });
      const body = await creation(customerId);
      const [creating, deleting] = await Promise.all([
        editor.panel.post('/api/v1/work-orders', body, { 'Idempotency-Key': uuidv7() }).then((answer) => answer),
        remove(administrator, customerId).then((answer) => answer),
      ]);
      const outcome = [creating.status, deleting.status];
      expect(
        [
          [201, 409],
          [404, 204],
        ],
        JSON.stringify(outcome),
      ).toContainEqual(outcome);
      if (deleting.status === 204) deleted += 1;
      else created += 1;
      const row = await rowOf(app.current, customerId);
      expect(row?.deleted_at !== null, 'deleted').toBe(deleting.status === 204);
      expect(await countOf(customerId)).toBe(created > 0 && creating.status === 201 ? 1 : 0);
      if (deleting.status === 204) expect(await countOf(customerId)).toBe(0);
    }
    expect(deleted + created).toBe(8);
  });

  it('EVM-041 AC2 an order that was open and is settled afterwards no longer blocks (the count is of the moment of the lock)', async () => {
    const customerId = await canaryCustomer(app.current);
    const orderId = await orderOf(app.current, customerId, 'in_progress');
    const administrator = await signInTo(app.current, 'administrator');
    expect((await remove(administrator, customerId)).status).toBe(409);
    await sql`update work_orders.work_orders set status = 'settled' where id = ${orderId}`.execute(admin());
    await rebuildProjection(admin());
    expect((await remove(administrator, customerId)).status).toBe(204);
  });
});

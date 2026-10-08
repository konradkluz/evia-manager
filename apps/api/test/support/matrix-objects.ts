import { randomInt } from 'node:crypto';
import type { ObjectPaths } from '../authorization/role-matrix.ts';
import { catalogObjects } from './catalog-objects.ts';
import { insertCustomer } from './customer-fixtures.ts';
import type { IdentityApp } from './identity-app.ts';
import { insertSite } from './site-fixtures.ts';
import { insertScopeItems, insertWorkOrders } from './work-order-fixtures.ts';

const WORK_ORDERS = '/api/v1/work-orders';
const READS = ['getWorkOrder', 'listWorkOrderScopeItems', 'getWorkOrderCustomer', 'getWorkOrderSite'] as const;
const SUFFIX: Record<(typeof READS)[number], string> = {
  getWorkOrder: '',
  listWorkOrderScopeItems: '/scope-items',
  getWorkOrderCustomer: '/customer',
  getWorkOrderSite: '/site',
};

/**
 * The IDOR fixture of the four reads of one work order (EVM-018 AC3, AC6; SR-AUTHZ-02, SR-AUTHZ-05, CWE-639): "own" is a live order
 * with a customer, a site and a scope item; "foreign" is an EXISTING order that is soft deleted — a random identifier would not
 * prove that the read policy runs: here the row is in the table and only the policy keeps it from the caller.
 */
export async function workOrderObjects(app: IdentityApp): Promise<Record<string, ObjectPaths>> {
  const db = app.database.admin;
  const customerId = await insertCustomer(db, { email: 'jan@example.invalid' });
  const siteId = await insertSite(db, { notes: 'notatka' });
  const year = 3000 + randomInt(900);
  const ids = await insertWorkOrders(db, [
    { number: `ZL-${year}-${String(randomInt(1000, 9000))}`, customerId, siteId },
    { number: `ZL-${year}-${String(randomInt(9000, 9999))}`, customerId, siteId, deletedAt: new Date('2026-10-02T08:00:00Z') },
  ]);
  const [own, foreign] = [...ids.values()];
  if (own === undefined || foreign === undefined) throw new Error('the fixture orders were not inserted');
  await insertScopeItems(db, own, [{ position: 1, parameters: { powerKw: 11 } }]);
  await insertScopeItems(db, foreign, [{ position: 1 }]);
  return Object.fromEntries(
    READS.map((operationId) => [
      operationId,
      { own: () => `${WORK_ORDERS}/${own}${SUFFIX[operationId]}`, foreign: () => `${WORK_ORDERS}/${foreign}${SUFFIX[operationId]}` },
    ]),
  );
}

/** Every operation of the contract that addresses an object, with the paths of an own and of a foreign object. */
export async function matrixObjects(app: IdentityApp): Promise<Record<string, ObjectPaths>> {
  return { ...(await catalogObjects(app)), ...(await workOrderObjects(app)) };
}

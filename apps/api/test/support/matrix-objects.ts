import { randomInt } from 'node:crypto';
import type { ObjectPaths } from '../authorization/role-matrix.ts';
import { catalogObjects } from './catalog-objects.ts';
import { insertCustomer } from './customer-fixtures.ts';
import type { IdentityApp } from './identity-app.ts';
import { insertParty, insertSite } from './site-fixtures.ts';
import { insertScopeItems, insertWorkOrders } from './work-order-fixtures.ts';

const WORK_ORDERS = '/api/v1/work-orders';
const READS = ['getWorkOrder', 'listWorkOrderScopeItems', 'getWorkOrderCustomer', 'getWorkOrderSite', 'listWorkOrderSiteOrders'] as const;
const SUFFIX: Record<(typeof READS)[number], string> = {
  getWorkOrder: '',
  listWorkOrderScopeItems: '/scope-items',
  getWorkOrderCustomer: '/customer',
  getWorkOrderSite: '/site',
  listWorkOrderSiteOrders: '/site-orders',
};

/**
 * The IDOR fixture of the five reads of one work order and of the status command (EVM-018 AC3, AC6; EVM-030 AC7; SR-AUTHZ-02, SR-AUTHZ-05, CWE-639): "own" is a live order
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
  return {
    ...Object.fromEntries(
      READS.map((operationId) => [
        operationId,
        { own: () => `${WORK_ORDERS}/${own}${SUFFIX[operationId]}`, foreign: () => `${WORK_ORDERS}/${foreign}${SUFFIX[operationId]}` },
      ]),
    ),
    // the status command (EVM-030 AC7): the same pair — a live order, and an EXISTING order that is soft deleted
    transitionWorkOrder: { own: () => `${WORK_ORDERS}/${own}/transitions`, foreign: () => `${WORK_ORDERS}/${foreign}/transitions` },
  };
}

const CUSTOMERS = '/api/v1/customers';

/**
 * The IDOR fixture of the detail and the edit of one customer (EVM-039 AC6, AC7; SR-AUTHZ-02, SR-AUTHZ-05, CWE-639): "own" is a live
 * customer; "foreign" is an EXISTING customer that is soft deleted — the row is in the table and only the read policy keeps it from
 * the caller (a random identifier would not prove that the policy runs).
 */
export async function customerObjects(app: IdentityApp): Promise<Record<string, ObjectPaths>> {
  const db = app.database.admin;
  const own = await insertCustomer(db, { email: 'jan@example.invalid' });
  const foreign = await insertCustomer(db, { lastName: 'Usuniety', deletedAt: '2026-10-02T08:00:00Z' });
  const paths: ObjectPaths = { own: () => `${CUSTOMERS}/${own}`, foreign: () => `${CUSTOMERS}/${foreign}` };
  return { getCustomer: paths, updateCustomer: paths };
}

const SITES = '/api/v1/sites';
const PARTIES = '/api/v1/parties';

/**
 * The IDOR fixture of the detail and the edit of one site and one party (EVM-036 AC6, AC7; SR-AUTHZ-02, SR-AUTHZ-05, CWE-639): "own" is
 * a live object; "foreign" is an EXISTING object that is soft deleted — the row is in the table and only the read policy keeps it from
 * the caller (a random identifier would not prove that the policy runs).
 */
export async function siteAndPartyObjects(app: IdentityApp): Promise<Record<string, ObjectPaths>> {
  const db = app.database.admin;
  const ownSite = await insertSite(db, { notes: 'notatka' });
  const foreignSite = await insertSite(db, { deletedAt: '2026-10-02T08:00:00Z' });
  const ownParty = await insertParty(db, { displayName: 'Operator Własny' });
  const foreignParty = await insertParty(db, { displayName: 'Operator Usunięty', deletedAt: '2026-10-02T08:00:00Z' });
  const site: ObjectPaths = { own: () => `${SITES}/${ownSite}`, foreign: () => `${SITES}/${foreignSite}` };
  const party: ObjectPaths = { own: () => `${PARTIES}/${ownParty}`, foreign: () => `${PARTIES}/${foreignParty}` };
  return { getSite: site, updateSite: site, getParty: party, updateParty: party };
}

/** Every operation of the contract that addresses an object, with the paths of an own and of a foreign object. */
export async function matrixObjects(app: IdentityApp): Promise<Record<string, ObjectPaths>> {
  return {
    ...(await catalogObjects(app)),
    ...(await workOrderObjects(app)),
    ...(await customerObjects(app)),
    ...(await siteAndPartyObjects(app)),
  };
}

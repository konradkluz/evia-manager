import { randomInt } from 'node:crypto';
import { sql } from 'kysely';
import type { ObjectPaths } from '../authorization/role-matrix.ts';
import { catalogObjects } from './catalog-objects.ts';
import { insertCustomer } from './customer-fixtures.ts';
import type { IdentityApp } from './identity-app.ts';
import { createPasskey, createSession, createUser } from './identity-fixtures.ts';
import { insertMilestones } from './payment-fixtures.ts';
import { insertProcedure } from './procedure-fixtures.ts';
import { insertParty, insertSite } from './site-fixtures.ts';
import { insertEntries } from './timeline-fixtures.ts';
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
    { number: `ZL-${year + 1}-${String(randomInt(1000, 9000))}`, customerId, siteId },
  ]);
  const [own, foreign, live] = [...ids.values()];
  if (own === undefined || foreign === undefined || live === undefined) throw new Error('the fixture orders were not inserted');
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
    // EVM-060: the deletion of an order and its restoration (Administrator only). The matrix sends `If-Match: "1"` with a DELETE, so the
    // first allowed cell really deletes `own` (the later ones are 404, which the guard-level check accepts); a POST has no `If-Match` (428,
    // nothing happens). The deletion is addressed to a live order, the restoration to the deleted one; the foreign object is the order in
    // the wrong state — the deletion of one that is deleted already and the restoration of one that is live (`live`, which no cell deletes)
    // are the same 404 as for an order that does not exist.
    deleteWorkOrder: { own: () => `${WORK_ORDERS}/${own}`, foreign: () => `${WORK_ORDERS}/${foreign}` },
    restoreWorkOrder: { own: () => `${WORK_ORDERS}/${foreign}/restore`, foreign: () => `${WORK_ORDERS}/${live}/restore` },
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

/**
 * The IDOR fixture of the processes of an order, the change of a stage and its transition (EVM-031, EVM-032 AC6, AC7; SR-AUTHZ-02, SR-AUTHZ-05, CWE-639):
 * the read — "own" is a live order with a process, "foreign" an EXISTING order that is soft deleted (its processes exist, only the
 * read policy of the order keeps them from the caller); the change — "own" is a stage of the live order in ITS path, "foreign" the
 * stage of ANOTHER live order named in the path of the first (the one an attacker tries: /work-orders/{A}/procedure-stages/{stage of B}).
 */
export async function procedureObjects(app: IdentityApp): Promise<Record<string, ObjectPaths>> {
  const db = app.database.admin;
  const customerId = await insertCustomer(db, { email: 'jan@example.invalid' });
  const siteId = await insertSite(db, { notes: 'notatka' });
  const year = 3000 + randomInt(900);
  const ids = await insertWorkOrders(db, [
    { number: `ZL-${year}-${String(randomInt(1000, 3000))}`, customerId, siteId },
    { number: `ZL-${year}-${String(randomInt(3000, 6000))}`, customerId, siteId },
    { number: `ZL-${year}-${String(randomInt(6000, 9999))}`, customerId, siteId, deletedAt: new Date('2026-10-02T08:00:00Z') },
  ]);
  const [own, other, deleted] = [...ids.values()];
  if (own === undefined || other === undefined || deleted === undefined) throw new Error('the fixture orders were not inserted');
  const gone = new Date('2026-10-01T08:00:00Z');
  const ownProcess = await insertProcedure(db, own);
  const otherProcess = await insertProcedure(db, other);
  await insertProcedure(db, deleted);
  // EVM-042: a deleted process and a deleted stage of the live order, and the same pair in ANOTHER live order (the one an attacker names)
  const ownGoneProcess = await insertProcedure(db, own, { position: 2, deletedAt: gone });
  const ownGoneStageProcess = await insertProcedure(db, own, { position: 3, stages: [{}, { deletedAt: gone }] });
  const otherGoneProcess = await insertProcedure(db, other, { position: 2, deletedAt: gone });
  const otherGoneStageProcess = await insertProcedure(db, other, { position: 3, stages: [{}, { deletedAt: gone }] });
  const ownStage = ownProcess.stageIds[0];
  const otherStage = otherProcess.stageIds[0];
  const ownGoneStage = ownGoneStageProcess.stageIds[1];
  const otherGoneStage = otherGoneStageProcess.stageIds[1];
  if (ownStage === undefined || otherStage === undefined || ownGoneStage === undefined || otherGoneStage === undefined) {
    throw new Error('the fixture stages were not inserted');
  }
  return {
    listWorkOrderProcedures: { own: () => `${WORK_ORDERS}/${own}/procedures`, foreign: () => `${WORK_ORDERS}/${deleted}/procedures` },
    updateProcedureStage: {
      own: () => `${WORK_ORDERS}/${own}/procedure-stages/${ownStage}`,
      foreign: () => `${WORK_ORDERS}/${own}/procedure-stages/${otherStage}`,
    },
    transitionProcedureStage: {
      own: () => `${WORK_ORDERS}/${own}/procedure-stages/${ownStage}/transitions`,
      foreign: () => `${WORK_ORDERS}/${own}/procedure-stages/${otherStage}/transitions`,
    },
    // EVM-042: the addition (the order of the path is the object), the deletion and the restoration of a process and of a stage
    createWorkOrderProcedure: { own: () => `${WORK_ORDERS}/${own}/procedures`, foreign: () => `${WORK_ORDERS}/${deleted}/procedures` },
    createProcedureStage: {
      own: () => `${WORK_ORDERS}/${own}/procedures/${ownProcess.id}/stages`,
      foreign: () => `${WORK_ORDERS}/${own}/procedures/${otherProcess.id}/stages`,
    },
    deleteWorkOrderProcedure: {
      own: () => `${WORK_ORDERS}/${own}/procedures/${ownProcess.id}`,
      foreign: () => `${WORK_ORDERS}/${own}/procedures/${otherProcess.id}`,
    },
    restoreWorkOrderProcedure: {
      own: () => `${WORK_ORDERS}/${own}/procedures/${ownGoneProcess.id}/restore`,
      foreign: () => `${WORK_ORDERS}/${own}/procedures/${otherGoneProcess.id}/restore`,
    },
    deleteProcedureStage: {
      own: () => `${WORK_ORDERS}/${own}/procedure-stages/${ownStage}`,
      foreign: () => `${WORK_ORDERS}/${own}/procedure-stages/${otherStage}`,
    },
    restoreProcedureStage: {
      own: () => `${WORK_ORDERS}/${own}/procedure-stages/${ownGoneStage}/restore`,
      foreign: () => `${WORK_ORDERS}/${own}/procedure-stages/${otherGoneStage}/restore`,
    },
    listDeletedWorkOrderProcedures: {
      own: () => `${WORK_ORDERS}/${own}/deleted-procedures`,
      foreign: () => `${WORK_ORDERS}/${deleted}/deleted-procedures`,
    },
  };
}

/**
 * The IDOR fixture of the journal (EVM-037 AC7, AC8; SR-AUTHZ-02, SR-AUTHZ-05, CWE-639): the list and the creation — "own" is a
 * live order, "foreign" an EXISTING order that is soft deleted (its entries exist, only the read policy of the order keeps them
 * from the caller); the entry — "own" is an entry of the live order in ITS path, "foreign" the entry of ANOTHER live order named in
 * the path of the first (the one an attacker tries: /work-orders/{A}/timeline/{entry of B}).
 */
export async function timelineObjects(app: IdentityApp): Promise<Record<string, ObjectPaths>> {
  const db = app.database.admin;
  const author = await createUser(db, app.clock, { role: 'editor' });
  const customerId = await insertCustomer(db, { email: 'jan@example.invalid' });
  const siteId = await insertSite(db, { notes: 'notatka' });
  const year = 3000 + randomInt(900);
  const ids = await insertWorkOrders(db, [
    { number: `ZL-${year}-${String(randomInt(1000, 3000))}`, customerId, siteId },
    { number: `ZL-${year}-${String(randomInt(3000, 6000))}`, customerId, siteId },
    { number: `ZL-${year}-${String(randomInt(6000, 9999))}`, customerId, siteId, deletedAt: new Date('2026-10-02T08:00:00Z') },
  ]);
  const [own, other, deleted] = [...ids.values()];
  if (own === undefined || other === undefined || deleted === undefined) throw new Error('the fixture orders were not inserted');
  const [ownEntry, eraseEntry] = await insertEntries(db, own, author.id, [{}, {}]);
  const [otherEntry, eraseForeign] = await insertEntries(db, other, author.id, [{}, {}]);
  await insertEntries(db, deleted, author.id, [{}]);
  if (ownEntry === undefined || otherEntry === undefined || eraseEntry === undefined || eraseForeign === undefined) {
    throw new Error('the fixture entries were not inserted');
  }
  const journal: ObjectPaths = { own: () => `${WORK_ORDERS}/${own}/timeline`, foreign: () => `${WORK_ORDERS}/${deleted}/timeline` };
  return {
    listTimelineEntries: journal,
    createTimelineEntry: journal,
    getTimelineEntry: {
      own: () => `${WORK_ORDERS}/${own}/timeline/${ownEntry}`,
      foreign: () => `${WORK_ORDERS}/${own}/timeline/${otherEntry}`,
    },
    // EVM-040: the deletion, the restoration and the redaction - "foreign" is the entry of ANOTHER live order named in the path of the first (the
    // one an attacker tries). Entries of their own, so the deletion of the matrix does not change what the reads of the matrix look at.
    deleteTimelineEntry: {
      own: () => `${WORK_ORDERS}/${own}/timeline/${eraseEntry}`,
      foreign: () => `${WORK_ORDERS}/${own}/timeline/${eraseForeign}`,
    },
    restoreTimelineEntry: {
      own: () => `${WORK_ORDERS}/${own}/timeline/${eraseEntry}/restore`,
      foreign: () => `${WORK_ORDERS}/${own}/timeline/${eraseForeign}/restore`,
    },
    redactTimelineEntry: {
      own: () => `${WORK_ORDERS}/${own}/timeline/${eraseEntry}/redact`,
      foreign: () => `${WORK_ORDERS}/${own}/timeline/${eraseForeign}/redact`,
    },
  };
}

/**
 * The IDOR fixture of the change of the data of an order and of the five operations on its scope (EVM-035 AC8; SR-AUTHZ-02,
 * SR-AUTHZ-05, TM-17, CWE-639): the data and the addition — "own" is a live order, "foreign" an EXISTING order that is soft deleted;
 * one item — "own" is an item of the live order in ITS path, "foreign" the item of ANOTHER live order named in the path of the
 * first (the one an attacker tries: /work-orders/{A}/scope-items/{item of B}).
 */
export async function scopeObjects(app: IdentityApp): Promise<Record<string, ObjectPaths>> {
  const db = app.database.admin;
  const customerId = await insertCustomer(db, { email: 'jan@example.invalid' });
  const siteId = await insertSite(db, { notes: 'notatka' });
  const year = 3000 + randomInt(900);
  const ids = await insertWorkOrders(db, [
    { number: `ZL-${year}-${String(randomInt(1000, 3000))}`, customerId, siteId },
    { number: `ZL-${year}-${String(randomInt(3000, 6000))}`, customerId, siteId },
    { number: `ZL-${year}-${String(randomInt(6000, 9999))}`, customerId, siteId, deletedAt: new Date('2026-10-02T08:00:00Z') },
  ]);
  const [own, other, deleted] = [...ids.values()];
  if (own === undefined || other === undefined || deleted === undefined) throw new Error('the fixture orders were not inserted');
  const [ownItem] = await insertScopeItems(db, own, [{ position: 1 }]);
  const [otherItem] = await insertScopeItems(db, other, [{ position: 1 }]);
  await insertScopeItems(db, deleted, [{ position: 1 }]);
  if (ownItem === undefined || otherItem === undefined) throw new Error('the fixture items were not inserted');
  const data: ObjectPaths = { own: () => `${WORK_ORDERS}/${own}`, foreign: () => `${WORK_ORDERS}/${deleted}` };
  const addition: ObjectPaths = { own: () => `${WORK_ORDERS}/${own}/scope-items`, foreign: () => `${WORK_ORDERS}/${deleted}/scope-items` };
  const item: ObjectPaths = {
    own: () => `${WORK_ORDERS}/${own}/scope-items/${ownItem}`,
    foreign: () => `${WORK_ORDERS}/${own}/scope-items/${otherItem}`,
  };
  return {
    updateWorkOrder: data,
    createWorkOrderScopeItem: addition,
    getWorkOrderScopeItem: item,
    updateWorkOrderScopeItem: item,
    deleteWorkOrderScopeItem: item,
  };
}

/**
 * The IDOR fixture of the payment milestones (EVM-053 AC7; SR-AUTHZ-02, SR-AUTHZ-05, TM-17, CWE-639): the list and the addition — "own"
 * is a live order, "foreign" an EXISTING order that is soft deleted (its milestones exist, only the read policy of the order keeps them
 * from the caller); the change of an amount — "own" is a milestone of the live order in ITS path, "foreign" the milestone of ANOTHER
 * live order named in the path of the first (the one an attacker tries: /work-orders/{A}/payment-milestones/{milestone of B}). The
 * transition of a milestone (EVM-054) and its deletion (EVM-057) are addressed the same way.
 */
export async function paymentObjects(app: IdentityApp): Promise<Record<string, ObjectPaths>> {
  const db = app.database.admin;
  const customerId = await insertCustomer(db, { email: 'jan@example.invalid' });
  const siteId = await insertSite(db, { notes: 'notatka' });
  const year = 3000 + randomInt(900);
  const ids = await insertWorkOrders(db, [
    { number: `ZL-${year}-${String(randomInt(1000, 3000))}`, customerId, siteId },
    { number: `ZL-${year}-${String(randomInt(3000, 6000))}`, customerId, siteId },
    { number: `ZL-${year}-${String(randomInt(6000, 9999))}`, customerId, siteId, deletedAt: new Date('2026-10-02T08:00:00Z') },
  ]);
  const [own, other, deleted] = [...ids.values()];
  if (own === undefined || other === undefined || deleted === undefined) throw new Error('the fixture orders were not inserted');
  const [ownMilestone] = await insertMilestones(db, own, [{}]);
  const [otherMilestone] = await insertMilestones(db, other, [{}]);
  await insertMilestones(db, deleted, [{}]);
  if (ownMilestone === undefined || otherMilestone === undefined) throw new Error('the fixture milestones were not inserted');
  const milestones: ObjectPaths = {
    own: () => `${WORK_ORDERS}/${own}/payment-milestones`,
    foreign: () => `${WORK_ORDERS}/${deleted}/payment-milestones`,
  };
  return {
    listPaymentMilestones: milestones,
    createPaymentMilestone: milestones,
    updatePaymentMilestone: {
      own: () => `${WORK_ORDERS}/${own}/payment-milestones/${ownMilestone}`,
      foreign: () => `${WORK_ORDERS}/${own}/payment-milestones/${otherMilestone}`,
    },
    transitionPaymentMilestone: {
      own: () => `${WORK_ORDERS}/${own}/payment-milestones/${ownMilestone}/transitions`,
      foreign: () => `${WORK_ORDERS}/${own}/payment-milestones/${otherMilestone}/transitions`,
    },
    deletePaymentMilestone: {
      own: () => `${WORK_ORDERS}/${own}/payment-milestones/${ownMilestone}`,
      foreign: () => `${WORK_ORDERS}/${own}/payment-milestones/${otherMilestone}`,
    },
  };
}

const USERS = '/api/v1/users';

/**
 * The IDOR fixture of the resend of an invitation (EVM-024 AC8) and of the administration of accounts (EVM-027 AC8; SR-AUTHZ-02, SR-AUTHZ-11, CWE-639): "own" is an account that waits for its
 * activation; "foreign" is an EXISTING account that is soft deleted — the row is in the table, and only the rule of the use case (a deleted
 * account is `404`, like one that never existed) keeps the caller from it.
 */
export async function userObjects(app: IdentityApp): Promise<Record<string, ObjectPaths>> {
  const db = app.database.admin;
  const own = await createUser(db, app.clock, { role: 'editor', status: 'invited' });
  const foreign = await createUser(db, app.clock, { role: 'editor', status: 'invited' });
  await sql`update identity.users set deleted_at = ${app.clock.now()} where id = ${foreign.id}`.execute(db);
  const pair = (suffix: string): ObjectPaths => ({
    own: () => `${USERS}/${own.id}${suffix}`,
    foreign: () => `${USERS}/${foreign.id}${suffix}`,
  });
  return {
    resendUserInvitation: pair('/invitations'),
    // EVM-027 AC8: the five operations of the administration of accounts address the same pair — a live account and an EXISTING one that is deleted
    changeUserRole: pair('/role'),
    deactivateUser: pair('/deactivation'),
    reactivateUser: pair('/reactivation'),
    endUserSessions: pair('/sessions'),
    resetUserSecondStep: pair('/second-step-reset'),
  };
}

const ACCOUNT = '/api/v1/account';

/**
 * The IDOR fixture of the own account (EVM-028 AC8; SR-AUTHZ-05, CWE-639): the key and the session of ANOTHER account that EXIST — a random identifier
 * would not prove that the owner is in the WHERE of the query. "Own" is an identifier the caller never made (a well-formed one that is nobody's): the matrix only
 * needs it to pass the guard, and the handler then answers 404 as well.
 */
export async function accountObjects(app: IdentityApp): Promise<Record<string, ObjectPaths>> {
  const db = app.database.admin;
  const stranger = await createUser(db, app.clock, { role: 'editor', status: 'active' });
  await createPasskey(db, app.clock, stranger);
  const key = await sql<{ id: string }>`select id from identity.passkeys where user_id = ${stranger.id}`.execute(db);
  const session = await createSession(db, app.clock, stranger);
  const nobody = '00000000-0000-7000-8000-000000000001';
  return {
    removePasskey: { own: () => `${ACCOUNT}/passkeys/${nobody}`, foreign: () => `${ACCOUNT}/passkeys/${key.rows[0]?.id ?? nobody}` },
    endAccountSession: { own: () => `${ACCOUNT}/sessions/${nobody}`, foreign: () => `${ACCOUNT}/sessions/${session.id}` },
  };
}

/** Every operation of the contract that addresses an object, with the paths of an own and of a foreign object. */
export async function matrixObjects(app: IdentityApp): Promise<Record<string, ObjectPaths>> {
  return {
    ...(await catalogObjects(app)),
    ...(await workOrderObjects(app)),
    ...(await customerObjects(app)),
    ...(await siteAndPartyObjects(app)),
    ...(await procedureObjects(app)),
    ...(await scopeObjects(app)),
    ...(await timelineObjects(app)),
    ...(await paymentObjects(app)),
    ...(await userObjects(app)),
    ...(await accountObjects(app)),
  };
}

import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertProcedure } from '../support/procedure-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

// EVM-042 AC6 (SR-AUTHZ-01, SR-AUTHZ-02, SR-AUTHZ-05, TM-17, CWE-639, CWE-285): who may use the seven operations, and that an object of
// another order named in the path of this one is as missing as an object that does not exist. The generic matrix of the contract
// (`role-matrix.test.ts`) covers these operations too; here are the answers the story promises, one by one.
const TODAY_INSTANT = '2026-10-14T08:00:00.000Z';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  current.clock.set(TODAY_INSTANT);
  await clearWorkOrderCreation(current.database.admin);
});

const admin = () => current.database.admin;
const BASE = '/api/v1/work-orders';
const GONE = new Date('2026-10-01T08:00:00Z');

async function signIn(role: Role, channel: 'web' | 'mobile' = 'web') {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, { channel });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}
const anonymous = () => new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);

let numbering = 0;
async function newOrder(deleted = false): Promise<string> {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `jan${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [
    { number: `ZL-6${String(numbering).padStart(3, '0')}-0001`, customerId, siteId, ...(deleted ? { deletedAt: GONE } : {}) },
  ]);
  return [...ids.values()][0] ?? '';
}

/** An order with a live process (two stages), a deleted process and a deleted stage of a live process. */
async function fixture() {
  const orderId = await newOrder();
  const live = await insertProcedure(admin(), orderId, { position: 1, stages: [{}, {}] });
  const goneProcess = await insertProcedure(admin(), orderId, { position: 2, deletedAt: GONE, stages: [{}] });
  const withGoneStage = await insertProcedure(admin(), orderId, { position: 3, stages: [{}, { deletedAt: GONE }] });
  return {
    orderId,
    processId: live.id,
    stageId: live.stageIds[0] ?? '',
    goneProcessId: goneProcess.id,
    goneStageId: withGoneStage.stageIds[1] ?? '',
    goneStageProcessId: withGoneStage.id,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

type Call = (browser: { panel: PanelClient }, target: Fixture, where?: { orderId?: string }) => Promise<{ status: number; body: unknown }>;
const IF_MATCH = { 'If-Match': '"1"' };
const KEY = () => ({ 'Idempotency-Key': uuidv7() });
/** Every operation of the story with the object it addresses. */
const OPERATIONS: Array<{ name: string; adminOnly: boolean; call: Call }> = [
  {
    name: 'createWorkOrderProcedure',
    adminOnly: false,
    call: (b, f, w) =>
      b.panel.post(`${BASE}/${w?.orderId ?? f.orderId}/procedures`, { id: uuidv7(), procedureTemplateCode: 'fire_safety_opinion' }, KEY()),
  },
  {
    name: 'createProcedureStage',
    adminOnly: false,
    call: (b, f, w) =>
      b.panel.post(`${BASE}/${w?.orderId ?? f.orderId}/procedures/${f.processId}/stages`, { id: uuidv7(), name: 'Etap' }, KEY()),
  },
  {
    name: 'deleteWorkOrderProcedure',
    adminOnly: false,
    call: (b, f, w) => b.panel.delete(`${BASE}/${w?.orderId ?? f.orderId}/procedures/${f.processId}`, { ...IF_MATCH, ...KEY() }),
  },
  {
    name: 'deleteProcedureStage',
    adminOnly: false,
    call: (b, f, w) => b.panel.delete(`${BASE}/${w?.orderId ?? f.orderId}/procedure-stages/${f.stageId}`, { ...IF_MATCH, ...KEY() }),
  },
  {
    name: 'restoreWorkOrderProcedure',
    adminOnly: true,
    call: (b, f, w) =>
      b.panel.post(`${BASE}/${w?.orderId ?? f.orderId}/procedures/${f.goneProcessId}/restore`, undefined, { ...IF_MATCH, ...KEY() }),
  },
  {
    name: 'restoreProcedureStage',
    adminOnly: true,
    call: (b, f, w) =>
      b.panel.post(`${BASE}/${w?.orderId ?? f.orderId}/procedure-stages/${f.goneStageId}/restore`, undefined, { ...IF_MATCH, ...KEY() }),
  },
  {
    name: 'listDeletedWorkOrderProcedures',
    adminOnly: true,
    call: (b, f, w) => b.panel.get(`${BASE}/${w?.orderId ?? f.orderId}/deleted-procedures`),
  },
];

const codeOf = (body: unknown) => (body as { code?: string }).code;
const withoutTrace = (body: unknown): string => JSON.stringify(body).replace(/"traceId":"[0-9a-f]+"/, '');

async function snapshot(): Promise<string> {
  const rows = await sql<{ row: string }>`
    select to_jsonb(t)::text as row from (
      select id, deleted_at, position, version from procedures.procedures
      union all select id, deleted_at, position, version from procedures.procedure_stages
    ) t order by 1`.execute(admin());
  const audit = await sql<{ n: string }>`select count(*)::text as n from audit.events`.execute(admin());
  const keys = await sql<{ n: string }>`select count(*)::text as n from platform.idempotency_records`.execute(admin());
  return JSON.stringify([rows.rows, audit.rows, keys.rows]);
}

describe('who may use the seven operations (EVM-042 AC6; SR-AUTHZ-02, SR-AUTHZ-05)', () => {
  it('EVM-042 AC6 Tylko odczyt gets 403 forbidden on every operation — also for an order and objects that do not exist — and nothing changes', async () => {
    const reader = await signIn('read_only');
    const target = await fixture();
    const before = await snapshot();
    for (const operation of OPERATIONS) {
      const own = await operation.call(reader, target);
      expect(own.status, operation.name).toBe(403);
      expect(codeOf(own.body), operation.name).toBe('forbidden');
      // the role is decided before the existence of the order: the answer for a missing order is the same
      const missing = await operation.call(reader, target, { orderId: uuidv7() });
      expect(missing.status, operation.name).toBe(403);
      expect(withoutTrace(missing.body), operation.name).toBe(withoutTrace(own.body));
    }
    expect(await snapshot()).toBe(before);
  });

  it('EVM-042 AC6 an anonymous caller gets 401 on every operation and nothing changes', async () => {
    const target = await fixture();
    const before = await snapshot();
    for (const operation of OPERATIONS) {
      const response = await operation.call({ panel: anonymous() }, target);
      expect(response.status, operation.name).toBe(401);
      expect(codeOf(response.body), operation.name).toBe('unauthenticated');
    }
    expect(await snapshot()).toBe(before);
  });

  it('EVM-042 AC6 a session of the mobile channel gets 403 forbidden on every operation — the Administrator included — and nothing changes', async () => {
    const mobile = await signIn('administrator', 'mobile');
    const target = await fixture();
    const before = await snapshot();
    for (const operation of OPERATIONS) {
      const response = await operation.call(mobile, target);
      expect(response.status, operation.name).toBe(403);
      expect(codeOf(response.body), operation.name).toBe('forbidden');
    }
    expect(await snapshot()).toBe(before);
  });

  it('EVM-042 AC6 the Editor adds and deletes, but does not restore and does not read the deleted ones: 403 forbidden, also for objects that do not exist', async () => {
    const editor = await signIn('editor');
    const target = await fixture();
    for (const operation of OPERATIONS.filter((candidate) => candidate.adminOnly)) {
      const response = await operation.call(editor, target);
      expect(response.status, operation.name).toBe(403);
      expect(codeOf(response.body), operation.name).toBe('forbidden');
      const missing = await operation.call(editor, target, { orderId: uuidv7() });
      expect(missing.status, operation.name).toBe(403);
    }
    const added = await OPERATIONS[0]?.call(editor, target);
    const staged = await OPERATIONS[1]?.call(editor, target);
    const removedStage = await OPERATIONS[3]?.call(editor, target);
    const removedProcess = await OPERATIONS[2]?.call(editor, target);
    expect([added?.status, staged?.status, removedStage?.status, removedProcess?.status]).toEqual([201, 201, 204, 412]);
  });

  it('EVM-042 AC6 the Administrator may do all seven', async () => {
    const administrator = await signIn('administrator');
    const target = await fixture();
    // the tag "1" fits the stage and the restored objects are at version 2 or more: the point is that the role is let in (not 401/403/404)
    for (const operation of OPERATIONS) {
      const response = await operation.call(administrator, target);
      expect([401, 403, 404], `${operation.name} ${JSON.stringify(response.body)}`).not.toContain(response.status);
    }
  });

  it('EVM-042 AC6 the seven operations need the CSRF token: without it a mutation is 403 csrf_failed and nothing changes', async () => {
    const administrator = await signIn('administrator');
    administrator.panel.csrfToken = undefined;
    const target = await fixture();
    const before = await snapshot();
    for (const operation of OPERATIONS.filter((candidate) => candidate.name !== 'listDeletedWorkOrderProcedures')) {
      const response = await operation.call(administrator, target);
      expect(response.status, operation.name).toBe(403);
      expect(codeOf(response.body), operation.name).toBe('csrf_failed');
    }
    expect(await snapshot()).toBe(before);
  });
});

describe('an object of another order named in the path of this one (EVM-042 AC6; SR-AUTHZ-02, TM-17, CWE-639)', () => {
  it('EVM-042 AC6 the process and the stage of order B in the path of order A are 404 not_found — the same answer as for objects that do not exist — for every operation, and B is untouched', async () => {
    const administrator = await signIn('administrator');
    const mine = await fixture();
    const theirs = await fixture();
    const before = await snapshot();
    const missing = {
      ...theirs,
      processId: uuidv7(),
      stageId: uuidv7(),
      goneProcessId: uuidv7(),
      goneStageId: uuidv7(),
    };
    // the addition of a process and the list have no object but the order (a deleted order is the test below)
    for (const operation of OPERATIONS.filter(
      (candidate) => !['listDeletedWorkOrderProcedures', 'createWorkOrderProcedure'].includes(candidate.name),
    )) {
      // the objects of B, the order of A
      const foreign = await operation.call(administrator, theirs, { orderId: mine.orderId });
      expect(foreign.status, operation.name).toBe(404);
      expect(codeOf(foreign.body), operation.name).toBe('not_found');
      // objects that do not exist at all, in the order of A
      const none = await operation.call(administrator, missing, { orderId: mine.orderId });
      expect(none.status, operation.name).toBe(404);
      expect(withoutTrace(none.body), operation.name).toBe(withoutTrace(foreign.body));
    }
    expect(await snapshot()).toBe(before);
  });

  it('EVM-042 AC6 the same holds for the Editor on the operations the Editor may use, and a body that would be refused does not tell it first (404 before 400)', async () => {
    const editor = await signIn('editor');
    const mine = await fixture();
    const theirs = await fixture();
    const crooked = await editor.panel.post(`${BASE}/${mine.orderId}/procedures/${theirs.processId}/stages`, { nothing: 'valid' }, KEY());
    expect(crooked.status).toBe(404);
    expect(codeOf(crooked.body)).toBe('not_found');
    const noTag = await editor.panel.delete(`${BASE}/${mine.orderId}/procedure-stages/${theirs.stageId}`, KEY());
    expect(noTag.status).toBe(404);
    const stage = await editor.panel.delete(`${BASE}/${mine.orderId}/procedure-stages/${theirs.stageId}`, { ...IF_MATCH, ...KEY() });
    expect(stage.status).toBe(404);
    const process = await editor.panel.delete(`${BASE}/${mine.orderId}/procedures/${theirs.processId}`, { ...IF_MATCH, ...KEY() });
    expect(process.status).toBe(404);
  });

  it('EVM-042 AC6 a stage of a process of ANOTHER order cannot be reached through the process of this order: the stage of B under the process of A is 404', async () => {
    const administrator = await signIn('administrator');
    const mine = await fixture();
    const theirs = await fixture();
    // the process is mine, the order is mine — and the new stage must land in MY process only
    const created = await administrator.panel.post(
      `${BASE}/${mine.orderId}/procedures/${mine.processId}/stages`,
      { id: uuidv7(), name: 'Mój etap' },
      KEY(),
    );
    expect(created.status).toBe(201);
    const { rows } = await sql<{ work_order_id: string; procedure_id: string }>`
      select work_order_id, procedure_id from procedures.procedure_stages where id = ${(created.body as { id: string }).id}`.execute(
      admin(),
    );
    expect(rows[0]).toEqual({ work_order_id: mine.orderId, procedure_id: mine.processId });
    expect(
      (
        await administrator.panel.post(
          `${BASE}/${theirs.orderId}/procedures/${mine.processId}/stages`,
          { id: uuidv7(), name: 'Obcy' },
          KEY(),
        )
      ).status,
    ).toBe(404);
  });

  it('EVM-042 AC6 a soft-deleted order is 404 for all seven operations — the Administrator included', async () => {
    const administrator = await signIn('administrator');
    const target = await fixture();
    const deletedOrder = await newOrder(true);
    const before = await snapshot();
    for (const operation of OPERATIONS) {
      const response = await operation.call(administrator, target, { orderId: deletedOrder });
      expect(response.status, operation.name).toBe(404);
      expect(codeOf(response.body), operation.name).toBe('not_found');
    }
    expect(await snapshot()).toBe(before);
  });

  it('EVM-042 AC6 a stage of a deleted process is 404 for the deletion and the transition, and a deleted stage is 404 for the deletion: the same as a stage that does not exist', async () => {
    const administrator = await signIn('administrator');
    const target = await fixture();
    const stageOfDeletedProcess =
      (await insertProcedure(admin(), target.orderId, { position: 4, deletedAt: GONE, stages: [{}] })).stageIds[0] ?? '';
    const answers = new Set<string>();
    for (const stageId of [stageOfDeletedProcess, target.goneStageId, uuidv7()]) {
      const response = await administrator.panel.delete(`${BASE}/${target.orderId}/procedure-stages/${stageId}`, { ...IF_MATCH, ...KEY() });
      expect(response.status, stageId).toBe(404);
      answers.add(withoutTrace(response.body));
    }
    expect(answers.size).toBe(1);
    const transition = await administrator.panel.post(
      `${BASE}/${target.orderId}/procedure-stages/${stageOfDeletedProcess}/transitions`,
      { to: 'in_progress' },
      IF_MATCH,
    );
    expect(transition.status).toBe(404);
  });
});

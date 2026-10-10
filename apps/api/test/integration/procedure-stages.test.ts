import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, ISSUED_AT, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertProcedure, type ProcedureSpec } from '../support/procedure-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';
import type { WorkOrderStatus } from '../../src/modules/work-orders/domain/work-order-list-query.ts';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});
/** The audit trail is append-only and is not emptied between tests: a test compares with the number of events it started from. */
let auditBaseline = 0;
beforeEach(async () => {
  current.clock.set(ISSUED_AT);
  await clearWorkOrderCreation(current.database.admin);
  auditBaseline = await auditTotal();
});

const admin = () => current.database.admin;
const BASE = '/api/v1/work-orders';

async function signIn(role: Role = 'editor', channel: 'web' | 'mobile' = 'web', displayName?: string) {
  const user = await createUser(admin(), current.clock, { role, ...(displayName === undefined ? {} : { displayName }) });
  const session = await createSession(admin(), current.clock, user, { channel });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;

let numbering = 0;
/** An order (a customer and a site are enough for the module) with processes; `deleted` makes it a soft-deleted one. */
async function order(
  processes: ProcedureSpec[] = [{}],
  options: { status?: WorkOrderStatus; deleted?: boolean } = {},
): Promise<{ id: string; processes: Array<{ id: string; stageIds: string[] }> }> {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `jan${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [
    {
      number: `ZL-3${String(numbering).padStart(3, '0')}-0001`,
      customerId,
      siteId,
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(options.deleted === true ? { deletedAt: new Date('2026-10-02T08:00:00Z') } : {}),
    },
  ]);
  const id = [...ids.values()][0] ?? '';
  const inserted = [];
  for (const [index, spec] of processes.entries()) inserted.push(await insertProcedure(admin(), id, { position: index + 1, ...spec }));
  return { id, processes: inserted };
}
/** One order with one process of one stage: the common starting point of the tests of a change. */
async function oneStage(options: { status?: WorkOrderStatus; stage?: ProcedureSpec['stages'] } = {}) {
  const created = await order([{ stages: options.stage ?? [{}] }], options);
  const stageId = created.processes[0]?.stageIds[0] ?? '';
  return { orderId: created.id, stageId };
}

const listOf = (browser: Browser, orderId: string) => browser.panel.get(`${BASE}/${orderId}/procedures`);
interface PatchOptions {
  readonly ifMatch?: string | null;
  readonly key?: string;
}
const patch = (browser: Browser, orderId: string, stageId: string, body: unknown, options: PatchOptions = {}) =>
  browser.panel.patch(`${BASE}/${orderId}/procedure-stages/${stageId}`, body, {
    ...(options.ifMatch === null ? {} : { 'If-Match': options.ifMatch ?? '"1"' }),
    ...(options.key === undefined ? {} : { 'Idempotency-Key': options.key }),
  });

const codeOf = (body: unknown) => (body as { code?: string }).code;
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;
const withoutTrace = (body: unknown): string => JSON.stringify(body).replace(/"traceId":"[0-9a-f]+"/, '');

interface StageRow {
  responsible_user_id: string | null;
  due_date: string | null;
  status: string;
  version: number;
  updated_by: string | null;
}
async function rowOf(stageId: string): Promise<StageRow> {
  const { rows } = await sql<StageRow>`select responsible_user_id, to_char(due_date, 'YYYY-MM-DD') as due_date, status, version, updated_by
    from procedures.procedure_stages where id = ${stageId}`.execute(admin());
  const row = rows[0];
  if (row === undefined) throw new Error('no such stage');
  return row;
}
const auditOf = async (objectId: string) =>
  (await sql<Record<string, unknown>>`select * from audit.events where object_id = ${objectId} order by occurred_at, id`.execute(admin()))
    .rows;
const auditTotal = async (): Promise<number> =>
  Number(
    (await sql<{ n: string }>`select count(*)::text as n from audit.events where action = 'procedure_stage.updated'`.execute(admin()))
      .rows[0]?.n,
  );
const idempotencyTotal = async (): Promise<number> =>
  Number((await sql<{ n: string }>`select count(*)::text as n from platform.idempotency_records`.execute(admin())).rows[0]?.n);

describe('the processes of an order (EVM-031 AC2, AC4, AC8; SR-AUTHZ-02, SR-DATA-03)', () => {
  it('EVM-031 AC2 every process with its stages in order, its progress ("3 z 7 etapów"), and every stage with the status, the due date and the person responsible { id, displayName }', async () => {
    const anna = await signIn('editor', 'web', 'Anna Testowa');
    const stages = [
      ...Array.from({ length: 3 }, () => ({ status: 'done' as const })),
      { status: 'in_progress' as const, dueDate: '2026-10-20', responsibleUserId: anna.userId },
      ...Array.from({ length: 3 }, () => ({})),
    ];
    const created = await order([
      { code: 'osd_arrangements', name: 'Uzgodnienia z OSD', stages },
      { code: 'expertise', name: 'Ekspertyza techniczna', stages: [{ status: 'done' }, { status: 'done' }, { status: 'not_applicable' }] },
    ]);
    const response = await listOf(await signIn('read_only'), created.id);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.body as {
      items: Array<Record<string, unknown> & { stages: Array<Record<string, unknown>> }>;
      openStageCount: number;
    };
    expect(body.items.map((item) => [item.position, item.code, item.name, item.progress])).toEqual([
      [1, 'osd_arrangements', 'Uzgodnienia z OSD', { done: 3, total: 7 }],
      [2, 'expertise', 'Ekspertyza techniczna', { done: 2, total: 2 }],
    ]);
    const first = body.items[0]?.stages ?? [];
    expect(first.map((stage) => stage['position'])).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(first[3]).toEqual({
      id: created.processes[0]?.stageIds[3],
      code: expect.stringMatching(/^stage_/) as unknown,
      name: expect.stringMatching(/^Etap syntetyczny/) as unknown,
      position: 4,
      status: 'in_progress',
      dueDate: '2026-10-20',
      overdue: false,
      responsibleUser: { id: anna.userId, displayName: 'Anna Testowa' },
      waitingOn: null,
      waitingParty: null,
      waitingSince: null,
      waitingDays: null,
      blockedReason: null,
      startedAt: null,
      completedOn: null,
      version: 1,
    });
    expect(first[0]).toMatchObject({ status: 'done', dueDate: null, overdue: false, responsibleUser: null });
    expect(body.openStageCount).toBe(4);
  });

  it('EVM-031 SR-DATA-03 the answer holds the keys of the contract and nothing else: no notes, no author, no e-mail of the person (EVM-032 adds "waiting for", the reason of a block, the start and the day of completion)', async () => {
    const anna = await signIn('editor', 'web', 'Anna Testowa');
    const created = await order([{ stages: [{ responsibleUserId: anna.userId }] }]);
    await sql`update procedures.procedure_stages set notes = 'notatka-etapu-xyz', blocked_reason = 'powod-blokady-xyz'`.execute(admin());
    const response = await listOf(anna, created.id);
    const body = response.body as { items: Array<Record<string, unknown> & { stages: Array<Record<string, unknown>> }> };
    expect(Object.keys(response.body as object).sort()).toEqual(['items', 'openStageCount']);
    expect(Object.keys(body.items[0] ?? {}).sort()).toEqual(['code', 'id', 'name', 'position', 'progress', 'stages']);
    expect(Object.keys(body.items[0]?.stages[0] ?? {}).sort()).toEqual(
      [
        'code',
        'dueDate',
        'id',
        'name',
        'overdue',
        'position',
        'responsibleUser',
        'status',
        'version',
        'waitingOn',
        'waitingParty',
        'waitingSince',
        'waitingDays',
        'blockedReason',
        'startedAt',
        'completedOn',
      ].sort(),
    );
    expect(Object.keys(body.items[0]?.stages[0]?.['responsibleUser'] ?? {}).sort()).toEqual(['displayName', 'id']);
    expect(JSON.stringify(response.body)).not.toMatch(/notatka-etapu|@evia\.invalid|created_by|workOrderId|procedureId/);
  });

  it('EVM-031 AC3 a stage due 2026-10-02 is overdue on 2026-10-03 (Europe/Warsaw) — and not yet on the 2nd; a stage due today is not; a finished one never', async () => {
    const created = await order([
      {
        stages: [
          { dueDate: '2026-10-02' },
          { dueDate: '2026-10-03' },
          { dueDate: '2026-10-02', status: 'done' },
          { dueDate: '2026-10-02', status: 'not_applicable' },
          { dueDate: '2026-10-02', status: 'blocked' },
        ],
      },
    ]);
    const overdueAt = async (instant: string): Promise<boolean[]> => {
      current.clock.set(instant);
      const browser = await signIn('editor');
      const stages = ((await listOf(browser, created.id)).body as { items: Array<{ stages: Array<{ overdue: boolean }> }> }).items[0]
        ?.stages;
      return (stages ?? []).map((stage) => stage.overdue);
    };
    expect(await overdueAt('2026-10-03T08:00:00Z')).toEqual([true, false, false, false, true]);
    expect(await overdueAt('2026-10-02T21:59:00Z')).toEqual([false, false, false, false, false]); // 23:59 on the 2nd in Warsaw
    expect(await overdueAt('2026-10-02T22:00:00Z')).toEqual([true, false, false, false, true]); // 00:00 on the 3rd in Warsaw
  });

  it('EVM-031 AC4 the number of open stages (todo, in_progress, waiting) of the whole order: 4 of 9 stages in two processes', async () => {
    const created = await order([
      { stages: [{ status: 'todo' }, { status: 'in_progress' }, { status: 'done' }, { status: 'blocked' }, { status: 'not_applicable' }] },
      { stages: [{ status: 'todo' }, { status: 'in_progress' }, { status: 'done' }, { status: 'done' }] },
    ]);
    expect(((await listOf(await signIn('editor'), created.id)).body as { openStageCount: number }).openStageCount).toBe(4);
  });

  it('EVM-031 AC8 an order without processes is an empty list and zero open stages — not an error', async () => {
    const created = await order([]);
    const response = await listOf(await signIn('editor'), created.id);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [], openStageCount: 0 });
  });

  it('EVM-031 AC2 the stages and processes that are soft deleted do not appear, and the stages of ANOTHER order never do', async () => {
    const mine = await order([
      { stages: [{}, { deletedAt: new Date('2026-10-02T08:00:00Z') }] },
      { deletedAt: new Date('2026-10-02T08:00:00Z') },
    ]);
    await order([{ stages: [{}, {}, {}] }]);
    const body = (await listOf(await signIn('editor'), mine.id)).body as { items: Array<{ stages: unknown[] }>; openStageCount: number };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.stages).toHaveLength(1);
    expect(body.openStageCount).toBe(1);
  });

  it('EVM-031 SR-API-02 the names of more than 100 different people responsible are read in batches (the facade takes 100 at a time) and every stage has its person', async () => {
    const people: Awaited<ReturnType<typeof createUser>>[] = [];
    for (let index = 0; index < 101; index += 1)
      people.push(await createUser(admin(), current.clock, { role: 'editor', displayName: `Osoba ${index}` }));
    const stage = (index: number) => ({ responsibleUserId: people[index]?.id ?? '' });
    const created = await order([
      { stages: Array.from({ length: 30 }, (_, index) => stage(index)) },
      { stages: Array.from({ length: 30 }, (_, index) => stage(30 + index)) },
      { stages: Array.from({ length: 30 }, (_, index) => stage(60 + index)) },
      { stages: Array.from({ length: 11 }, (_, index) => stage(90 + index)) },
    ]);
    const response = await listOf(await signIn('editor'), created.id);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const stages = (
      response.body as { items: Array<{ stages: Array<{ responsibleUser: { displayName: string } | null }> }> }
    ).items.flatMap((item) => item.stages);
    expect(stages).toHaveLength(101);
    expect(stages.map((item) => item.responsibleUser?.displayName)).toEqual(Array.from({ length: 101 }, (_, index) => `Osoba ${index}`));
  });

  it('EVM-031 AC6 AC7 an order that is soft deleted and one that never existed are the SAME 404 not_found for every role, the Administrator included; a malformed id is 400', async () => {
    const deleted = await order([{}], { deleted: true });
    const missing = uuidv7();
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const browser = await signIn(role);
      const first = await listOf(browser, deleted.id);
      const second = await listOf(browser, missing);
      expect(first.status, role).toBe(404);
      expect(codeOf(first.body)).toBe('not_found');
      expect(withoutTrace(first.body)).toBe(withoutTrace(second.body));
      expect((await listOf(browser, 'not-a-uuid')).status).toBe(400);
    }
  });

  it('EVM-031 AC7 an anonymous caller is 401 and a mobile token 403 channel_not_allowed on the read', async () => {
    const created = await order();
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    const response = await anonymous.get(`${BASE}/${created.id}/procedures`);
    expect(response.status).toBe(401);
    expect(codeOf(response.body)).toBe('unauthenticated');
    const mobile = await listOf(await signIn('editor', 'mobile'), created.id);
    expect(mobile.status).toBe(403);
    expect(codeOf(mobile.body)).toBe('forbidden');
  });
});

describe('the change of the person responsible and the due date (EVM-031 AC3; SR-INPUT-01, SR-API-07)', () => {
  it('EVM-031 AC3 the Editor sets the person and the date: 200, version 2, the new ETag, the author of the change, and the list shows both', async () => {
    const { orderId, stageId } = await oneStage();
    const editor = await signIn('editor');
    const anna = await signIn('editor', 'web', 'Anna Testowa');
    const response = await patch(editor, orderId, stageId, { responsibleUserId: anna.userId, dueDate: '2026-10-20' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['etag']).toBe('"2"');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['idempotent-replayed']).toBeUndefined();
    expect(response.body).toMatchObject({
      id: stageId,
      status: 'todo',
      dueDate: '2026-10-20',
      overdue: false,
      responsibleUser: { id: anna.userId, displayName: 'Anna Testowa' },
      version: 2,
    });
    expect(await rowOf(stageId)).toEqual({
      responsible_user_id: anna.userId,
      due_date: '2026-10-20',
      status: 'todo',
      version: 2,
      updated_by: editor.userId,
    });
    const listed = (await listOf(editor, orderId)).body as { items: Array<{ stages: Array<Record<string, unknown>> }> };
    expect(listed.items[0]?.stages[0]).toMatchObject({
      dueDate: '2026-10-20',
      responsibleUser: { displayName: 'Anna Testowa' },
      version: 2,
    });
  });

  it('EVM-031 AC7 the Administrator changes a stage as well', async () => {
    const { orderId, stageId } = await oneStage();
    const response = await patch(await signIn('administrator'), orderId, stageId, { dueDate: '2026-11-01' });
    expect(response.status).toBe(200);
    expect((await rowOf(stageId)).due_date).toBe('2026-11-01');
  });

  it('EVM-031 AC3 a stage with a due date before today answers overdue: true in the change too (2026-10-02, today 2026-10-03)', async () => {
    const { orderId, stageId } = await oneStage();
    current.clock.set('2026-10-03T08:00:00Z');
    const response = await patch(await signIn('editor'), orderId, stageId, { dueDate: '2026-10-02' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ dueDate: '2026-10-02', overdue: true });
  });

  it('EVM-031 AC3 a field that is absent stays, null clears: the date alone leaves the person, the person alone leaves the date', async () => {
    const anna = await signIn('editor', 'web', 'Anna Testowa');
    const { orderId, stageId } = await oneStage({ stage: [{ dueDate: '2026-10-20', responsibleUserId: anna.userId }] });
    const editor = await signIn('editor');
    expect((await patch(editor, orderId, stageId, { dueDate: '2026-10-21' })).status).toBe(200);
    expect(await rowOf(stageId)).toMatchObject({ due_date: '2026-10-21', responsible_user_id: anna.userId, version: 2 });
    expect((await patch(editor, orderId, stageId, { responsibleUserId: null }, { ifMatch: '"2"' })).status).toBe(200);
    expect(await rowOf(stageId)).toMatchObject({ due_date: '2026-10-21', responsible_user_id: null, version: 3 });
    const cleared = await patch(editor, orderId, stageId, { dueDate: null }, { ifMatch: '"3"' });
    expect(cleared.body).toMatchObject({ dueDate: null, responsibleUser: null, overdue: false, version: 4 });
  });

  it('EVM-031 AC3 SR-API-07 a stale If-Match is 412 version_conflict: the data stay, nothing is written, the answer holds no current value', async () => {
    const anna = await signIn('editor', 'web', 'Anna Testowa');
    const { orderId, stageId } = await oneStage({ stage: [{ dueDate: '2026-10-20' }] });
    await sql`update procedures.procedure_stages set version = 3 where id = ${stageId}`.execute(admin());
    const editor = await signIn('editor');
    const response = await patch(editor, orderId, stageId, { responsibleUserId: anna.userId, dueDate: '2026-12-31' }, { ifMatch: '"2"' });
    expect(response.status).toBe(412);
    expect(codeOf(response.body)).toBe('version_conflict');
    expect(JSON.stringify(response.body)).not.toMatch(/2026-10-20|2026-12-31|"3"|Anna/);
    expect(await rowOf(stageId)).toMatchObject({ due_date: '2026-10-20', responsible_user_id: null, version: 3 });
    expect(await auditTotal()).toBe(auditBaseline);
    expect(await idempotencyTotal()).toBe(0);
  });

  it('EVM-031 AC3 If-Match: absent is 428; weak, a list, * or malformed is 400 at the header — whether or not the stage exists', async () => {
    const { orderId, stageId } = await oneStage();
    const editor = await signIn('editor');
    const absent = await patch(editor, orderId, stageId, { dueDate: '2026-11-01' }, { ifMatch: null });
    expect(absent.status).toBe(428);
    expect(codeOf(absent.body)).toBe('precondition_required');
    for (const header of ['W/"1"', '"1", "2"', '*', '1', '"0"', '"abc"']) {
      for (const target of [stageId, uuidv7()]) {
        const response = await patch(editor, orderId, target, { dueDate: '2026-11-01' }, { ifMatch: header });
        expect(response.status, header).toBe(400);
        expect(errorsOf(response.body)).toEqual([{ pointer: '/headers/If-Match', code: 'invalid_format' }]);
      }
    }
    expect((await rowOf(stageId)).version).toBe(1);
  });

  it('EVM-031 AC3 two changes with the SAME ETag at once: one is 200, the other 412, the version rose by one and one event was written', async () => {
    const { orderId, stageId } = await oneStage();
    const editor = await signIn('editor');
    const other = await signIn('administrator');
    const [first, second] = await Promise.all([
      patch(editor, orderId, stageId, { dueDate: '2026-11-01' }),
      patch(other, orderId, stageId, { dueDate: '2026-11-02' }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 412]);
    expect((await rowOf(stageId)).version).toBe(2);
    expect(await auditOf(stageId)).toHaveLength(1);
  });
});

describe('what the change may name (EVM-031 AC3, AC6; SR-INPUT-01, SR-INPUT-02, SR-AUTHZ-04; CWE-915)', () => {
  it('EVM-031 AC3 a patch that names nothing, a date that is not a date and a date outside 2000..2100 are 400 with a pointer and a code, never the value', async () => {
    const { orderId, stageId } = await oneStage();
    const editor = await signIn('editor');
    const empty = await patch(editor, orderId, stageId, {});
    expect(empty.status).toBe(400);
    expect(errorsOf(empty.body)).toEqual([{ pointer: '', code: 'required' }]);
    for (const [dueDate, code] of [
      ['1999-12-31', 'out_of_range'],
      ['2101-01-01', 'out_of_range'],
      ['09.10.2026', 'invalid_format'],
      ['2026-02-30', 'invalid_format'],
      ['jutro', 'invalid_format'],
    ] as const) {
      const response = await patch(editor, orderId, stageId, { dueDate });
      expect(response.status, dueDate).toBe(400);
      expect(errorsOf(response.body)).toEqual([{ pointer: '/dueDate', code }]);
      expect(JSON.stringify(response.body)).not.toContain(dueDate);
    }
    const badType = await patch(editor, orderId, stageId, { dueDate: 20261009 });
    expect(errorsOf(badType.body)).toEqual([{ pointer: '/dueDate', code: 'invalid_type' }]);
    const badUser = await patch(editor, orderId, stageId, { responsibleUserId: 'nie-uuid' });
    expect(errorsOf(badUser.body)).toEqual([{ pointer: '/responsibleUserId', code: 'invalid_format' }]);
    expect(await rowOf(stageId)).toMatchObject({ version: 1, due_date: null });
  });

  it('EVM-031 AC3 a field of the server — status, name, code, position, version, overdue, waitingParty, waitingDays, the reason of a block, notes … — is 400 read_only_field and the stage is untouched (mass assignment)', async () => {
    const { orderId, stageId } = await oneStage();
    const editor = await signIn('editor');
    for (const field of [
      'id',
      'status',
      'name',
      'code',
      'position',
      'version',
      'overdue',
      'responsibleUser',
      'procedureId',
      'workOrderId',
      'waitingParty',
      'waitingDays',
      'blockedReason',
      'startedAt',
      'completedOn',
      'outputDocumentKindCodes',
      'sourceStageTemplateId',
      'notes',
    ]) {
      const response = await patch(editor, orderId, stageId, { dueDate: '2026-11-01', [field]: 'done' });
      expect(response.status, field).toBe(400);
      expect(errorsOf(response.body), field).toEqual([{ pointer: `/${field}`, code: 'read_only_field' }]);
    }
    expect(await rowOf(stageId)).toMatchObject({ status: 'todo', version: 1, due_date: null });
  });

  it('EVM-031 AC3 a stranger (customerId, __proto__, constructor) is 400 unknown_field and the stage is untouched', async () => {
    const { orderId, stageId } = await oneStage();
    const editor = await signIn('editor');
    const response = await patch(editor, orderId, stageId, { dueDate: '2026-11-01', customerId: uuidv7() });
    expect(errorsOf(response.body)).toEqual([{ pointer: '/customerId', code: 'unknown_field' }]);
    for (const raw of ['{"dueDate":"2026-11-01","__proto__":{"status":"done"}}', '{"constructor":{"prototype":{"status":"done"}}}']) {
      const proto = await editor.panel
        .patch(`${BASE}/${orderId}/procedure-stages/${stageId}`, undefined, { 'If-Match': '"1"' })
        .set('Content-Type', 'application/json')
        .send(raw);
      expect(proto.status, raw).toBe(400);
    }
    expect(await rowOf(stageId)).toMatchObject({ status: 'todo', version: 1, due_date: null });
  });

  it('EVM-031 AC6 a person who does not exist, one who is only invited, a deactivated one and a deleted one are the SAME answer — 400 assignee_unavailable; the stage is untouched', async () => {
    const { orderId, stageId } = await oneStage();
    const editor = await signIn('editor');
    const invited = await createUser(admin(), current.clock, { status: 'invited' });
    const deactivated = await createUser(admin(), current.clock, { status: 'deactivated' });
    const deleted = await createUser(admin(), current.clock, { status: 'active' });
    await sql`update identity.users set deleted_at = ${current.clock.now()} where id = ${deleted.id}`.execute(admin());
    const answers = new Set<string>();
    for (const userId of [uuidv7(), invited.id, deactivated.id, deleted.id]) {
      const response = await patch(editor, orderId, stageId, { responsibleUserId: userId });
      expect(response.status, userId).toBe(400);
      expect(codeOf(response.body)).toBe('validation_failed');
      expect(errorsOf(response.body)).toEqual([{ pointer: '/responsibleUserId', code: 'assignee_unavailable' }]);
      expect(JSON.stringify(response.body)).not.toContain(userId);
      answers.add(withoutTrace(response.body));
    }
    expect(answers.size).toBe(1);
    expect(await rowOf(stageId)).toMatchObject({ responsible_user_id: null, version: 1 });
    expect(await auditTotal()).toBe(auditBaseline);
    expect(await idempotencyTotal()).toBe(0);
  });

  it('EVM-031 AC6 a failed check of the person leaves nothing: the due date named in the same patch is NOT saved either', async () => {
    const { orderId, stageId } = await oneStage();
    const response = await patch(await signIn('editor'), orderId, stageId, { responsibleUserId: uuidv7(), dueDate: '2026-11-01' });
    expect(response.status).toBe(400);
    expect(await rowOf(stageId)).toMatchObject({ due_date: null, version: 1 });
  });
});

describe('a stage of another order (EVM-031 AC6; SR-AUTHZ-02, SR-INPUT-02, CWE-639)', () => {
  it('EVM-031 AC6 the stage of order B sent through the path of order A is 404 not_found — the same answer as for a stage that does not exist — and B is untouched', async () => {
    const a = await order([{}]);
    const b = await order([{ stages: [{ dueDate: '2026-10-20' }] }]);
    const stageOfB = b.processes[0]?.stageIds[0] ?? '';
    for (const role of ['administrator', 'editor'] as const) {
      const browser = await signIn(role);
      const foreign = await patch(browser, a.id, stageOfB, { dueDate: '2026-12-31' });
      const missing = await patch(browser, a.id, uuidv7(), { dueDate: '2026-12-31' });
      expect(foreign.status, role).toBe(404);
      expect(codeOf(foreign.body)).toBe('not_found');
      expect(withoutTrace(foreign.body)).toBe(withoutTrace(missing.body));
    }
    expect(await rowOf(stageOfB)).toMatchObject({ due_date: '2026-10-20', version: 1 });
    expect(await auditTotal()).toBe(auditBaseline);
  });

  it('EVM-031 AC6 the answer does not depend on whether the stage exists in another order: a foreign stage with a stale If-Match, a wrong body or a closed order of its own is the same 404', async () => {
    const a = await order([{}]);
    const b = await order([{}], { status: 'settled' });
    const stageOfB = b.processes[0]?.stageIds[0] ?? '';
    const editor = await signIn('editor');
    const answers = new Set<string>();
    for (const [body, ifMatch] of [
      [{ dueDate: '2026-12-31' }, '"1"'],
      [{ dueDate: '2026-12-31' }, '"9"'],
      [{ status: 'done' }, '"1"'],
      [{}, '"1"'],
    ] as const) {
      const response = await patch(editor, a.id, stageOfB, body, { ifMatch });
      expect(response.status, JSON.stringify(body)).toBe(404);
      answers.add(withoutTrace(response.body));
    }
    expect(answers.size).toBe(1);
  });

  it('EVM-031 AC6 the stage of an order that is soft deleted is 404 for every role — the Administrator included — in its OWN path, whatever the If-Match and the body', async () => {
    const deleted = await order([{}], { deleted: true });
    const stageId = deleted.processes[0]?.stageIds[0] ?? '';
    for (const role of ['administrator', 'editor'] as const) {
      const browser = await signIn(role);
      for (const [body, ifMatch] of [
        [{ dueDate: '2026-12-31' }, '"1"'],
        [{ dueDate: '2026-12-31' }, '"7"'],
        [{ status: 'done' }, '"1"'],
      ] as const) {
        const response = await patch(browser, deleted.id, stageId, body, { ifMatch });
        expect(response.status, role).toBe(404);
        expect(codeOf(response.body)).toBe('not_found');
      }
    }
    expect(await rowOf(stageId)).toMatchObject({ due_date: null, version: 1 });
  });

  it('EVM-031 AC6 a stage that is soft deleted itself is 404', async () => {
    const created = await order([{ stages: [{ deletedAt: new Date('2026-10-02T08:00:00Z') }] }]);
    const response = await patch(await signIn('editor'), created.id, created.processes[0]?.stageIds[0] ?? '', { dueDate: '2026-12-31' });
    expect(response.status).toBe(404);
  });

  it('EVM-031 AC6 a stage of a process that is soft deleted is 404 as well — the process is gone, so are its stages', async () => {
    const created = await order([{ deletedAt: new Date('2026-10-02T08:00:00Z') }]);
    const response = await patch(await signIn('editor'), created.id, created.processes[0]?.stageIds[0] ?? '', { dueDate: '2026-12-31' });
    expect(response.status).toBe(404);
    expect(codeOf(response.body)).toBe('not_found');
  });

  it('EVM-031 AC6 a malformed order id or stage id is 400 validation_failed, before the database', async () => {
    const editor = await signIn('editor');
    const response = await editor.panel.patch(
      `${BASE}/not-a-uuid/procedure-stages/${uuidv7()}`,
      { dueDate: '2026-11-01' },
      { 'If-Match': '"1"' },
    );
    expect(response.status).toBe(400);
    const other = await editor.panel.patch(`${BASE}/${uuidv7()}/procedure-stages/x`, { dueDate: '2026-11-01' }, { 'If-Match': '"1"' });
    expect(other.status).toBe(400);
  });
});

describe('a closed order is read-only (EVM-031 AC5; PO-8, ASVS V2.3.3)', () => {
  it('EVM-031 AC5 an order that is settled — and one that is cancelled — answers 409 work_order_closed to the person and to the date; nothing is written', async () => {
    const anna = await signIn('editor', 'web', 'Anna Testowa');
    for (const status of ['settled', 'cancelled'] as const) {
      const { orderId, stageId } = await oneStage({ status, stage: [{ dueDate: '2026-10-20' }] });
      for (const role of ['administrator', 'editor'] as const) {
        const browser = await signIn(role);
        for (const body of [{ responsibleUserId: anna.userId }, { dueDate: '2026-12-31' }, { responsibleUserId: null, dueDate: null }]) {
          const response = await patch(browser, orderId, stageId, body);
          expect(response.status, `${status} ${role}`).toBe(409);
          expect(codeOf(response.body)).toBe('work_order_closed');
          expect(JSON.stringify(response.body)).not.toMatch(/settled|cancelled|2026-10-20|Anna/);
        }
      }
      expect(await rowOf(stageId)).toMatchObject({ due_date: '2026-10-20', responsible_user_id: null, version: 1 });
    }
    expect(await auditTotal()).toBe(auditBaseline);
    expect(await idempotencyTotal()).toBe(0);
  });

  it('EVM-031 AC5 the reasons are told in the order: a closed order is 409 even with a stale If-Match (not 412), and the stage is still READ for a closed order', async () => {
    const { orderId, stageId } = await oneStage({ status: 'settled' });
    const editor = await signIn('editor');
    const stale = await patch(editor, orderId, stageId, { dueDate: '2026-12-31' }, { ifMatch: '"9"' });
    expect(stale.status).toBe(409);
    expect(codeOf(stale.body)).toBe('work_order_closed');
    const read = await listOf(editor, orderId);
    expect(read.status).toBe(200);
  });

  it('EVM-031 AC5 the other statuses allow the change: new, in progress, on hold and completed', async () => {
    for (const status of ['new', 'quoting', 'accepted', 'in_progress', 'completed', 'on_hold'] as const) {
      const { orderId, stageId } = await oneStage({ status });
      expect((await patch(await signIn('editor'), orderId, stageId, { dueDate: '2026-12-31' })).status, status).toBe(200);
    }
  });

  it('EVM-031 AC5 an order that is closed while the change waits for its lock: the decision is taken on the LOCKED row, so the change is 409 and nothing is written', async () => {
    const { orderId, stageId } = await oneStage({ status: 'completed' });
    const editor = await signIn('editor');
    let locked!: () => void;
    const hasLock = new Promise<void>((resolve) => (locked = resolve));
    let release!: () => void;
    const mayClose = new Promise<void>((resolve) => (release = resolve));
    // another transaction holds the order and settles it only after the change has queued behind the lock
    const closing = admin()
      .transaction()
      .execute(async (inner) => {
        await sql`select 1 from work_orders.work_orders where id = ${orderId} for update`.execute(inner);
        locked();
        await mayClose;
        await sql`update work_orders.work_orders set status = 'settled', version = version + 1 where id = ${orderId}`.execute(inner);
      });
    await hasLock;
    const pending = patch(editor, orderId, stageId, { dueDate: '2026-12-31' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await closing;
    const response = await pending;
    expect(response.status, JSON.stringify(response.body)).toBe(409);
    expect(codeOf(response.body)).toBe('work_order_closed');
    expect((await rowOf(stageId)).due_date).toBeNull();
  });
});

describe('who may change a stage (EVM-031 AC7; SR-AUTHZ-01, SR-AUTHZ-05, SR-LOG-02, SR-LOG-03)', () => {
  it('EVM-031 AC7 Tylko odczyt reads and gets 403 forbidden on a change — whatever it carries, before the headers, the body and the existence of the stage', async () => {
    const { orderId, stageId } = await oneStage();
    const reader = await signIn('read_only');
    expect((await listOf(reader, orderId)).status).toBe(200);
    for (const [target, target2, body, ifMatch] of [
      [orderId, stageId, { dueDate: '2026-11-01' }, '"1"'],
      [orderId, stageId, {}, null],
      [orderId, uuidv7(), { status: 'done' }, 'W/"1"'],
      [uuidv7(), uuidv7(), { responsibleUserId: 'zle' }, '"1"'],
    ] as const) {
      const response = await patch(reader, target, target2, body, { ifMatch });
      expect(response.status).toBe(403);
      expect(codeOf(response.body)).toBe('forbidden');
      expect(JSON.stringify(response.body)).not.toContain('errors');
    }
    expect(await rowOf(stageId)).toMatchObject({ due_date: null, version: 1 });
    expect(await idempotencyTotal()).toBe(0);
  });

  it('EVM-031 AC7 no session is 401 before the body; the mobile channel is 403 channel_not_allowed; a missing or wrong CSRF token is 403 csrf_failed — the stage is untouched', async () => {
    const { orderId, stageId } = await oneStage();
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    const noSession = await anonymous.patch(
      `${BASE}/${orderId}/procedure-stages/${stageId}`,
      { dueDate: '2026-11-01' },
      { 'If-Match': '"1"' },
    );
    expect(noSession.status).toBe(401);
    expect(codeOf(noSession.body)).toBe('unauthenticated');

    const mobile = await signIn('editor', 'mobile');
    const onMobile = await patch(mobile, orderId, stageId, { dueDate: '2026-11-01' });
    expect(onMobile.status).toBe(403);

    const editor = await signIn('editor');
    const target = `${BASE}/${orderId}/procedure-stages/${stageId}`;
    const wrongToken = await editor.panel.patch(target, { dueDate: '2026-11-01' }, { 'If-Match': '"1"' }).set('X-CSRF-Token', 'zly-token');
    expect(wrongToken.status).toBe(403);
    expect(codeOf(wrongToken.body)).toBe('csrf_failed');
    const noToken = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    noToken.cookie = editor.panel.cookie;
    const withoutToken = await noToken.patch(target, { dueDate: '2026-11-01' }, { 'If-Match': '"1"' });
    expect(withoutToken.status).toBe(403);
    expect(codeOf(withoutToken.body)).toBe('csrf_failed');
    expect(await rowOf(stageId)).toMatchObject({ due_date: null, version: 1 });
  });
});

describe('the idempotency of the change (EVM-031 AC3; SR-API-05, ASVS V2.3.3, CWE-639)', () => {
  it('EVM-031 AC3 a repeat (same key, stage and body) answers 200 with Idempotent-Replayed, with no second change and no second audit event — even with an If-Match that is stale by now', async () => {
    const { orderId, stageId } = await oneStage();
    const editor = await signIn('editor');
    const key = uuidv7();
    const first = await patch(editor, orderId, stageId, { dueDate: '2026-11-01' }, { key });
    expect(first.status).toBe(200);
    const again = await patch(editor, orderId, stageId, { dueDate: '2026-11-01' }, { key });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body).toEqual(first.body);
    expect((await rowOf(stageId)).version).toBe(2);
    expect(await auditOf(stageId)).toHaveLength(1);
  });

  it('EVM-031 AC3 the same key with another body is 422 idempotency_mismatch', async () => {
    const { orderId, stageId } = await oneStage();
    const editor = await signIn('editor');
    const key = uuidv7();
    expect((await patch(editor, orderId, stageId, { dueDate: '2026-11-01' }, { key })).status).toBe(200);
    const other = await patch(editor, orderId, stageId, { dueDate: '2026-11-02' }, { key, ifMatch: '"2"' });
    expect(other.status).toBe(422);
    expect(codeOf(other.body)).toBe('idempotency_mismatch');
    expect((await rowOf(stageId)).due_date).toBe('2026-11-01');
  });

  it('EVM-031 AC3 the key is bound to the STAGE: the same key and body for ANOTHER stage is 422 idempotency_mismatch, never a replay that would skip the second change', async () => {
    const first = await oneStage();
    const second = await oneStage();
    const editor = await signIn('editor');
    const key = uuidv7();
    expect((await patch(editor, first.orderId, first.stageId, { dueDate: '2026-11-01' }, { key })).status).toBe(200);
    const other = await patch(editor, second.orderId, second.stageId, { dueDate: '2026-11-01' }, { key });
    expect(other.status).toBe(422);
    expect(codeOf(other.body)).toBe('idempotency_mismatch');
    expect(await rowOf(second.stageId)).toMatchObject({ due_date: null, version: 1 });
  });

  it('EVM-031 AC3 a failed change leaves no record that would block the retry with the same key', async () => {
    const { orderId, stageId } = await oneStage();
    const editor = await signIn('editor');
    const key = uuidv7();
    expect((await patch(editor, orderId, stageId, { dueDate: '2026-11-01' }, { key, ifMatch: '"5"' })).status).toBe(412);
    expect(await idempotencyTotal()).toBe(0);
    expect((await patch(editor, orderId, stageId, { dueDate: '2026-11-01' }, { key })).status).toBe(200);
    expect(await idempotencyTotal()).toBe(1);
  });

  it('EVM-031 AC3 a key that is not a UUIDv7 is 400 at the header', async () => {
    const { orderId, stageId } = await oneStage();
    const response = await patch(await signIn('editor'), orderId, stageId, { dueDate: '2026-11-01' }, { key: 'abc' });
    expect(response.status).toBe(400);
  });
});

describe('what is audited and what is logged (EVM-031; SR-LOG-02, SR-LOG-03, SR-DATA-03)', () => {
  it('EVM-031 SR-LOG-03 the audit trail has ONE procedure_stage.updated with the actor, the stage, the outcome and the trace — and no name, no date, no field', async () => {
    const { orderId, stageId } = await oneStage();
    const editor = await signIn('editor');
    const anna = await signIn('editor', 'web', 'Anna Poufna');
    expect((await patch(editor, orderId, stageId, { responsibleUserId: anna.userId, dueDate: '2026-11-17' })).status).toBe(200);
    const events = await auditOf(stageId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'procedure_stage.updated',
      outcome: 'success',
      actor_type: 'user',
      actor_user_id: editor.userId,
      object_type: 'procedure_stage',
      object_id: stageId,
      origin: 'web',
    });
    expect(String(events[0]?.['trace_id'])).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(events)).not.toMatch(/Poufna|Anna|2026-11-17|dueDate|due_date|responsible/);
  });

  it('EVM-031 SR-LOG-02 nothing about the person or the date reaches the log of the API — not a value, not a rejected one, not a name', async () => {
    const { orderId, stageId } = await oneStage();
    const editor = await signIn('editor');
    const secret = await signIn('editor', 'web', 'Jan Sekretny');
    const before = current.logs.lines.length;
    await patch(editor, orderId, stageId, { responsibleUserId: secret.userId, dueDate: '2031-03-04' });
    await patch(editor, orderId, stageId, { dueDate: '2099-09-09', notes: 'sekretna-notatka' }, { ifMatch: '"2"' });
    await patch(editor, orderId, stageId, { dueDate: '2098-08-08' }, { ifMatch: '"1"' });
    await listOf(editor, orderId);
    const logged = current.logs.lines.slice(before).join('\n');
    expect(logged).not.toMatch(/Sekretny|sekretna|2031-03-04|2099-09-09|2098-08-08/);
  });
});

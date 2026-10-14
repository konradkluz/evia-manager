import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorkOrderStatus } from '../../src/modules/work-orders/domain/work-order-status.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertProcedure, type ProcedureSpec } from '../support/procedure-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

// EVM-042: the processes and stages added, deleted and restored by hand — the commands, the rules and what they leave behind.
// The matrix of roles and the objects of other orders (AC6) are in `procedures-manual-authz.test.ts`.
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

async function signIn(role: Role = 'editor') {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, { channel: 'web' });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;

let numbering = 0;
async function order(
  processes: ProcedureSpec[] = [],
  options: { status?: WorkOrderStatus } = {},
): Promise<{ id: string; processes: Array<{ id: string; stageIds: string[] }> }> {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `jan${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [
    {
      number: `ZL-5${String(numbering).padStart(3, '0')}-0001`,
      customerId,
      siteId,
      ...(options.status === undefined ? {} : { status: options.status }),
    },
  ]);
  const id = [...ids.values()][0] ?? '';
  const inserted = [];
  for (const [index, spec] of processes.entries()) inserted.push(await insertProcedure(admin(), id, { position: index + 1, ...spec }));
  return { id, processes: inserted };
}

interface Options {
  readonly ifMatch?: string | null;
  readonly key?: string;
}
const headersOf = (options: Options, defaultIfMatch: string | null) => ({
  ...(options.ifMatch === null || (options.ifMatch === undefined && defaultIfMatch === null)
    ? {}
    : { 'If-Match': options.ifMatch ?? defaultIfMatch ?? '' }),
  ...(options.key === undefined ? {} : { 'Idempotency-Key': options.key }),
});
const addProcedure = (browser: Browser, orderId: string, body: unknown, options: Options = {}) =>
  browser.panel.post(`${BASE}/${orderId}/procedures`, body, headersOf(options, null));
const addStage = (browser: Browser, orderId: string, procedureId: string, body: unknown, options: Options = {}) =>
  browser.panel.post(`${BASE}/${orderId}/procedures/${procedureId}/stages`, body, headersOf(options, null));
const removeProcedure = (browser: Browser, orderId: string, procedureId: string, options: Options = {}) =>
  browser.panel.delete(`${BASE}/${orderId}/procedures/${procedureId}`, headersOf(options, '"1"'));
const removeStage = (browser: Browser, orderId: string, stageId: string, options: Options = {}) =>
  browser.panel.delete(`${BASE}/${orderId}/procedure-stages/${stageId}`, headersOf(options, '"1"'));
const restoreProcedure = (browser: Browser, orderId: string, procedureId: string, options: Options = {}) =>
  browser.panel.post(`${BASE}/${orderId}/procedures/${procedureId}/restore`, undefined, headersOf(options, '"2"'));
const restoreStage = (browser: Browser, orderId: string, stageId: string, options: Options = {}) =>
  browser.panel.post(`${BASE}/${orderId}/procedure-stages/${stageId}/restore`, undefined, headersOf(options, '"2"'));
const listOf = (browser: Browser, orderId: string) => browser.panel.get(`${BASE}/${orderId}/procedures`);
const deletedOf = (browser: Browser, orderId: string) => browser.panel.get(`${BASE}/${orderId}/deleted-procedures`);

const codeOf = (body: unknown) => (body as { code?: string }).code;
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;
const withoutTrace = (body: unknown): string => JSON.stringify(body).replace(/"traceId":"[0-9a-f]+"/, '');

interface StageBody {
  id: string;
  code: string;
  name: string;
  position: number;
  status: string;
  dueDate: string | null;
  responsibleUser: { id: string } | null;
  version: number;
}
interface ProcedureBody {
  id: string;
  code: string;
  name: string;
  position: number;
  version: number;
  progress: { done: number; total: number };
  stages: StageBody[];
}
const procedureOf = (body: unknown) => body as ProcedureBody;
const stageOf = (body: unknown) => body as StageBody;
const listBody = (body: unknown) => (body as { items: ProcedureBody[]; openStageCount: number }).items;

async function versionOf(table: 'procedures' | 'procedure_stages', id: string): Promise<number> {
  const { rows } =
    table === 'procedures'
      ? await sql<{ version: number }>`select version from procedures.procedures where id = ${id}`.execute(admin())
      : await sql<{ version: number }>`select version from procedures.procedure_stages where id = ${id}`.execute(admin());
  return rows[0]?.version ?? 0;
}
interface PlaceRow {
  id: string;
  code: string;
  name: string;
  position: number;
  deleted: boolean;
  version: number;
}
async function processesOf(orderId: string): Promise<PlaceRow[]> {
  return (
    await sql<PlaceRow>`select id, code, name, position, deleted_at is not null as deleted, version
      from procedures.procedures where work_order_id = ${orderId} order by deleted_at is not null, position, created_at`.execute(admin())
  ).rows;
}
async function stagesOf(procedureId: string): Promise<PlaceRow[]> {
  return (
    await sql<PlaceRow>`select id, code, name, position, deleted_at is not null as deleted, version
      from procedures.procedure_stages where procedure_id = ${procedureId} order by deleted_at is not null, position, created_at`.execute(
      admin(),
    )
  ).rows;
}
const livePositions = (rows: PlaceRow[]) => rows.filter((row) => !row.deleted).map((row) => row.position);

const auditOf = async (objectId: string) =>
  (await sql<Record<string, unknown>>`select * from audit.events where object_id = ${objectId} order by occurred_at, id`.execute(admin()))
    .rows;
const auditTotal = async (): Promise<number> =>
  Number((await sql<{ n: string }>`select count(*)::text as n from audit.events`.execute(admin())).rows[0]?.n);
const idempotencyTotal = async (): Promise<number> =>
  Number((await sql<{ n: string }>`select count(*)::text as n from platform.idempotency_records`.execute(admin())).rows[0]?.n);
const journalOf = async (orderId: string) =>
  (
    await sql<{ event_code: string; event_payload: Record<string, unknown>; procedure_stage_id: string | null }>`
      select event_code, event_payload, procedure_stage_id from timeline.timeline_entries
      where work_order_id = ${orderId} and kind = 'event' order by created_at, id`.execute(admin())
  ).rows;

const FIRE = 'fire_safety_opinion';
const FIRE_NAME = 'Opinia ppoż';

describe('adding a process from a template (EVM-042 AC1; SR-API-05, SR-INPUT-02)', () => {
  it('EVM-042 AC1 AC2 the process of the template appears with its stages "todo" at the end of the list: 201, the ETag, the copy of the code and the name, no scope item', async () => {
    const editor = await signIn('editor');
    const created = await order([{}, {}]);
    const id = uuidv7();
    const response = await addProcedure(editor, created.id, { id, procedureTemplateCode: FIRE });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.headers['etag']).toBe('"1"');
    expect(response.headers['idempotent-replayed']).toBeUndefined();
    const body = procedureOf(response.body);
    expect(body).toMatchObject({ id, code: FIRE, name: FIRE_NAME, position: 3, version: 1, progress: { done: 0, total: 2 } });
    expect(body.stages.map((stage) => [stage.position, stage.status, stage.version])).toEqual([
      [1, 'todo', 1],
      [2, 'todo', 1],
    ]);
    const { rows } = await sql<{ source_procedure_template_id: string | null; source_scope_item_id: string | null; created_by: string }>`
      select source_procedure_template_id, source_scope_item_id, created_by from procedures.procedures where id = ${id}`.execute(admin());
    expect(rows[0]?.source_procedure_template_id).not.toBeNull();
    expect(rows[0]?.source_scope_item_id).toBeNull();
    expect(rows[0]?.created_by).toBe(editor.userId);
    const { rows: stages } = await sql<{ source_stage_template_id: string | null }>`
      select source_stage_template_id from procedures.procedure_stages where procedure_id = ${id}`.execute(admin());
    expect(stages.every((stage) => stage.source_stage_template_id !== null)).toBe(true);
  });

  it('EVM-042 AC1 the process lands on the chosen place, the others make room without a collision of the place, and the list reads the new order', async () => {
    const administrator = await signIn('administrator');
    const created = await order([{ code: 'first_one' }, { code: 'second_one' }, { code: 'third_one' }]);
    const response = await addProcedure(administrator, created.id, { id: uuidv7(), procedureTemplateCode: FIRE, position: 2 });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(procedureOf(response.body).position).toBe(2);
    expect((await processesOf(created.id)).map((row) => [row.position, row.code])).toEqual([
      [1, 'first_one'],
      [2, FIRE],
      [3, 'second_one'],
      [4, 'third_one'],
    ]);
    const atStart = await addProcedure(administrator, created.id, {
      id: uuidv7(),
      procedureTemplateCode: 'technical_assessment',
      position: 1,
    });
    expect(atStart.status).toBe(201);
    expect(listBody((await listOf(administrator, created.id)).body).map((item) => item.code)).toEqual([
      'technical_assessment',
      'first_one',
      FIRE,
      'second_one',
      'third_one',
    ]);
    expect(livePositions(await processesOf(created.id))).toEqual([1, 2, 3, 4, 5]);
  });

  it('EVM-042 AC1 a place past the end is cut to the end (a screen a moment behind the server gets no 400); a place outside 1..30 is 400', async () => {
    const editor = await signIn('editor');
    const created = await order([{}]);
    const far = await addProcedure(editor, created.id, { id: uuidv7(), procedureTemplateCode: FIRE, position: 30 });
    expect(far.status).toBe(201);
    expect(procedureOf(far.body).position).toBe(2);
    for (const position of [0, 31, 1.5, '2']) {
      const bad = await addProcedure(editor, created.id, { id: uuidv7(), procedureTemplateCode: 'technical_assessment', position });
      expect(bad.status, String(position)).toBe(400);
      expect(errorsOf(bad.body)?.[0]?.pointer).toBe('/position');
    }
  });

  it('EVM-042 AC1 a code that is already active in the order is 409 procedure_already_active — the answer has no name — and nothing is written', async () => {
    const editor = await signIn('editor');
    const created = await order([{ code: FIRE, name: FIRE_NAME }]);
    const auditBefore = await auditTotal();
    const response = await addProcedure(editor, created.id, { id: uuidv7(), procedureTemplateCode: FIRE });
    expect(response.status).toBe(409);
    expect(codeOf(response.body)).toBe('procedure_already_active');
    expect(JSON.stringify(response.body)).not.toContain('ppoż');
    expect(await processesOf(created.id)).toHaveLength(1);
    expect(await auditTotal()).toBe(auditBefore);
    expect(await idempotencyTotal()).toBe(0);
  });

  it('EVM-042 AC1 AC3 after the process is deleted its code is free again: it can be added once more (the deleted one stays in the table)', async () => {
    const editor = await signIn('editor');
    const created = await order([{}]);
    const first = procedureOf((await addProcedure(editor, created.id, { id: uuidv7(), procedureTemplateCode: FIRE })).body);
    expect((await removeProcedure(editor, created.id, first.id, { ifMatch: '"1"' })).status).toBe(204);
    const second = await addProcedure(editor, created.id, { id: uuidv7(), procedureTemplateCode: FIRE });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect((await processesOf(created.id)).filter((row) => row.code === FIRE).map((row) => row.deleted)).toEqual([false, true]);
  });

  it('EVM-042 AC1 AC4 two additions of the same code at once: exactly one 201 and one 409 (the lock of the order decides)', async () => {
    const editor = await signIn('editor');
    const created = await order([{}]);
    const results = await Promise.all(
      [uuidv7(), uuidv7()].map((id) => addProcedure(editor, created.id, { id, procedureTemplateCode: FIRE })),
    );
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect((await processesOf(created.id)).filter((row) => row.code === FIRE)).toHaveLength(1);
    expect(livePositions(await processesOf(created.id))).toEqual([1, 2]);
  });

  it('EVM-042 AC1 a retired template, one that does not exist and one that is deleted are the SAME answer 422 template_unavailable; a malformed code is 400', async () => {
    const editor = await signIn('editor');
    const created = await order([{}]);
    const answers = new Set<string>();
    try {
      await sql`update catalog.procedure_templates set is_active = false where code = ${FIRE}`.execute(admin());
      await sql`update catalog.procedure_templates set deleted_at = now() where code = 'technical_assessment'`.execute(admin());
      for (const code of [FIRE, 'technical_assessment', 'no_such_template']) {
        const response = await addProcedure(editor, created.id, { id: uuidv7(), procedureTemplateCode: code });
        expect(response.status, code).toBe(422);
        expect(codeOf(response.body)).toBe('template_unavailable');
        answers.add(withoutTrace(response.body));
      }
    } finally {
      await sql`update catalog.procedure_templates set is_active = true where code = ${FIRE}`.execute(admin());
      await sql`update catalog.procedure_templates set deleted_at = null where code = 'technical_assessment'`.execute(admin());
    }
    expect(answers.size).toBe(1);
    expect((await addProcedure(editor, created.id, { id: uuidv7(), procedureTemplateCode: 'Opinia ppoż' })).status).toBe(400);
    expect(await processesOf(created.id)).toHaveLength(1);
  });

  it('EVM-042 AC1 the identifier of the client: an existing id — also the process of ANOTHER order — is 409 id_conflict and nothing is overwritten; an id that is not a UUIDv7 is 400', async () => {
    const editor = await signIn('editor');
    const mine = await order([{}]);
    const other = await order([{ name: 'Cudzy proces' }]);
    const otherId = other.processes[0]?.id ?? '';
    const own = procedureOf((await addProcedure(editor, mine.id, { id: uuidv7(), procedureTemplateCode: FIRE })).body);
    for (const id of [own.id, otherId]) {
      const response = await addProcedure(editor, mine.id, { id, procedureTemplateCode: 'technical_assessment' });
      expect(response.status, id).toBe(409);
      expect(codeOf(response.body)).toBe('id_conflict');
    }
    expect((await processesOf(other.id))[0]?.name).toBe('Cudzy proces');
    expect(await processesOf(mine.id)).toHaveLength(2);
    const notV7 = await addProcedure(editor, mine.id, {
      id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      procedureTemplateCode: 'technical_assessment',
    });
    expect(notV7.status).toBe(400);
    expect(errorsOf(notV7.body)?.[0]?.pointer).toBe('/id');
  });

  it('EVM-042 AC1 the fields of the server are read_only_field, a stranger is unknown_field, and the order is not the one of the body', async () => {
    const editor = await signIn('editor');
    const created = await order([]);
    const response = await addProcedure(editor, created.id, {
      id: uuidv7(),
      procedureTemplateCode: FIRE,
      code: 'mine',
      name: 'Moje',
      stages: [],
      version: 7,
      workOrderId: uuidv7(),
      extra: 1,
    });
    expect(response.status).toBe(400);
    expect(errorsOf(response.body)).toEqual(
      expect.arrayContaining([
        { pointer: '/code', code: 'read_only_field' },
        { pointer: '/name', code: 'read_only_field' },
        { pointer: '/stages', code: 'read_only_field' },
        { pointer: '/version', code: 'read_only_field' },
        { pointer: '/workOrderId', code: 'read_only_field' },
        { pointer: '/extra', code: 'unknown_field' },
      ]),
    );
    expect(await processesOf(created.id)).toEqual([]);
  });

  it('EVM-042 AC1 a repeat of the addition (same key, order and body) is 201 with Idempotent-Replayed and writes nothing twice; the same key with another body or on another order is 422 idempotency_mismatch', async () => {
    const editor = await signIn('editor');
    const created = await order([{}]);
    const elsewhere = await order([{}]);
    const key = uuidv7();
    const body = { id: uuidv7(), procedureTemplateCode: FIRE };
    const first = await addProcedure(editor, created.id, body, { key });
    expect(first.status).toBe(201);
    const auditAfterFirst = await auditTotal();
    const repeat = await addProcedure(editor, created.id, body, { key });
    expect(repeat.status).toBe(201);
    expect(repeat.headers['idempotent-replayed']).toBe('true');
    expect(repeat.body).toEqual(first.body);
    expect(await auditTotal()).toBe(auditAfterFirst);
    expect(await processesOf(created.id)).toHaveLength(2);
    const other = await addProcedure(editor, created.id, { ...body, procedureTemplateCode: 'technical_assessment' }, { key });
    expect(other.status).toBe(422);
    expect(codeOf(other.body)).toBe('idempotency_mismatch');
    const wrongOrder = await addProcedure(editor, elsewhere.id, body, { key });
    expect(wrongOrder.status).toBe(422);
    expect(codeOf(wrongOrder.body)).toBe('idempotency_mismatch');
    expect(await processesOf(elsewhere.id)).toHaveLength(1);
  });

  it('EVM-042 AC1 AC3 a repeat of an addition whose process was deleted since is 404 — an idempotent repeat never returns what the policy of the moment hides', async () => {
    const editor = await signIn('editor');
    const created = await order([]);
    const key = uuidv7();
    const body = { id: uuidv7(), procedureTemplateCode: FIRE };
    expect((await addProcedure(editor, created.id, body, { key })).status).toBe(201);
    expect((await removeProcedure(editor, created.id, body.id, { ifMatch: '"1"' })).status).toBe(204);
    const repeat = await addProcedure(editor, created.id, body, { key });
    expect(repeat.status).toBe(404);
    expect(codeOf(repeat.body)).toBe('not_found');
  });
});

describe('adding a stage (EVM-042 AC2; SR-INPUT-01, SR-INPUT-05)', () => {
  it('EVM-042 AC2 the stage has the status "todo", the code made by the SERVER, goes to the end and enters the progress; the version of the process rises', async () => {
    const editor = await signIn('editor');
    const created = await order([{ stages: [{}, {}] }]);
    const procedureId = created.processes[0]?.id ?? '';
    const id = uuidv7();
    const response = await addStage(editor, created.id, procedureId, { id, name: 'Uzgodnienie terminu wyłączenia zasilania' });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.headers['etag']).toBe('"1"');
    expect(stageOf(response.body)).toMatchObject({
      id,
      name: 'Uzgodnienie terminu wyłączenia zasilania',
      position: 3,
      status: 'todo',
      dueDate: null,
      responsibleUser: null,
      version: 1,
    });
    expect(stageOf(response.body).code).toMatch(/^custom_[0-9a-f]{12}$/);
    const list = listBody((await listOf(editor, created.id)).body)[0];
    expect(list?.progress).toEqual({ done: 0, total: 3 });
    expect(list?.stages.map((stage) => stage.id)).toContain(id);
    expect(list?.version).toBe(2);
    const { rows } = await sql<{ created_by: string; source_stage_template_id: string | null }>`
      select created_by, source_stage_template_id from procedures.procedure_stages where id = ${id}`.execute(admin());
    expect(rows[0]).toEqual({ created_by: editor.userId, source_stage_template_id: null });
  });

  it('EVM-042 AC2 the day, the person and the place are kept: the stage is put in the middle and the others make room', async () => {
    const editor = await signIn('editor');
    const created = await order([{ stages: [{ name: 'Pierwszy' }, { name: 'Drugi' }, { name: 'Trzeci' }] }]);
    const procedureId = created.processes[0]?.id ?? '';
    const response = await addStage(editor, created.id, procedureId, {
      id: uuidv7(),
      name: 'Wstawiony',
      position: 2,
      dueDate: '2026-10-30',
      responsibleUserId: editor.userId,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(stageOf(response.body)).toMatchObject({ position: 2, dueDate: '2026-10-30', responsibleUser: { id: editor.userId } });
    expect((await stagesOf(procedureId)).map((row) => [row.position, row.name])).toEqual([
      [1, 'Pierwszy'],
      [2, 'Wstawiony'],
      [3, 'Drugi'],
      [4, 'Trzeci'],
    ]);
  });

  it('EVM-042 AC2 a stage added to a process that shows 29 stages can be put anywhere up to 30 and a place past the end is cut to the end', async () => {
    const editor = await signIn('editor');
    const created = await order([{ stages: Array.from({ length: 29 }, () => ({})) }]);
    const procedureId = created.processes[0]?.id ?? '';
    const response = await addStage(editor, created.id, procedureId, { id: uuidv7(), name: 'Trzydziesty', position: 30 });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(stageOf(response.body).position).toBe(30);
    expect(livePositions(await stagesOf(procedureId))).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
  });

  it('EVM-042 AC2 the name is plain text: trimmed, NFC once; an empty name, a control character and 121 characters are 400 with a pointer and a code — never the value', async () => {
    const editor = await signIn('editor');
    const created = await order([{ stages: [{}] }]);
    const procedureId = created.processes[0]?.id ?? '';
    const decomposed = 'Łączność ze zarządcą'.normalize('NFD');
    const ok = await addStage(editor, created.id, procedureId, { id: uuidv7(), name: `  ${decomposed}  ` });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(stageOf(ok.body).name).toBe('Łączność ze zarządcą'.normalize('NFC'));
    const cases: Array<[string, string, string]> = [
      ['   ', '/name', 'required'],
      ['', '/name', 'too_short'],
      ['Etap-znacznik-xyz\u0000', '/name', 'invalid_characters'],
      ['Etap-znacznik-xyz\nnowa linia', '/name', 'invalid_characters'],
      ['Etap-znacznik-xyz‮odwrocony', '/name', 'invalid_characters'],
      [`znacznik-xyz${'a'.repeat(110)}`, '/name', 'too_long'],
    ];
    for (const [name, pointer, code] of cases) {
      const response = await addStage(editor, created.id, procedureId, { id: uuidv7(), name });
      expect(response.status, code).toBe(400);
      expect(errorsOf(response.body), code).toEqual([{ pointer, code }]);
      expect(JSON.stringify(response.body)).not.toContain('znacznik-xyz');
    }
    expect(await stagesOf(procedureId)).toHaveLength(2);
  });

  it('EVM-042 AC2 the day is a business day of 2000-01-01..2100-12-31 (a day outside is 400 out_of_range, never a 500 of the CHECK); a day that does not exist is 400', async () => {
    const editor = await signIn('editor');
    const created = await order([{ stages: [{}] }]);
    const procedureId = created.processes[0]?.id ?? '';
    for (const dueDate of ['1999-12-31', '2101-01-01']) {
      const response = await addStage(editor, created.id, procedureId, { id: uuidv7(), name: 'Etap', dueDate });
      expect(response.status, dueDate).toBe(400);
      expect(errorsOf(response.body)).toEqual([{ pointer: '/dueDate', code: 'out_of_range' }]);
    }
    expect((await addStage(editor, created.id, procedureId, { id: uuidv7(), name: 'Etap', dueDate: '2026-02-30' })).status).toBe(400);
    expect((await addStage(editor, created.id, procedureId, { id: uuidv7(), name: 'Etap', dueDate: '2000-01-01' })).status).toBe(201);
    expect((await addStage(editor, created.id, procedureId, { id: uuidv7(), name: 'Etap', dueDate: '2100-12-31' })).status).toBe(201);
  });

  it('EVM-042 AC2 a person who does not exist, one only invited, a deactivated one and a deleted one are the SAME answer — 400 assignee_unavailable', async () => {
    const editor = await signIn('editor');
    const created = await order([{ stages: [{}] }]);
    const procedureId = created.processes[0]?.id ?? '';
    const invited = await createUser(admin(), current.clock, { status: 'invited' });
    const deactivated = await createUser(admin(), current.clock, { status: 'deactivated' });
    const deleted = await createUser(admin(), current.clock, { status: 'active' });
    await sql`update identity.users set deleted_at = ${current.clock.now()} where id = ${deleted.id}`.execute(admin());
    const answers = new Set<string>();
    for (const userId of [uuidv7(), invited.id, deactivated.id, deleted.id]) {
      const response = await addStage(editor, created.id, procedureId, { id: uuidv7(), name: 'Etap', responsibleUserId: userId });
      expect(response.status, userId).toBe(400);
      expect(errorsOf(response.body)).toEqual([{ pointer: '/responsibleUserId', code: 'assignee_unavailable' }]);
      expect(JSON.stringify(response.body)).not.toContain(userId);
      answers.add(withoutTrace(response.body));
    }
    expect(answers.size).toBe(1);
    expect(await stagesOf(procedureId)).toHaveLength(1);
  });

  it('EVM-042 AC2 the code, the status and the version are the fields of the server: read_only_field; the process of another order named in the body is unknown_field', async () => {
    const editor = await signIn('editor');
    const created = await order([{ stages: [{}] }]);
    const procedureId = created.processes[0]?.id ?? '';
    const response = await addStage(editor, created.id, procedureId, {
      id: uuidv7(),
      name: 'Etap',
      code: 'custom_aaaaaaaaaaaa',
      status: 'done',
      version: 4,
      procedureId: uuidv7(),
      stray: true,
    });
    expect(response.status).toBe(400);
    expect(errorsOf(response.body)).toEqual(
      expect.arrayContaining([
        { pointer: '/code', code: 'read_only_field' },
        { pointer: '/status', code: 'read_only_field' },
        { pointer: '/version', code: 'read_only_field' },
        { pointer: '/procedureId', code: 'read_only_field' },
        { pointer: '/stray', code: 'unknown_field' },
      ]),
    );
    expect(await stagesOf(procedureId)).toHaveLength(1);
  });

  it('EVM-042 AC2 an existing id — also the stage of ANOTHER order — is 409 id_conflict and nothing is overwritten', async () => {
    const editor = await signIn('editor');
    const mine = await order([{ stages: [{}] }]);
    const other = await order([{ stages: [{ name: 'Cudzy etap' }] }]);
    const otherStage = other.processes[0]?.stageIds[0] ?? '';
    const response = await addStage(editor, mine.id, mine.processes[0]?.id ?? '', { id: otherStage, name: 'Przejęty' });
    expect(response.status).toBe(409);
    expect(codeOf(response.body)).toBe('id_conflict');
    expect((await stagesOf(other.processes[0]?.id ?? ''))[0]?.name).toBe('Cudzy etap');
    expect(await stagesOf(mine.processes[0]?.id ?? '')).toHaveLength(1);
  });

  it('EVM-042 AC2 a repeat of the addition (same key, process and body) is 201 with Idempotent-Replayed and writes nothing twice; the same key for another process is 422 idempotency_mismatch', async () => {
    const editor = await signIn('editor');
    const created = await order([{ stages: [{}] }, { stages: [{}] }]);
    const [first, second] = created.processes;
    const key = uuidv7();
    const body = { id: uuidv7(), name: 'Etap z kluczem' };
    const original = await addStage(editor, created.id, first?.id ?? '', body, { key });
    expect(original.status).toBe(201);
    const auditAfterFirst = await auditTotal();
    const repeat = await addStage(editor, created.id, first?.id ?? '', body, { key });
    expect(repeat.status).toBe(201);
    expect(repeat.headers['idempotent-replayed']).toBe('true');
    expect(repeat.body).toEqual(original.body);
    expect(await auditTotal()).toBe(auditAfterFirst);
    expect(await stagesOf(first?.id ?? '')).toHaveLength(2);
    const elsewhere = await addStage(editor, created.id, second?.id ?? '', body, { key });
    expect(elsewhere.status).toBe(422);
    expect(codeOf(elsewhere.body)).toBe('idempotency_mismatch');
    expect(await stagesOf(second?.id ?? '')).toHaveLength(1);
  });
});

describe('deleting and restoring (EVM-042 AC3, AC7; SR-API-07)', () => {
  it('EVM-042 AC3 a deleted stage disappears for the Administrator, the Editor and Tylko odczyt, the others are numbered 1..n again, the version of the process rises', async () => {
    const editor = await signIn('editor');
    const reader = await signIn('read_only');
    const administrator = await signIn('administrator');
    const created = await order([{ stages: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }]);
    const process = created.processes[0];
    const response = await removeStage(editor, created.id, process?.stageIds[1] ?? '', { ifMatch: '"1"' });
    expect(response.status, JSON.stringify(response.body)).toBe(204);
    expect(response.text).toBe('');
    for (const browser of [administrator, editor, reader]) {
      const item = listBody((await listOf(browser, created.id)).body)[0];
      expect(item?.stages.map((stage) => [stage.position, stage.name])).toEqual([
        [1, 'A'],
        [2, 'C'],
      ]);
      expect(item?.progress).toEqual({ done: 0, total: 2 });
      expect(item?.version).toBe(2);
    }
    expect((await stagesOf(process?.id ?? '')).map((row) => [row.name, row.deleted, row.position])).toEqual([
      ['A', false, 1],
      ['C', false, 2],
      ['B', true, 2],
    ]);
    const { rows } = await sql<{ deleted_by: string | null }>`select deleted_by from procedures.procedure_stages where name = 'B'`.execute(
      admin(),
    );
    expect(rows[0]?.deleted_by).toBe(editor.userId);
  });

  it('EVM-042 AC3 a deleted process disappears with its stages for every role; its stages stay in the table untouched; the others are numbered 1..n again', async () => {
    const editor = await signIn('editor');
    const reader = await signIn('read_only');
    const created = await order([{ code: 'first_one' }, { code: 'middle_one', stages: [{}, {}] }, { code: 'last_one' }]);
    const middle = created.processes[1];
    const response = await removeProcedure(editor, created.id, middle?.id ?? '', { ifMatch: '"1"' });
    expect(response.status).toBe(204);
    for (const browser of [editor, reader]) {
      const items = listBody((await listOf(browser, created.id)).body);
      expect(items.map((item) => [item.position, item.code])).toEqual([
        [1, 'first_one'],
        [2, 'last_one'],
      ]);
    }
    expect((await stagesOf(middle?.id ?? '')).every((row) => !row.deleted)).toBe(true);
    expect(livePositions(await processesOf(created.id))).toEqual([1, 2]);
  });

  it('EVM-042 AC3 the Administrator reads the deleted ones: a process with the number of its stages, a stage with the name of its process; nothing about people, days, notes or reasons', async () => {
    const administrator = await signIn('administrator');
    const editor = await signIn('editor');
    const created = await order([
      { code: FIRE, name: FIRE_NAME, stages: [{ responsibleUserId: editor.userId, dueDate: '2026-11-01' }, {}] },
      { code: 'other_one', name: 'Inny proces', stages: [{ name: 'Etap do usunięcia', blockedReason: 'powod-xyz', status: 'blocked' }] },
    ]);
    await removeProcedure(editor, created.id, created.processes[0]?.id ?? '', { ifMatch: '"1"' });
    await removeStage(editor, created.id, created.processes[1]?.stageIds[0] ?? '', { ifMatch: '"1"' });
    const response = await deletedOf(administrator, created.id);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    const body = response.body as {
      procedures: Array<Record<string, unknown>>;
      stages: Array<Record<string, unknown>>;
      truncated: boolean;
    };
    expect(body.truncated).toBe(false);
    expect(body.procedures).toEqual([
      {
        id: created.processes[0]?.id,
        code: FIRE,
        name: FIRE_NAME,
        position: 1,
        stageCount: 2,
        version: 2,
        deletedAt: TODAY_INSTANT,
      },
    ]);
    expect(body.stages).toEqual([
      {
        id: created.processes[1]?.stageIds[0],
        procedureId: created.processes[1]?.id,
        procedureName: 'Inny proces',
        name: 'Etap do usunięcia',
        position: 1,
        procedureDeleted: false,
        version: 2,
        deletedAt: TODAY_INSTANT,
      },
    ]);
    expect(JSON.stringify(response.body)).not.toMatch(/powod-xyz|2026-11-01|responsible|blocked|notes/i);
  });

  it('EVM-042 AC3 the Editor and Tylko odczyt do not read the deleted ones (403 forbidden), also for an order that does not exist; the Administrator gets 404 for an order that does not', async () => {
    const editor = await signIn('editor');
    const reader = await signIn('read_only');
    const administrator = await signIn('administrator');
    const created = await order([{}]);
    for (const browser of [editor, reader]) {
      for (const target of [created.id, uuidv7()]) {
        const response = await deletedOf(browser, target);
        expect(response.status).toBe(403);
        expect(codeOf(response.body)).toBe('forbidden');
      }
    }
    const missing = await deletedOf(administrator, uuidv7());
    expect(missing.status).toBe(404);
    expect(codeOf(missing.body)).toBe('not_found');
  });

  it('EVM-042 AC3 the Administrator restores a stage to its place, with its status and its data as they were; the progress and the version of the process follow', async () => {
    const administrator = await signIn('administrator');
    const created = await order([{ stages: [{ name: 'A' }, { name: 'B', status: 'done', completedOn: '2026-10-01' }, { name: 'C' }] }]);
    const process = created.processes[0];
    const stageId = process?.stageIds[1] ?? '';
    expect((await removeStage(administrator, created.id, stageId, { ifMatch: '"1"' })).status).toBe(204);
    expect(listBody((await listOf(administrator, created.id)).body)[0]?.progress).toEqual({ done: 0, total: 2 });
    const response = await restoreStage(administrator, created.id, stageId, { ifMatch: '"2"' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['etag']).toBe('"3"');
    expect(stageOf(response.body)).toMatchObject({ id: stageId, name: 'B', position: 2, status: 'done', version: 3 });
    const item = listBody((await listOf(administrator, created.id)).body)[0];
    expect(item?.stages.map((stage) => [stage.position, stage.name])).toEqual([
      [1, 'A'],
      [2, 'B'],
      [3, 'C'],
    ]);
    expect(item?.progress).toEqual({ done: 1, total: 3 });
    expect(item?.version).toBe(3);
    expect((await deletedOf(administrator, created.id)).body).toMatchObject({ procedures: [], stages: [] });
  });

  it('EVM-042 AC3 a stage returns to the end when the process has fewer stages than its remembered place, and the others make room when it returns to the front', async () => {
    const administrator = await signIn('administrator');
    const created = await order([{ stages: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }]);
    const process = created.processes[0];
    // C (place 3) is deleted, then B (place 2), then A (place 1): the process is empty; C returns first, to place 1
    for (const index of [2, 1, 0]) {
      expect((await removeStage(administrator, created.id, process?.stageIds[index] ?? '', { ifMatch: '"1"' })).status).toBe(204);
    }
    const first = await restoreStage(administrator, created.id, process?.stageIds[2] ?? '', { ifMatch: '"2"' });
    expect(stageOf(first.body).position).toBe(1);
    const second = await restoreStage(administrator, created.id, process?.stageIds[0] ?? '', { ifMatch: '"2"' });
    expect(stageOf(second.body).position).toBe(1);
    expect((await stagesOf(process?.id ?? '')).filter((row) => !row.deleted).map((row) => [row.position, row.name])).toEqual([
      [1, 'A'],
      [2, 'C'],
    ]);
  });

  it('EVM-042 AC3 the Administrator restores a process with all its stages as they were, on its place; the others make room', async () => {
    const administrator = await signIn('administrator');
    const created = await order([
      { code: 'first_one' },
      { code: 'middle_one', stages: [{ status: 'done', completedOn: '2026-10-01' }, { status: 'in_progress' }] },
      { code: 'last_one' },
    ]);
    const middle = created.processes[1];
    expect((await removeProcedure(administrator, created.id, middle?.id ?? '', { ifMatch: '"1"' })).status).toBe(204);
    const response = await restoreProcedure(administrator, created.id, middle?.id ?? '', { ifMatch: '"2"' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['etag']).toBe('"3"');
    const body = procedureOf(response.body);
    expect(body).toMatchObject({ id: middle?.id, code: 'middle_one', position: 2, version: 3, progress: { done: 1, total: 2 } });
    expect(body.stages.map((stage) => stage.status)).toEqual(['done', 'in_progress']);
    expect(listBody((await listOf(administrator, created.id)).body).map((item) => [item.position, item.code])).toEqual([
      [1, 'first_one'],
      [2, 'middle_one'],
      [3, 'last_one'],
    ]);
  });

  it('EVM-042 AC3 AC6 the Editor does not restore: 403 forbidden for a process and for a stage, and nothing changes', async () => {
    const editor = await signIn('editor');
    const administrator = await signIn('administrator');
    const created = await order([{ stages: [{}, {}] }, {}]);
    const [first, second] = created.processes;
    await removeStage(administrator, created.id, first?.stageIds[0] ?? '', { ifMatch: '"1"' });
    await removeProcedure(administrator, created.id, second?.id ?? '', { ifMatch: '"1"' });
    const auditBefore = await auditTotal();
    const stage = await restoreStage(editor, created.id, first?.stageIds[0] ?? '', { ifMatch: '"2"' });
    const process = await restoreProcedure(editor, created.id, second?.id ?? '', { ifMatch: '"2"' });
    for (const response of [stage, process]) {
      expect(response.status).toBe(403);
      expect(codeOf(response.body)).toBe('forbidden');
    }
    expect(await auditTotal()).toBe(auditBefore);
    expect((await stagesOf(first?.id ?? '')).filter((row) => row.deleted)).toHaveLength(1);
    expect((await processesOf(created.id)).filter((row) => row.deleted)).toHaveLength(1);
  });

  it('EVM-042 AC3 restoring a process whose code is active again is 409 procedure_already_active (no name); the stage of a deleted process is 409 parent_deleted', async () => {
    const administrator = await signIn('administrator');
    const created = await order([{ code: FIRE, name: FIRE_NAME, stages: [{}, {}] }]);
    const process = created.processes[0];
    // the second stage is deleted FIRST, then the whole process
    expect((await removeStage(administrator, created.id, process?.stageIds[1] ?? '', { ifMatch: '"1"' })).status).toBe(204);
    expect((await removeProcedure(administrator, created.id, process?.id ?? '', { ifMatch: '"2"' })).status).toBe(204);
    const parent = await restoreStage(administrator, created.id, process?.stageIds[1] ?? '', { ifMatch: '"2"' });
    expect(parent.status).toBe(409);
    expect(codeOf(parent.body)).toBe('parent_deleted');
    expect((await deletedOf(administrator, created.id)).body).toMatchObject({
      stages: [{ id: process?.stageIds[1], procedureDeleted: true }],
    });
    expect((await addProcedure(administrator, created.id, { id: uuidv7(), procedureTemplateCode: FIRE })).status).toBe(201);
    const clash = await restoreProcedure(administrator, created.id, process?.id ?? '', { ifMatch: '"3"' });
    expect(clash.status).toBe(409);
    expect(codeOf(clash.body)).toBe('procedure_already_active');
    expect(JSON.stringify(clash.body)).not.toContain('ppoż');
    expect((await processesOf(created.id)).filter((row) => row.deleted)).toHaveLength(1);
  });

  it('EVM-042 AC3 an object that is not deleted cannot be restored and one that is deleted cannot be deleted again — the same 404 as an object that does not exist', async () => {
    const administrator = await signIn('administrator');
    const created = await order([{ stages: [{}] }]);
    const process = created.processes[0];
    const stageId = process?.stageIds[0] ?? '';
    const answers = new Set<string>();
    for (const response of [
      await restoreStage(administrator, created.id, stageId),
      await restoreProcedure(administrator, created.id, process?.id ?? ''),
      await restoreStage(administrator, created.id, uuidv7()),
      await restoreProcedure(administrator, created.id, uuidv7()),
    ]) {
      expect(response.status).toBe(404);
      answers.add(withoutTrace(response.body));
    }
    expect(answers.size).toBe(1);
    expect((await removeStage(administrator, created.id, stageId, { ifMatch: '"1"' })).status).toBe(204);
    expect((await removeStage(administrator, created.id, stageId, { ifMatch: '"2"' })).status).toBe(404);
    expect((await removeProcedure(administrator, created.id, process?.id ?? '', { ifMatch: '"2"' })).status).toBe(204);
    expect((await removeProcedure(administrator, created.id, process?.id ?? '', { ifMatch: '"3"' })).status).toBe(404);
    // a stage of a deleted process is as gone as the process
    expect((await removeStage(administrator, created.id, stageId, { ifMatch: '"2"' })).status).toBe(404);
  });

  it('EVM-042 AC7 If-Match: missing is 428, malformed (weak, list, *) is 400, stale is 412 without a current value — and the data is unchanged', async () => {
    const administrator = await signIn('administrator');
    const created = await order([{ stages: [{}, {}] }, {}]);
    const [first, second] = created.processes;
    const gone = first?.stageIds[0] ?? '';
    const live = first?.stageIds[1] ?? '';
    // the first stage is deleted (stage at version 2, its process at 2), the second process is deleted (at version 2)
    await removeStage(administrator, created.id, gone, { ifMatch: '"1"' });
    await removeProcedure(administrator, created.id, second?.id ?? '', { ifMatch: '"1"' });
    const auditBefore = await auditTotal();
    const targets: Array<[string, (options: Options) => Promise<{ status: number; body: unknown }>]> = [
      ['delete stage', (options) => removeStage(administrator, created.id, live, options)],
      ['delete process', (options) => removeProcedure(administrator, created.id, first?.id ?? '', options)],
      ['restore stage', (options) => restoreStage(administrator, created.id, gone, options)],
      ['restore process', (options) => restoreProcedure(administrator, created.id, second?.id ?? '', options)],
    ];
    for (const [label, call] of targets) {
      const missing = await call({ ifMatch: null });
      expect(missing.status, label).toBe(428);
      expect(codeOf(missing.body), label).toBe('precondition_required');
      for (const bad of ['W/"2"', '*', '"2", "3"', 'abc']) {
        const malformed = await call({ ifMatch: bad });
        expect(malformed.status, `${label} ${bad}`).toBe(400);
      }
      const stale = await call({ ifMatch: '"9"' });
      expect(stale.status, label).toBe(412);
      expect(codeOf(stale.body), label).toBe('version_conflict');
      // the answer does not tell the current version, nor the one that was sent
      expect(JSON.stringify(stale.body), label).not.toMatch(/"9"|"2"|version":/);
    }
    expect(await auditTotal()).toBe(auditBefore);
    expect(await versionOf('procedure_stages', gone)).toBe(2);
    expect(await versionOf('procedure_stages', live)).toBe(1);
    expect(await versionOf('procedures', first?.id ?? '')).toBe(2);
    expect(await versionOf('procedures', second?.id ?? '')).toBe(2);
    expect(await idempotencyTotal()).toBe(0);
  });

  it('EVM-042 AC7 a stale tag on a live process or stage is 412 and changes nothing: a stage added in the meantime makes the tag of the process stale', async () => {
    const editor = await signIn('editor');
    const created = await order([{ stages: [{}] }]);
    const process = created.processes[0];
    expect((await addStage(editor, created.id, process?.id ?? '', { id: uuidv7(), name: 'Dodany w międzyczasie' })).status).toBe(201);
    const staleProcess = await removeProcedure(editor, created.id, process?.id ?? '', { ifMatch: '"1"' });
    expect(staleProcess.status).toBe(412);
    expect(codeOf(staleProcess.body)).toBe('version_conflict');
    const staleStage = await removeStage(editor, created.id, process?.stageIds[0] ?? '', { ifMatch: '"5"' });
    expect(staleStage.status).toBe(412);
    expect(await versionOf('procedures', process?.id ?? '')).toBe(2);
    expect((await processesOf(created.id)).every((row) => !row.deleted)).toBe(true);
    expect((await stagesOf(process?.id ?? '')).every((row) => !row.deleted)).toBe(true);
  });

  it('EVM-042 AC3 a repeat of a deletion or a restoration with the same key (a retry after a lost answer) is the same answer with Idempotent-Replayed, not a 404; the same key for another object is 422', async () => {
    const administrator = await signIn('administrator');
    const created = await order([{ stages: [{}] }, {}]);
    const [first, second] = created.processes;
    const key = uuidv7();
    const deleted = await removeStage(administrator, created.id, first?.stageIds[0] ?? '', { ifMatch: '"1"', key });
    expect(deleted.status).toBe(204);
    expect(deleted.headers['idempotent-replayed']).toBeUndefined();
    const auditAfter = await auditTotal();
    const repeat = await removeStage(administrator, created.id, first?.stageIds[0] ?? '', { ifMatch: '"1"', key });
    expect(repeat.status).toBe(204);
    expect(repeat.headers['idempotent-replayed']).toBe('true');
    expect(await auditTotal()).toBe(auditAfter);
    const elsewhere = await removeProcedure(administrator, created.id, second?.id ?? '', { ifMatch: '"1"', key });
    expect(elsewhere.status).toBe(422);
    expect(codeOf(elsewhere.body)).toBe('idempotency_mismatch');

    const restoreKey = uuidv7();
    const restored = await restoreStage(administrator, created.id, first?.stageIds[0] ?? '', { ifMatch: '"2"', key: restoreKey });
    expect(restored.status).toBe(200);
    const restoredAgain = await restoreStage(administrator, created.id, first?.stageIds[0] ?? '', { ifMatch: '"2"', key: restoreKey });
    expect(restoredAgain.status).toBe(200);
    expect(restoredAgain.headers['idempotent-replayed']).toBe('true');
    expect(restoredAgain.body).toEqual(restored.body);

    const processKey = uuidv7();
    await removeProcedure(administrator, created.id, second?.id ?? '', { ifMatch: '"1"', key: processKey });
    const processRestored = await restoreProcedure(administrator, created.id, second?.id ?? '', { ifMatch: '"2"', key: processKey });
    // the key belongs to the deletion of the process (another route): 422, never the restoration
    expect(processRestored.status).toBe(422);
    const freshKey = uuidv7();
    const back = await restoreProcedure(administrator, created.id, second?.id ?? '', { ifMatch: '"2"', key: freshKey });
    expect(back.status).toBe(200);
    const backAgain = await restoreProcedure(administrator, created.id, second?.id ?? '', { ifMatch: '"2"', key: freshKey });
    expect(backAgain.headers['idempotent-replayed']).toBe('true');
    const deletedProcessKey = uuidv7();
    expect((await removeProcedure(administrator, created.id, second?.id ?? '', { ifMatch: '"3"', key: deletedProcessKey })).status).toBe(
      204,
    );
    const deletedAgain = await removeProcedure(administrator, created.id, second?.id ?? '', { ifMatch: '"3"', key: deletedProcessKey });
    expect(deletedAgain.status).toBe(204);
    expect(deletedAgain.headers['idempotent-replayed']).toBe('true');
  });

  it('EVM-042 AC3 AC5 the journal does not forget a deleted stage: its entries still name it for the Administrator, the Editor and Tylko odczyt', async () => {
    const editor = await signIn('editor');
    const reader = await signIn('read_only');
    const administrator = await signIn('administrator');
    const created = await order([{ stages: [{ name: 'Etap w dzienniku' }] }]);
    const stageId = created.processes[0]?.stageIds[0] ?? '';
    const entry = await editor.panel.post(
      `${BASE}/${created.id}/timeline`,
      { id: uuidv7(), kind: 'note', noteCategory: 'phone_call', body: 'Notatka do etapu', procedureStageId: stageId },
      {
        'Idempotency-Key': uuidv7(),
      },
    );
    expect(entry.status, JSON.stringify(entry.body)).toBe(201);
    expect((await removeStage(editor, created.id, stageId, { ifMatch: '"1"' })).status).toBe(204);
    for (const browser of [administrator, editor, reader]) {
      const list = await browser.panel.get(`${BASE}/${created.id}/timeline`);
      const items = (list.body as { items: Array<{ procedureStageName: string | null; event: { code: string } | null }> }).items;
      expect(items.find((item) => item.event === null)?.procedureStageName).toBe('Etap w dzienniku');
      expect(items.find((item) => item.event?.code === 'stage_removed')?.procedureStageName).toBe('Etap w dzienniku');
    }
  });

  it('EVM-042 AC3 a journal entry cannot be written for a stage of a process that is being deleted: after the deletion the stage is no stage of the order', async () => {
    const editor = await signIn('editor');
    const created = await order([{ stages: [{}] }]);
    const process = created.processes[0];
    expect((await removeProcedure(editor, created.id, process?.id ?? '', { ifMatch: '"1"' })).status).toBe(204);
    const entry = await editor.panel.post(
      `${BASE}/${created.id}/timeline`,
      { id: uuidv7(), kind: 'note', noteCategory: 'phone_call', body: 'Notatka', procedureStageId: process?.stageIds[0] },
      { 'Idempotency-Key': uuidv7() },
    );
    expect(entry.status).toBe(400);
    expect(errorsOf(entry.body)).toEqual([{ pointer: '/procedureStageId', code: 'unknown_stage' }]);
  });
});

describe('the limits and the closed order (EVM-042 AC4; SR-API-02, PO-8)', () => {
  it('EVM-042 AC4 the 31st stage is 422 limit_exceeded (a pointer and a code), the 30th is 201; nothing is written by the refused one', async () => {
    const editor = await signIn('editor');
    const created = await order([{ stages: Array.from({ length: 29 }, () => ({})) }]);
    const procedureId = created.processes[0]?.id ?? '';
    const last = await addStage(editor, created.id, procedureId, { id: uuidv7(), name: 'Trzydziesty' });
    expect(last.status).toBe(201);
    const auditBefore = await auditTotal();
    const over = await addStage(editor, created.id, procedureId, { id: uuidv7(), name: 'Trzydziesty pierwszy' });
    expect(over.status).toBe(422);
    expect(codeOf(over.body)).toBe('limit_exceeded');
    expect(errorsOf(over.body)).toEqual([{ pointer: '', code: 'too_many_stages' }]);
    expect(await stagesOf(procedureId)).toHaveLength(30);
    expect(await auditTotal()).toBe(auditBefore);
  });

  it('EVM-042 AC4 the 31st process is 422 limit_exceeded (too_many_procedures), the 30th is 201', async () => {
    const editor = await signIn('editor');
    const created = await order(Array.from({ length: 29 }, () => ({ stages: [] })));
    expect((await addProcedure(editor, created.id, { id: uuidv7(), procedureTemplateCode: FIRE })).status).toBe(201);
    const over = await addProcedure(editor, created.id, { id: uuidv7(), procedureTemplateCode: 'technical_assessment' });
    expect(over.status).toBe(422);
    expect(errorsOf(over.body)).toEqual([{ pointer: '', code: 'too_many_procedures' }]);
    expect(await processesOf(created.id)).toHaveLength(30);
  });

  it('EVM-042 AC4 a template with 31 stages is not copied (422 too_many_stages) — nothing is cut off', async () => {
    const editor = await signIn('editor');
    const created = await order([]);
    const at = new Date(TODAY_INSTANT);
    const { rows } = await sql<{ id: string }>`
      insert into catalog.procedure_templates (code, name, is_active, position, created_at, updated_at)
      values ('test_big_process', 'Duży proces', true, 97, ${at}, ${at}) returning id`.execute(admin());
    const templateId = rows[0]?.id ?? '';
    try {
      for (let index = 1; index <= 31; index += 1) {
        await sql`insert into catalog.procedure_stage_templates (procedure_template_id, code, name, position, created_at, updated_at)
          values (${templateId}, ${`big_${index}`}, ${`Etap ${index}`}, ${index}, ${at}, ${at})`.execute(admin());
      }
      const response = await addProcedure(editor, created.id, { id: uuidv7(), procedureTemplateCode: 'test_big_process' });
      expect(response.status).toBe(422);
      expect(errorsOf(response.body)).toEqual([{ pointer: '', code: 'too_many_stages' }]);
      expect(await processesOf(created.id)).toEqual([]);
    } finally {
      await sql`delete from catalog.procedure_stage_templates where procedure_template_id = ${templateId}`.execute(admin());
      await sql`delete from catalog.procedure_templates where id = ${templateId}`.execute(admin());
    }
  });

  it('EVM-042 AC4 the restoration is under the same limits: a stage does not come back to a process with 30 stages, a process does not come back to an order with 30 processes', async () => {
    const administrator = await signIn('administrator');
    const created = await order(
      Array.from({ length: 30 }, (_, index) => ({ stages: index === 0 ? Array.from({ length: 30 }, () => ({})) : [] })),
    );
    const [crowded, other] = created.processes;
    const stageId = crowded?.stageIds[0] ?? '';
    expect((await removeStage(administrator, created.id, stageId, { ifMatch: '"1"' })).status).toBe(204);
    expect((await addStage(administrator, created.id, crowded?.id ?? '', { id: uuidv7(), name: 'Na miejsce usuniętego' })).status).toBe(
      201,
    );
    const stage = await restoreStage(administrator, created.id, stageId, { ifMatch: '"2"' });
    expect(stage.status).toBe(422);
    expect(errorsOf(stage.body)).toEqual([{ pointer: '', code: 'too_many_stages' }]);

    expect((await removeProcedure(administrator, created.id, other?.id ?? '', { ifMatch: '"1"' })).status).toBe(204);
    expect((await addProcedure(administrator, created.id, { id: uuidv7(), procedureTemplateCode: FIRE })).status).toBe(201);
    const process = await restoreProcedure(administrator, created.id, other?.id ?? '', { ifMatch: '"2"' });
    expect(process.status).toBe(422);
    expect(errorsOf(process.body)).toEqual([{ pointer: '', code: 'too_many_procedures' }]);
    expect((await processesOf(created.id)).filter((row) => row.deleted)).toHaveLength(1);
  });

  it('EVM-042 AC4 two additions at 29 stages at once: exactly one 201 and one 422 (the limit is decided under the lock of the order)', async () => {
    const editor = await signIn('editor');
    const created = await order([{ stages: Array.from({ length: 29 }, () => ({})) }]);
    const procedureId = created.processes[0]?.id ?? '';
    const results = await Promise.all(['A', 'B'].map((name) => addStage(editor, created.id, procedureId, { id: uuidv7(), name })));
    expect(results.map((result) => result.status).sort()).toEqual([201, 422]);
    expect(await stagesOf(procedureId)).toHaveLength(30);
  });

  it('EVM-042 AC4 a settled or a cancelled order is 409 work_order_closed for ALL six commands — before the version, for any role that may — and nothing is written', async () => {
    const administrator = await signIn('administrator');
    const editor = await signIn('editor');
    for (const status of ['settled', 'cancelled'] as const) {
      const created = await order(
        [{ stages: [{}, { deletedAt: new Date('2026-10-01T08:00:00Z') }] }, { deletedAt: new Date('2026-10-01T08:00:00Z') }],
        {
          status,
        },
      );
      const [live, gone] = created.processes;
      const auditBefore = await auditTotal();
      const stale = '"9"';
      const responses = [
        await addProcedure(editor, created.id, { id: uuidv7(), procedureTemplateCode: FIRE }),
        await addStage(editor, created.id, live?.id ?? '', { id: uuidv7(), name: 'Etap' }),
        await removeProcedure(editor, created.id, live?.id ?? '', { ifMatch: stale }),
        await removeStage(editor, created.id, live?.stageIds[0] ?? '', { ifMatch: stale }),
        await restoreProcedure(administrator, created.id, gone?.id ?? '', { ifMatch: stale }),
        await restoreStage(administrator, created.id, live?.stageIds[1] ?? '', { ifMatch: stale }),
      ];
      for (const [index, response] of responses.entries()) {
        expect(response.status, `${status} ${index} ${JSON.stringify(response.body)}`).toBe(409);
        expect(codeOf(response.body)).toBe('work_order_closed');
        expect(JSON.stringify(response.body)).not.toMatch(/settled|cancelled/);
      }
      expect(await auditTotal()).toBe(auditBefore);
      expect(await processesOf(created.id)).toHaveLength(2);
    }
  });

  it('EVM-042 AC4 an order that is on hold or already completed takes the commands (only settled and cancelled are closed)', async () => {
    const editor = await signIn('editor');
    for (const status of ['on_hold', 'completed'] as const) {
      const created = await order([{ stages: [{}] }], { status });
      const response = await addStage(editor, created.id, created.processes[0]?.id ?? '', { id: uuidv7(), name: 'Etap' });
      expect(response.status, status).toBe(201);
    }
  });
});

describe('the audit trail, the journal and the exposure of the name (EVM-042 AC3, AC5; SR-LOG-02, SR-LOG-03, TM-21)', () => {
  const MARKER = 'Etap-znacznik-qwv';

  it('EVM-042 AC3 AC5 every one of the six actions has an audit record of its own: the actor, the object, the outcome, the trace and a prefix of the address — and not a name', async () => {
    const administrator = await signIn('administrator');
    const editor = await signIn('editor');
    const created = await order([{ stages: [{}] }]);
    const processId = uuidv7();
    const stageId = uuidv7();
    expect((await addProcedure(editor, created.id, { id: processId, procedureTemplateCode: FIRE })).status).toBe(201);
    expect((await addStage(editor, created.id, created.processes[0]?.id ?? '', { id: stageId, name: MARKER })).status).toBe(201);
    expect((await removeStage(editor, created.id, stageId, { ifMatch: '"1"' })).status).toBe(204);
    expect((await restoreStage(administrator, created.id, stageId, { ifMatch: '"2"' })).status).toBe(200);
    expect((await removeProcedure(editor, created.id, processId, { ifMatch: '"1"' })).status).toBe(204);
    expect((await restoreProcedure(administrator, created.id, processId, { ifMatch: '"2"' })).status).toBe(200);

    const expected: Array<[string, string, string, string]> = [
      [processId, 'procedure.created', 'procedure', editor.userId],
      [stageId, 'procedure_stage.created', 'procedure_stage', editor.userId],
      [stageId, 'procedure_stage.deleted', 'procedure_stage', editor.userId],
      [stageId, 'procedure_stage.restored', 'procedure_stage', administrator.userId],
      [processId, 'procedure.deleted', 'procedure', editor.userId],
      [processId, 'procedure.restored', 'procedure', administrator.userId],
    ];
    const seen: string[] = [];
    for (const [objectId, action, objectType, actorId] of expected) {
      const record = (await auditOf(objectId)).find((row) => row['action'] === action);
      expect(record, action).toMatchObject({ actor_user_id: actorId, object_type: objectType, object_id: objectId, outcome: 'success' });
      expect(String(record?.['trace_id'])).toMatch(/^[0-9a-f]{32}$/);
      expect(record?.['ip_prefix']).not.toBeNull();
      seen.push(JSON.stringify(record));
    }
    expect(seen.join('\n')).not.toContain(MARKER);
  });

  it('EVM-042 AC5 every change writes one entry of the journal with the codes and the identifiers — the payload holds no name of a stage, no person and no day', async () => {
    const editor = await signIn('editor');
    const created = await order([{ code: 'seeded_one', stages: [{}] }]);
    const seeded = created.processes[0];
    const processId = uuidv7();
    const stageId = uuidv7();
    await addProcedure(editor, created.id, { id: processId, procedureTemplateCode: FIRE });
    await addStage(editor, created.id, seeded?.id ?? '', {
      id: stageId,
      name: MARKER,
      dueDate: '2026-11-11',
      responsibleUserId: editor.userId,
    });
    await removeStage(editor, created.id, stageId, { ifMatch: '"1"' });
    await removeProcedure(editor, created.id, processId, { ifMatch: '"1"' });
    const administrator = await signIn('administrator');
    await restoreStage(administrator, created.id, stageId, { ifMatch: '"2"' });
    await restoreProcedure(administrator, created.id, processId, { ifMatch: '"2"' });

    const journal = await journalOf(created.id);
    expect(journal.map((entry) => entry.event_code)).toEqual([
      'procedure_added',
      'stage_added',
      'stage_removed',
      'procedure_removed',
      'stage_restored',
      'procedure_restored',
    ]);
    expect(journal[0]?.event_payload).toEqual({ objectType: 'procedure', objectId: processId, procedureCode: FIRE });
    expect(journal[1]?.event_payload).toEqual({ objectType: 'procedure_stage', objectId: stageId, procedureCode: 'seeded_one' });
    expect(journal[1]?.procedure_stage_id).toBe(stageId);
    expect(journal[0]?.procedure_stage_id).toBeNull();
    expect(JSON.stringify(journal)).not.toMatch(new RegExp(`${MARKER}|2026-11-11|${editor.userId}`));
  });

  it('EVM-042 AC5 the name of a stage reaches neither the log of the API, nor an error answer — not when added, not when refused, not when deleted', async () => {
    const editor = await signIn('editor');
    const created = await order([{ stages: Array.from({ length: 30 }, () => ({})) }]);
    const procedureId = created.processes[0]?.id ?? '';
    const before = current.logs.lines.length;
    const refused = await addStage(editor, created.id, procedureId, { id: uuidv7(), name: MARKER });
    expect(refused.status).toBe(422);
    const invalid = await addStage(editor, created.id, procedureId, { id: uuidv7(), name: `${MARKER}\u0000` });
    expect(invalid.status).toBe(400);
    const dropped = await removeStage(editor, created.id, created.processes[0]?.stageIds[29] ?? '', { ifMatch: '"1"' });
    expect(dropped.status).toBe(204);
    const accepted = await addStage(editor, created.id, procedureId, { id: uuidv7(), name: MARKER });
    expect(accepted.status).toBe(201);
    const stale = await removeStage(editor, created.id, stageOfBody(accepted.body), { ifMatch: '"9"' });
    expect(stale.status).toBe(412);
    expect([refused, invalid, stale].map((response) => JSON.stringify(response.body)).join('\n')).not.toContain(MARKER);
    expect(current.logs.lines.slice(before).join('\n')).not.toContain(MARKER);
    const { rows } = await sql<{
      n: string;
    }>`select count(*)::text as n from platform.idempotency_records where scope like ${`%${MARKER}%`}`.execute(admin());
    expect(rows[0]?.n).toBe('0');
  });

  it('EVM-042 AC5 a refused command leaves no audit record, no entry of the journal and no record of idempotency', async () => {
    const editor = await signIn('editor');
    const created = await order([{ code: FIRE, stages: [{}] }]);
    const auditBefore = await auditTotal();
    const journalBefore = (await journalOf(created.id)).length;
    const key = uuidv7();
    const refused = await addProcedure(editor, created.id, { id: uuidv7(), procedureTemplateCode: FIRE }, { key });
    expect(refused.status).toBe(409);
    expect(await auditTotal()).toBe(auditBefore);
    expect((await journalOf(created.id)).length).toBe(journalBefore);
    expect(await idempotencyTotal()).toBe(0);
  });

  it('EVM-042 AC3 the list of the deleted ones is bounded: 100 newest of each kind and truncated: true when there are more', async () => {
    const administrator = await signIn('administrator');
    const gone = new Date('2026-10-01T08:00:00Z');
    const created = await order([{ stages: [{}] }, ...Array.from({ length: 29 }, () => ({ stages: [] }))]);
    // 101 deleted stages need 101 places — each process holds at most 30 places, so the stages are spread over four deleted-stage processes
    const holders: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const id = (created.processes[index + 1] as { id: string }).id;
      holders.push(id);
    }
    for (const [index, holder] of holders.entries()) {
      const count = index < 3 ? 30 : 11;
      await sql`
        insert into procedures.procedure_stages (procedure_id, work_order_id, code, name, position, output_document_kind_codes,
          created_at, updated_at, deleted_at)
        select ${holder}::uuid, ${created.id}::uuid, 'gone_' || n, 'Usuniety ' || n, n, '{}', ${gone}, ${gone}, ${gone}::timestamptz + make_interval(secs => n + ${index * 100}::int)
        from generate_series(1, ${count}::int) as n`.execute(admin());
    }
    const response = await deletedOf(administrator, created.id);
    expect(response.status).toBe(200);
    const body = response.body as { procedures: unknown[]; stages: Array<{ deletedAt: string }>; truncated: boolean };
    expect(body.stages).toHaveLength(100);
    expect(body.truncated).toBe(true);
    const times = body.stages.map((stage) => Date.parse(stage.deletedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    // the oldest one is the one left out
    const all = (
      await sql<{
        deleted_at: Date;
      }>`select deleted_at from procedures.procedure_stages where work_order_id = ${created.id} and deleted_at is not null order by deleted_at`.execute(
        admin(),
      )
    ).rows;
    expect(all).toHaveLength(101);
    expect(times).not.toContain(all[0]?.deleted_at.getTime());
  });
});

function stageOfBody(body: unknown): string {
  return (body as { id: string }).id;
}

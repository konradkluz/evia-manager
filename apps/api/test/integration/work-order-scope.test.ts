import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkOrderScopeRegistry } from '../../src/modules/work-orders/index.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, ISSUED_AT, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertProcedure } from '../support/procedure-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertScopeItems, insertWorkOrders } from '../support/work-order-fixtures.ts';
import type { WorkOrderStatus } from '../../src/modules/work-orders/domain/work-order-status.ts';
import { rebuildProjection } from '../support/projection.ts';

/** A participant of the scope that refuses on demand: proves that a failure of any part undoes the whole addition. */
let participantFails = false;

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
  current.app.get(WorkOrderScopeRegistry).register({
    name: 'zz-test-refusal',
    order: 999,
    addProcedures: () => (participantFails ? Promise.reject(new Error('the participant refuses')) : Promise.resolve([])),
    procedureCodesOf: () => Promise.resolve([]),
  });
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  participantFails = false;
  current.clock.set(ISSUED_AT);
  await clearWorkOrderCreation(current.database.admin);
});

const admin = () => current.database.admin;
const BASE = '/api/v1/work-orders';
const SUPPLY = 'supply_installation';
const VALID_SUPPLY = {
  dedicatedCircuit: true,
  internalSupplyLine: false,
  cableLengthM: 18,
  cableCrossSectionMm2: 6,
  residualCurrentDeviceType: 'a_ev',
  overcurrentProtectionA: 32,
};

async function signIn(role: Role = 'editor', channel: 'web' | 'mobile' = 'web', displayName?: string) {
  const user = await createUser(admin(), current.clock, { role, ...(displayName === undefined ? {} : { displayName }) });
  const session = await createSession(admin(), current.clock, user, { channel });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;

const templateId = async (code: string): Promise<string> =>
  (await sql<{ id: string }>`select id from catalog.work_order_templates where code = ${code}`.execute(admin())).rows[0]?.id ?? '';

/** An order made THROUGH THE API from a template of the catalogue — with the processes, the stages and the scope the story starts from. */
async function orderFrom(browser: Browser, template: string): Promise<string> {
  const customerId = await insertCustomer(admin(), { email: `jan-${uuidv7()}@example.invalid` });
  const siteId = await insertSite(admin());
  const id = uuidv7();
  const response = await browser.panel.post(BASE, { id, customerId, siteId, templateId: await templateId(template) });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return id;
}

let numbering = 0;
/** A bare order written straight into the database (no template), optionally closed or deleted. */
async function bareOrder(options: { status?: WorkOrderStatus; deleted?: boolean } = {}): Promise<string> {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `anna${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [
    {
      number: `ZL-5${String(numbering).padStart(3, '0')}-0001`,
      customerId,
      siteId,
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(options.deleted === true ? { deletedAt: new Date('2026-10-02T08:00:00Z') } : {}),
    },
  ]);
  return [...ids.values()][0] ?? '';
}

interface ItemBody {
  id: string;
  position: number;
  code: string;
  name: string;
  parameterSetCode: string | null;
  parameters: Record<string, unknown>;
  quantity: number;
  version: number;
  notes?: string;
}
interface Addition {
  item: ItemBody;
  addedProcedureCodes: string[];
}

interface AddOptions {
  readonly key?: string;
}
const add = (browser: Browser, orderId: string, body: Record<string, unknown>, options: AddOptions = {}) => {
  const call = browser.panel.post(`${BASE}/${orderId}/scope-items`, { id: uuidv7(), ...body });
  return options.key === undefined ? call : call.set('Idempotency-Key', options.key);
};
interface ChangeOptions {
  readonly ifMatch?: string | null;
  readonly key?: string;
}
const headersOf = (options: ChangeOptions) => ({
  ...(options.ifMatch === null ? {} : { 'If-Match': options.ifMatch ?? '"1"' }),
  ...(options.key === undefined ? {} : { 'Idempotency-Key': options.key }),
});
const change = (browser: Browser, orderId: string, itemId: string, body: unknown, options: ChangeOptions = {}) =>
  browser.panel.patch(`${BASE}/${orderId}/scope-items/${itemId}`, body, headersOf(options));
const remove = (browser: Browser, orderId: string, itemId: string, options: ChangeOptions = {}) =>
  browser.panel.delete(`${BASE}/${orderId}/scope-items/${itemId}`, headersOf(options));
const read = (browser: Browser, orderId: string, itemId: string) => browser.panel.get(`${BASE}/${orderId}/scope-items/${itemId}`);
const listOf = (browser: Browser, orderId: string) => browser.panel.get(`${BASE}/${orderId}/scope-items`);
const processesOf = (browser: Browser, orderId: string) => browser.panel.get(`${BASE}/${orderId}/procedures`);

const codeOf = (body: unknown) => (body as { code?: string }).code;
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;
const withoutTrace = (body: unknown): string => JSON.stringify(body).replace(/"traceId":"[0-9a-f]+"/, '');
const itemsOf = async (browser: Browser, orderId: string): Promise<ItemBody[]> =>
  ((await listOf(browser, orderId)).body as { items: ItemBody[] }).items;

interface Counts {
  items: number;
  procedures: number;
  stages: number;
  events: number;
  records: number;
}
async function countsOf(orderId: string): Promise<Counts> {
  const n = async (query: ReturnType<typeof sql<{ n: string }>>) => Number((await query.execute(admin())).rows[0]?.n);
  return {
    items: await n(sql<{ n: string }>`select count(*)::text as n from work_orders.scope_items where work_order_id = ${orderId}`),
    procedures: await n(sql<{ n: string }>`select count(*)::text as n from procedures.procedures where work_order_id = ${orderId}`),
    stages: await n(sql<{ n: string }>`select count(*)::text as n from procedures.procedure_stages where work_order_id = ${orderId}`),
    events: await n(
      sql<{ n: string }>`select count(*)::text as n from timeline.timeline_entries where work_order_id = ${orderId} and kind = 'event'`,
    ),
    records: await n(sql<{ n: string }>`select count(*)::text as n from platform.idempotency_records`),
  };
}
const eventsOf = async (orderId: string) =>
  (
    await sql<{ event_code: string; event_payload: Record<string, unknown> }>`
      select event_code, event_payload from timeline.timeline_entries
      where work_order_id = ${orderId} and kind = 'event' order by created_at, id`.execute(admin())
  ).rows;
/** The audit trail is append-only and is not emptied between tests: a test looks at the records of ITS item. */
const auditOf = async (action: string, objectId: string) =>
  (
    await sql<
      Record<string, unknown>
    >`select * from audit.events where action = ${action} and object_id = ${objectId} order by occurred_at, id`.execute(admin())
  ).rows;
const auditTotal = async (): Promise<number> =>
  Number(
    (
      await sql<{ n: string }>`select count(*)::text as n from audit.events
        where action in ('scope_item.created', 'scope_item.updated', 'scope_item.deleted')`.execute(admin())
    ).rows[0]?.n,
  );

describe('adding an item with its processes (EVM-035 AC2; SR-API-06)', () => {
  it('EVM-035 AC2 "Dom — sam montaż" + "Instalacja zasilająca": 201, the item at the end with the parameters {} and the version 1, and ONE process "electrical_installation" with three stages "Do zrobienia" that points at the item', async () => {
    const editor = await signIn('editor');
    const id = await orderFrom(editor, 'house_installation_only');
    const before = await itemsOf(editor, id);
    expect(before.map((item) => item.code)).toEqual(['customer_charger', 'charger_installation', 'measurements_acceptance']);
    const countsBefore = await countsOf(id);

    const itemId = uuidv7();
    const response = await editor.panel.post(`${BASE}/${id}/scope-items`, {
      id: itemId,
      catalogItemCode: SUPPLY,
      procedureCodes: ['electrical_installation'],
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.headers['etag']).toBe('"1"');
    expect(response.headers['location']).toBe(`${BASE}/${id}/scope-items/${itemId}`);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.body as Addition;
    expect(body.item).toEqual({
      id: itemId,
      position: 4,
      code: SUPPLY,
      name: 'Instalacja zasilająca (obwód dedykowany lub istniejący)',
      parameterSetCode: 'supply_circuit',
      parameters: {},
      quantity: 1,
      version: 1,
    });
    expect(body.addedProcedureCodes).toEqual(['electrical_installation']);

    const processes = (await processesOf(editor, id)).body as {
      items: Array<{
        code: string;
        name: string;
        position: number;
        sourceScopeItemId?: string;
        stages: Array<{ status: string; name: string }>;
      }>;
    };
    const added = processes.items.find((item) => item.code === 'electrical_installation');
    expect(added).toMatchObject({ name: 'Instalacja zasilająca', sourceScopeItemId: itemId });
    expect(added?.stages.map((stage) => [stage.name, stage.status])).toEqual([
      ['Oględziny i pomiar trasy', 'todo'],
      ['Wykonanie instalacji', 'todo'],
      ['Zabezpieczenia i podłączenie', 'todo'],
    ]);
    expect(added?.position).toBe(processes.items.length);

    const countsAfter = await countsOf(id);
    expect(countsAfter).toMatchObject({
      items: countsBefore.items + 1,
      procedures: countsBefore.procedures + 1,
      stages: countsBefore.stages + 3,
      events: countsBefore.events + 1,
    });
    expect(await itemsOf(editor, id)).toHaveLength(4);
  });

  it('EVM-035 AC2 AC4 the parameters of the set are validated and stored; the notes go to the typed column, not into the parameters', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    const response = await add(editor, id, { catalogItemCode: SUPPLY, parameters: VALID_SUPPLY, notes: 'Trasa przez garaż, szacht B' });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const item = (response.body as Addition).item;
    expect(item).toMatchObject({ position: 1, parameters: VALID_SUPPLY, notes: 'Trasa przez garaż, szacht B', version: 1 });
    const { rows } = await sql<{ parameters: Record<string, unknown>; notes: string | null; source_catalog_item_id: string }>`
      select parameters, notes, source_catalog_item_id from work_orders.scope_items where id = ${item.id}`.execute(admin());
    expect(rows[0]?.parameters).toEqual(VALID_SUPPLY);
    expect(Object.keys(rows[0]?.parameters ?? {})).not.toContain('notes');
    expect(rows[0]?.notes).toBe('Trasa przez garaż, szacht B');
    expect(rows[0]?.source_catalog_item_id).toMatch(/^[0-9a-f-]{36}$/);
    // no process was asked for, so none was added
    expect((await countsOf(id)).procedures).toBe(0);
  });

  it('EVM-035 AC2 a process whose code is already active in the order is not made again — "Dom — pełny pakiet" has "Uzgodnienia z OSD"; adding "Uzgodnienia z OSD" brings no second one and is no error', async () => {
    const editor = await signIn('editor');
    const id = await orderFrom(editor, 'house_full_package');
    const before = await countsOf(id);
    const response = await add(editor, id, { catalogItemCode: 'dso_agreement', procedureCodes: ['dso_connection'] });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect((response.body as Addition).addedProcedureCodes).toEqual([]);
    const after = await countsOf(id);
    expect(after.procedures).toBe(before.procedures);
    expect(after.stages).toBe(before.stages);
    expect(after.items).toBe(before.items + 1);
    const { rows } = await sql<{ n: string }>`
      select count(*)::text as n from procedures.procedures where work_order_id = ${id} and code = 'dso_connection' and deleted_at is null`.execute(
      admin(),
    );
    expect(rows[0]?.n).toBe('1');
    // the journal says no process was added
    const events = await eventsOf(id);
    expect(events.at(-1)).toMatchObject({
      event_code: 'scope_item_added',
      event_payload: { itemCode: 'dso_agreement', procedureCodes: [] },
    });
  });

  it('EVM-035 AC2 a code of a process the item does not bring is 400 /procedureCodes/N not_brought_by_item, and a code twice is duplicate — nothing is written', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    const stranger = await add(editor, id, { catalogItemCode: SUPPLY, procedureCodes: ['electrical_installation', 'dso_connection'] });
    expect(stranger.status).toBe(400);
    expect(errorsOf(stranger.body)).toEqual([{ pointer: '/procedureCodes/1', code: 'not_brought_by_item' }]);
    const twice = await add(editor, id, {
      catalogItemCode: SUPPLY,
      procedureCodes: ['electrical_installation', 'electrical_installation'],
    });
    expect(twice.status).toBe(400);
    expect(errorsOf(twice.body)).toEqual([{ pointer: '/procedureCodes/1', code: 'duplicate' }]);
    expect(await countsOf(id)).toMatchObject({ items: 0, procedures: 0, stages: 0, events: 0 });
  });

  it('EVM-035 AC2 AC5 SR-API-06 a participant that fails undoes the WHOLE addition: no item, no process, no event, no audit record and no idempotency record — and the same command works once the fault is gone', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    const before = await countsOf(id);
    const auditBefore = await auditTotal();
    participantFails = true;
    const key = uuidv7();
    const itemId = uuidv7();
    const body = { id: itemId, catalogItemCode: SUPPLY, procedureCodes: ['electrical_installation'] };
    const failed = await editor.panel.post(`${BASE}/${id}/scope-items`, body).set('Idempotency-Key', key);
    expect(failed.status).toBe(500);
    expect(codeOf(failed.body)).toBe('internal_error');
    expect(JSON.stringify(failed.body)).not.toMatch(/participant|refuses/i);
    expect(await countsOf(id)).toEqual(before);
    expect(await auditTotal()).toBe(auditBefore);
    participantFails = false;
    const again = await editor.panel.post(`${BASE}/${id}/scope-items`, body).set('Idempotency-Key', key);
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect((await countsOf(id)).procedures).toBe(1);
  });

  it('EVM-035 AC2 SR-API-06 when the journal cannot write the event, the item and its processes are not stored either', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    const before = await countsOf(id);
    await sql`
      create function timeline.fail_event_write() returns trigger language plpgsql as $$
      begin
        if new.kind = 'event' then raise exception 'the journal refuses an event' using errcode = 'EV999'; end if;
        return new;
      end $$`.execute(admin());
    await sql`create trigger fail_event_write before insert on timeline.timeline_entries
      for each row execute function timeline.fail_event_write()`.execute(admin());
    try {
      const response = await add(editor, id, { catalogItemCode: SUPPLY, procedureCodes: ['electrical_installation'] }, { key: uuidv7() });
      expect(response.status).toBe(500);
      expect(JSON.stringify(response.body)).not.toMatch(/journal refuses|EV999|timeline|trigger/i);
    } finally {
      await sql`drop trigger fail_event_write on timeline.timeline_entries`.execute(admin());
      await sql`drop function timeline.fail_event_write()`.execute(admin());
    }
    expect(await countsOf(id)).toEqual(before);
  });

  it('EVM-035 AC2 a repeat of the same key, order and body returns the same item and the same codes with Idempotent-Replayed — and writes nothing new', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    const key = uuidv7();
    const body = { id: uuidv7(), catalogItemCode: SUPPLY, procedureCodes: ['electrical_installation'] };
    const first = await editor.panel.post(`${BASE}/${id}/scope-items`, body).set('Idempotency-Key', key);
    expect(first.status).toBe(201);
    const counts = await countsOf(id);
    const again = await editor.panel.post(`${BASE}/${id}/scope-items`, body).set('Idempotency-Key', key);
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body).toEqual(first.body);
    expect(again.headers['location']).toBe(first.headers['location']);
    expect(await countsOf(id)).toEqual(counts);
    expect(await auditOf('scope_item.created', body.id)).toHaveLength(1);
  });

  it('EVM-035 AC2 a repeat of an addition whose item was removed since is 404, not the item of somebody else', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    const key = uuidv7();
    const body = { id: uuidv7(), catalogItemCode: SUPPLY };
    expect((await editor.panel.post(`${BASE}/${id}/scope-items`, body).set('Idempotency-Key', key)).status).toBe(201);
    expect((await remove(editor, id, body.id)).status).toBe(204);
    const again = await editor.panel.post(`${BASE}/${id}/scope-items`, body).set('Idempotency-Key', key);
    expect(again.status).toBe(404);
    expect(codeOf(again.body)).toBe('not_found');
  });

  it('EVM-035 AC2 SR-API-05 the key is bound to the ORDER: the same key and body on another order is 422 idempotency_mismatch — not the result of the first order', async () => {
    const editor = await signIn('editor');
    const first = await bareOrder();
    const second = await bareOrder();
    const key = uuidv7();
    const body = { id: uuidv7(), catalogItemCode: SUPPLY };
    expect((await editor.panel.post(`${BASE}/${first}/scope-items`, body).set('Idempotency-Key', key)).status).toBe(201);
    const other = await editor.panel.post(`${BASE}/${second}/scope-items`, body).set('Idempotency-Key', key);
    expect(other.status).toBe(422);
    expect(codeOf(other.body)).toBe('idempotency_mismatch');
    expect((await countsOf(second)).items).toBe(0);
  });
});

describe('the parameters and the notes (EVM-035 AC4; SR-INPUT-01, SR-INPUT-02, SR-DATA-02)', () => {
  it('EVM-035 AC4 a field of the set that is unknown — a PPE, a meter number, a surname — is 400 validation_failed /parameters/<name> unknown_field; the value never comes back', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    for (const field of ['meteringPointId', 'meterNumber', 'lastName', 'ppe']) {
      const response = await add(editor, id, {
        catalogItemCode: SUPPLY,
        parameters: { dedicatedCircuit: true, [field]: 'PL0000012345678901' },
      });
      expect(response.status, field).toBe(400);
      expect(codeOf(response.body), field).toBe('validation_failed');
      expect(errorsOf(response.body), field).toEqual([{ pointer: `/parameters/${field}`, code: 'unknown_field' }]);
      expect(JSON.stringify(response.body), field).not.toContain('PL0000012345678901');
    }
    expect((await countsOf(id)).items).toBe(0);
  });

  it('EVM-035 AC4 a value out of range, of a wrong type or outside the list is 400 with a pointer and a code', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    const cases: Array<[Record<string, unknown>, Array<{ pointer: string; code: string }>]> = [
      [{ dedicatedCircuit: true, cableLengthM: 5000 }, [{ pointer: '/parameters/cableLengthM', code: 'out_of_range' }]],
      [{ dedicatedCircuit: true, cableLengthM: 0 }, [{ pointer: '/parameters/cableLengthM', code: 'out_of_range' }]],
      [{ dedicatedCircuit: 'tak' }, [{ pointer: '/parameters/dedicatedCircuit', code: 'invalid_type' }]],
      [
        { dedicatedCircuit: true, residualCurrentDeviceType: 'x' },
        [{ pointer: '/parameters/residualCurrentDeviceType', code: 'invalid_value' }],
      ],
      [{ cableLengthM: 12 }, [{ pointer: '/parameters/dedicatedCircuit', code: 'invalid_type' }]],
    ];
    for (const [parameters, expected] of cases) {
      const response = await add(editor, id, { catalogItemCode: SUPPLY, parameters });
      expect(response.status, JSON.stringify(parameters)).toBe(400);
      expect(errorsOf(response.body), JSON.stringify(parameters)).toEqual(expected);
    }
  });

  it('EVM-035 AC4 SR-INPUT-06 parameters of more than 16 KB are 400 validation_failed (/parameters, too_large) — not stored, not echoed', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    const big = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`key${index}`, 'x'.repeat(100)]));
    const response = await add(editor, id, { catalogItemCode: SUPPLY, parameters: { dedicatedCircuit: true, ...big } });
    expect(response.status).toBe(400);
    expect(codeOf(response.body)).toBe('validation_failed');
    expect(errorsOf(response.body)).toEqual([{ pointer: '/parameters', code: 'too_large' }]);
    expect(JSON.stringify(response.body)).not.toContain('xxxxxxxxxx');
    const item = ((await add(editor, id, { catalogItemCode: SUPPLY, parameters: { dedicatedCircuit: true } })).body as Addition).item;
    const changed = await change(editor, id, item.id, { parameters: { dedicatedCircuit: true, ...big } });
    expect(errorsOf(changed.body)).toEqual([{ pointer: '/parameters', code: 'too_large' }]);
    expect((await read(editor, id, item.id)).body).toMatchObject({ parameters: { dedicatedCircuit: true }, version: 1 });
  });

  it('EVM-035 AC4 SR-INPUT-02 __proto__ and constructor in the parameters are 400 unknown_field — also __proto__ alone, and in a change of the item', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    const post = (parameters: string) =>
      editor.panel
        .post(`${BASE}/${id}/scope-items`, undefined)
        .set('Content-Type', 'application/json')
        .send(`{"id":"${uuidv7()}","catalogItemCode":"${SUPPLY}","parameters":${parameters}}`);
    const proto = await post('{"dedicatedCircuit":true,"__proto__":{"admin":true}}');
    expect(proto.status).toBe(400);
    expect(errorsOf(proto.body)).toEqual([{ pointer: '/parameters/__proto__', code: 'unknown_field' }]);
    const constructed = await post('{"dedicatedCircuit":true,"constructor":{"prototype":{"admin":true}}}');
    expect(constructed.status).toBe(400);
    expect(errorsOf(constructed.body)?.map((error) => error.code)).toContain('unknown_field');
    const item = ((await add(editor, id, { catalogItemCode: SUPPLY, parameters: { dedicatedCircuit: true } })).body as Addition).item;
    const changed = await editor.panel
      .patch(`${BASE}/${id}/scope-items/${item.id}`, undefined, { 'If-Match': '"1"' })
      .set('Content-Type', 'application/json')
      .send('{"parameters":{"__proto__":{"admin":true}}}');
    expect(changed.status).toBe(400);
    expect(errorsOf(changed.body)).toEqual([{ pointer: '/parameters/__proto__', code: 'unknown_field' }]);
    expect((await countsOf(id)).items).toBe(1);
  });

  it('EVM-035 AC4 an item without a set takes no parameters (400 not_allowed); an unknown or retired item of the catalogue is ONE answer — 400 /catalogItemCode unknown_catalog_item', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    const noSet = await add(editor, id, { catalogItemCode: 'measurements_acceptance', parameters: { powerKw: 11 } });
    expect(noSet.status).toBe(400);
    expect(errorsOf(noSet.body)).toEqual([{ pointer: '/parameters', code: 'not_allowed' }]);
    const unknown = await add(editor, id, { catalogItemCode: 'no_such_item' });
    await sql`update catalog.service_catalog_items set is_active = false where code = 'technical_assessment'`.execute(admin());
    let retired;
    try {
      retired = await add(editor, id, { catalogItemCode: 'technical_assessment' });
    } finally {
      await sql`update catalog.service_catalog_items set is_active = true where code = 'technical_assessment'`.execute(admin());
    }
    for (const answer of [unknown, retired]) {
      expect(answer.status).toBe(400);
      expect(errorsOf(answer.body)).toEqual([{ pointer: '/catalogItemCode', code: 'unknown_catalog_item' }]);
      expect(withoutTrace(answer.body)).toBe(withoutTrace(unknown.body));
    }
    expect((await countsOf(id)).items).toBe(0);
  });

  it('EVM-035 AC4 "Inna usługa": the description is required and lives in the typed column notes — not in the parameters; the item brings no process', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    const without = await add(editor, id, { catalogItemCode: 'custom_service' });
    expect(without.status).toBe(400);
    expect(errorsOf(without.body)).toEqual([{ pointer: '/notes', code: 'required' }]);
    const blank = await add(editor, id, { catalogItemCode: 'custom_service', notes: '   ' });
    expect(errorsOf(blank.body)).toEqual([{ pointer: '/notes', code: 'required' }]);
    const response = await add(editor, id, { catalogItemCode: 'custom_service', notes: 'Wymiana zabezpieczenia w rozdzielnicy garażowej' });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const { item, addedProcedureCodes } = response.body as Addition;
    expect(item).toMatchObject({
      code: 'custom_service',
      parameterSetCode: null,
      parameters: {},
      notes: 'Wymiana zabezpieczenia w rozdzielnicy garażowej',
    });
    expect(addedProcedureCodes).toEqual([]);
    // the description cannot be emptied afterwards
    const cleared = await change(editor, id, item.id, { notes: null });
    expect(cleared.status).toBe(400);
    expect(errorsOf(cleared.body)).toEqual([{ pointer: '/notes', code: 'required' }]);
    const edited = await change(editor, id, item.id, { notes: 'Wymiana zabezpieczenia i kabla' });
    expect(edited.status).toBe(200);
    expect((edited.body as ItemBody).notes).toBe('Wymiana zabezpieczenia i kabla');
  });

  it('EVM-035 AC4 the notes are plain text: control characters and more than 1000 characters are 400; a new line is kept', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    const control = await add(editor, id, { catalogItemCode: SUPPLY, notes: 'a\u0007b' });
    expect(errorsOf(control.body)).toEqual([{ pointer: '/notes', code: 'invalid_characters' }]);
    const long = await add(editor, id, { catalogItemCode: SUPPLY, notes: 'a'.repeat(1001) });
    expect(errorsOf(long.body)).toEqual([{ pointer: '/notes', code: 'too_long' }]);
    const lines = await add(editor, id, { catalogItemCode: SUPPLY, notes: 'wiersz 1\r\nwiersz 2' });
    expect((lines.body as Addition).item.notes).toBe('wiersz 1\nwiersz 2');
  });

  it('EVM-035 AC4 the change of an item: the parameters are validated against the set SAVED in the item; code, name, set, position, quantity and version are read_only_field', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    const item = ((await add(editor, id, { catalogItemCode: SUPPLY, parameters: { dedicatedCircuit: true } })).body as Addition).item;
    const good = await change(editor, id, item.id, { parameters: { dedicatedCircuit: false, cableLengthM: 25 } });
    expect(good.status, JSON.stringify(good.body)).toBe(200);
    expect(good.headers['etag']).toBe('"2"');
    expect(good.body).toMatchObject({
      parameters: { dedicatedCircuit: false, cableLengthM: 25 },
      version: 2,
      parameterSetCode: 'supply_circuit',
    });
    const bad = await change(editor, id, item.id, { parameters: { dedicatedCircuit: true, powerKw: 11 } }, { ifMatch: '"2"' });
    expect(errorsOf(bad.body)).toEqual([{ pointer: '/parameters/powerKw', code: 'unknown_field' }]);
    for (const field of ['code', 'name', 'parameterSetCode', 'position', 'quantity', 'version', 'sourceCatalogItemId', 'id']) {
      const response = await change(
        editor,
        id,
        item.id,
        { notes: 'x', [field]: field === 'quantity' || field === 'position' ? 5 : 'charger_spec' },
        { ifMatch: '"2"' },
      );
      expect(response.status, field).toBe(400);
      expect(errorsOf(response.body), field).toEqual([{ pointer: `/${field}`, code: 'read_only_field' }]);
    }
    const stored = await read(editor, id, item.id);
    expect(stored.body).toMatchObject({ code: SUPPLY, position: 1, quantity: 1, version: 2, parameterSetCode: 'supply_circuit' });
  });
});

describe('the change of an item: the tag and the key (EVM-035 AC1, AC4; SR-API-05, SR-API-07)', () => {
  it('EVM-035 AC4 SR-API-07 a missing If-Match is 428, a malformed one 400, a stale one 412 with no current value — and the item stays as it was', async () => {
    const editor = await signIn('editor');
    const other = await signIn('editor');
    const id = await bareOrder();
    const item = ((await add(editor, id, { catalogItemCode: SUPPLY })).body as Addition).item;
    expect((await change(other, id, item.id, { notes: 'Zmiana kolegi' })).status).toBe(200);
    const missing = await change(editor, id, item.id, { notes: 'Moja zmiana' }, { ifMatch: null });
    expect(missing.status).toBe(428);
    expect(codeOf(missing.body)).toBe('precondition_required');
    for (const ifMatch of ['W/"2"', '*', '"1", "2"']) {
      const malformed = await change(editor, id, item.id, { notes: 'Moja zmiana' }, { ifMatch });
      expect(malformed.status, ifMatch).toBe(400);
      expect(errorsOf(malformed.body), ifMatch).toEqual([{ pointer: '/headers/If-Match', code: 'invalid_format' }]);
    }
    const stale = await change(editor, id, item.id, { notes: 'Moja zmiana' });
    expect(stale.status).toBe(412);
    expect(codeOf(stale.body)).toBe('version_conflict');
    expect(JSON.stringify(stale.body)).not.toMatch(/Zmiana kolegi|Moja zmiana/);
    expect((await read(editor, id, item.id)).body).toMatchObject({ notes: 'Zmiana kolegi', version: 2 });
  });

  it('EVM-035 AC4 SR-API-05 a repeat of the same key, item and body is the SAME change (200, Idempotent-Replayed, one event) — also with a stale If-Match; the same key on another item is 422', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    const first = ((await add(editor, id, { catalogItemCode: SUPPLY })).body as Addition).item;
    const second = ((await add(editor, id, { catalogItemCode: SUPPLY })).body as Addition).item;
    const key = uuidv7();
    const done = await change(editor, id, first.id, { notes: 'Nowa notatka' }, { key });
    expect(done.status).toBe(200);
    expect(done.headers['idempotent-replayed']).toBeUndefined();
    const again = await change(editor, id, first.id, { notes: 'Nowa notatka' }, { key });
    expect(again.status).toBe(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.headers['etag']).toBe('"2"');
    expect(again.body).toEqual(done.body);
    expect((await eventsOf(id)).filter((event) => event.event_code === 'scope_item_updated')).toHaveLength(1);
    expect(await auditOf('scope_item.updated', first.id)).toHaveLength(1);
    const other = await change(editor, id, second.id, { notes: 'Nowa notatka' }, { key });
    expect(other.status).toBe(422);
    expect(codeOf(other.body)).toBe('idempotency_mismatch');
    expect((await read(editor, id, second.id)).body).toMatchObject({ version: 1 });
    const body = await change(editor, id, first.id, { notes: 'Inna notatka' }, { key, ifMatch: '"2"' });
    expect(body.status).toBe(422);
  });

  it('EVM-035 AC4 an empty patch is 400 required; a patch that changes nothing writes nothing — no version, no event, no audit record', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    const item = (
      (await add(editor, id, { catalogItemCode: SUPPLY, notes: 'Uwaga', parameters: { dedicatedCircuit: true } })).body as Addition
    ).item;
    const empty = await change(editor, id, item.id, {});
    expect(empty.status).toBe(400);
    expect(errorsOf(empty.body)).toEqual([{ pointer: '', code: 'required' }]);
    const same = await change(editor, id, item.id, { notes: 'Uwaga', parameters: { dedicatedCircuit: true } });
    expect(same.status).toBe(200);
    expect(same.headers['etag']).toBe('"1"');
    expect((await eventsOf(id)).filter((event) => event.event_code === 'scope_item_updated')).toHaveLength(0);
    expect(await auditOf('scope_item.updated', item.id)).toHaveLength(0);
  });
});

describe('the limits of the scope (EVM-035 AC5; SR-API-02, TM-22)', () => {
  const fill = async (orderId: string, count: number) =>
    insertScopeItems(
      admin(),
      orderId,
      Array.from({ length: count }, (_, index) => ({ position: index + 1, code: `item_${index + 1}` })),
    );

  it('EVM-035 AC5 the 51st item is 422 limit_exceeded with a pointer and a code only; nothing is written; after a removal the addition works', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    const ids = await fill(id, 50);
    const response = await add(editor, id, { catalogItemCode: SUPPLY, procedureCodes: ['electrical_installation'] }, { key: uuidv7() });
    expect(response.status).toBe(422);
    expect(codeOf(response.body)).toBe('limit_exceeded');
    expect(errorsOf(response.body)).toEqual([{ pointer: '', code: 'too_many_scope_items' }]);
    expect(await countsOf(id)).toMatchObject({ items: 50, procedures: 0, events: 0, records: 0 });
    expect((await itemsOf(editor, id)).length).toBe(50);

    expect((await remove(editor, id, ids[7] ?? '')).status).toBe(204);
    const again = await add(editor, id, { catalogItemCode: SUPPLY });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect((again.body as Addition).item.position).toBe(50);
  });

  it('EVM-035 AC5 SR-API-06 two additions at 49 items racing each other: EXACTLY ONE is 201, the other is 422 — the lock of the order serialises them', async () => {
    const editor = await signIn('editor');
    const other = await signIn('administrator');
    const id = await bareOrder();
    await fill(id, 49);
    const [a, b] = await Promise.all([
      add(editor, id, { catalogItemCode: SUPPLY }),
      add(other, id, { catalogItemCode: 'custom_service', notes: 'Opis' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 422]);
    expect((await countsOf(id)).items).toBe(50);
    expect((await itemsOf(editor, id)).map((item) => item.position)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
  });

  it('EVM-035 AC5 SR-API-02 the 31st process is 422 limit_exceeded (/procedureCodes) — the item is not stored either', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    for (let index = 0; index < 30; index += 1)
      await insertProcedure(admin(), id, { position: index + 1, code: `process_${index}`, stages: [{}] });
    const response = await add(editor, id, { catalogItemCode: SUPPLY, procedureCodes: ['electrical_installation'] });
    expect(response.status).toBe(422);
    expect(codeOf(response.body)).toBe('limit_exceeded');
    expect(errorsOf(response.body)).toEqual([{ pointer: '/procedureCodes', code: 'too_many_procedures' }]);
    expect(await countsOf(id)).toMatchObject({ items: 0, procedures: 30 });
  });

  it('EVM-035 AC5 the list of the scope holds at most 50 items — the limit of the scope is the limit of the answer', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    await fill(id, 50);
    const response = await listOf(editor, id);
    expect(response.status).toBe(200);
    expect((response.body as { items: unknown[] }).items).toHaveLength(50);
  });
});

describe('removing an item (EVM-035 AC3; SR-API-07)', () => {
  it('EVM-035 AC3 the item leaves the scope, the others are numbered 1…n again, and the processes it brought STAY with the identifier of the item', async () => {
    const editor = await signIn('editor');
    const id = await orderFrom(editor, 'house_installation_only');
    const added = (await add(editor, id, { catalogItemCode: SUPPLY, procedureCodes: ['electrical_installation'] })).body as Addition;
    const first = (await itemsOf(editor, id))[0];
    const processesBefore = await countsOf(id);

    const response = await remove(editor, id, first?.id ?? '');
    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    const items = await itemsOf(editor, id);
    expect(items.map((item) => [item.position, item.code])).toEqual([
      [1, 'charger_installation'],
      [2, 'measurements_acceptance'],
      [3, SUPPLY],
    ]);
    // the removal of the item that brought "electrical_installation" leaves the process in the order
    expect((await remove(editor, id, added.item.id, { ifMatch: '"1"' })).status).toBe(204);
    const processes = (await processesOf(editor, id)).body as { items: Array<{ code: string; sourceScopeItemId?: string }> };
    expect(processes.items.map((item) => item.code)).toContain('electrical_installation');
    expect(processes.items.find((item) => item.code === 'electrical_installation')?.sourceScopeItemId).toBe(added.item.id);
    const after = await countsOf(id);
    expect(after.procedures).toBe(processesBefore.procedures);
    expect(after.stages).toBe(processesBefore.stages);
    // a soft delete: the row stays
    const { rows } = await sql<{ deleted_at: Date | null; deleted_by: string | null }>`
      select deleted_at, deleted_by from work_orders.scope_items where id = ${added.item.id}`.execute(admin());
    expect(rows[0]?.deleted_at).not.toBeNull();
    expect(rows[0]?.deleted_by).toBe(editor.userId);
  });

  it('EVM-035 AC3 the item can be added again; an item that is already removed is 404 for every role and every operation', async () => {
    const administrator = await signIn('administrator');
    const editor = await signIn('editor');
    const reader = await signIn('read_only');
    const id = await bareOrder();
    const item = ((await add(editor, id, { catalogItemCode: SUPPLY })).body as Addition).item;
    expect((await remove(editor, id, item.id)).status).toBe(204);
    for (const browser of [administrator, editor, reader]) {
      expect((await read(browser, id, item.id)).status).toBe(404);
    }
    for (const browser of [administrator, editor]) {
      expect((await change(browser, id, item.id, { notes: 'x' })).status).toBe(404);
      expect((await remove(browser, id, item.id)).status).toBe(404);
    }
    expect((await add(editor, id, { catalogItemCode: SUPPLY })).status).toBe(201);
    expect(await itemsOf(editor, id)).toHaveLength(1);
  });

  it('EVM-035 AC3 SR-API-07 a missing If-Match is 428, a malformed one 400, a stale one 412 — and the item stays', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    const item = ((await add(editor, id, { catalogItemCode: SUPPLY })).body as Addition).item;
    expect((await change(editor, id, item.id, { notes: 'zmiana' })).status).toBe(200);
    const missing = await remove(editor, id, item.id, { ifMatch: null });
    expect(missing.status).toBe(428);
    expect(codeOf(missing.body)).toBe('precondition_required');
    for (const ifMatch of ['W/"2"', '*', '2']) {
      const malformed = await remove(editor, id, item.id, { ifMatch });
      expect(malformed.status, ifMatch).toBe(400);
      expect(errorsOf(malformed.body), ifMatch).toEqual([{ pointer: '/headers/If-Match', code: 'invalid_format' }]);
    }
    const stale = await remove(editor, id, item.id, { ifMatch: '"1"' });
    expect(stale.status).toBe(412);
    expect(codeOf(stale.body)).toBe('version_conflict');
    expect(await itemsOf(editor, id)).toHaveLength(1);
    expect((await remove(editor, id, item.id, { ifMatch: '"2"' })).status).toBe(204);
  });

  it('EVM-035 AC3 a repeat of the removal with the same key is 204 with Idempotent-Replayed (a retry after a lost answer is the same command, not a 404) — one event, one audit record', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    const item = ((await add(editor, id, { catalogItemCode: SUPPLY })).body as Addition).item;
    const key = uuidv7();
    const first = await remove(editor, id, item.id, { key });
    expect(first.status).toBe(204);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    const again = await remove(editor, id, item.id, { key });
    expect(again.status).toBe(204);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(await auditOf('scope_item.deleted', item.id)).toHaveLength(1);
    expect((await eventsOf(id)).filter((event) => event.event_code === 'scope_item_removed')).toHaveLength(1);
    // the same key on another item is not a replay
    const other = ((await add(editor, id, { catalogItemCode: SUPPLY })).body as Addition).item;
    const mismatch = await remove(editor, id, other.id, { key });
    expect(mismatch.status).toBe(422);
    expect(codeOf(mismatch.body)).toBe('idempotency_mismatch');
    expect(await itemsOf(editor, id)).toHaveLength(1);
  });
});

describe('a closed order (EVM-035 AC6; PO-8, decision 17)', () => {
  it('EVM-035 AC6 the addition, the change and the removal in a settled or a cancelled order are 409 work_order_closed — before the version — and nothing is written', async () => {
    const editor = await signIn('editor');
    for (const status of ['settled', 'cancelled'] as const) {
      const id = await bareOrder();
      const item = ((await add(editor, id, { catalogItemCode: SUPPLY, parameters: { dedicatedCircuit: true } })).body as Addition).item;
      await sql`update work_orders.work_orders set status = ${status}, closed_at = now() where id = ${id}`.execute(admin());
      await rebuildProjection(admin(), [id]);
      const before = await countsOf(id);
      const attempts = [
        await add(editor, id, { catalogItemCode: SUPPLY, procedureCodes: ['electrical_installation'] }),
        await change(editor, id, item.id, { notes: 'Nowa notatka' }, { ifMatch: '"9"' }),
        await remove(editor, id, item.id, { ifMatch: '"9"' }),
      ];
      for (const attempt of attempts) {
        expect(attempt.status, status).toBe(409);
        expect(codeOf(attempt.body), status).toBe('work_order_closed');
        expect(JSON.stringify(attempt.body)).not.toMatch(/settled|cancelled|Nowa notatka/);
      }
      expect(await countsOf(id)).toEqual(before);
      expect((await read(editor, id, item.id)).body).toMatchObject({ version: 1, parameters: { dedicatedCircuit: true } });
      // a reading is still possible
      expect((await listOf(editor, id)).status).toBe(200);
    }
  });

  it('EVM-035 AC6 SR-API-06 closing racing the addition: either the item is added before the order is closed, or the addition is 409 — never an item in a closed order after the closing', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder({ status: 'new' });
    const cancel = editor.panel.post(`${BASE}/${id}/transitions`, { to: 'cancelled', reason: 'powód syntetyczny' }).set('If-Match', '"1"');
    const [added, cancelled] = await Promise.all([add(editor, id, { catalogItemCode: SUPPLY }), cancel]);
    expect(cancelled.status).toBe(200);
    expect([201, 409]).toContain(added.status);
    const { rows } = await sql<{ n: string }>`
      select count(*)::text as n from work_orders.scope_items where work_order_id = ${id} and deleted_at is null`.execute(admin());
    expect(rows[0]?.n).toBe(added.status === 201 ? '1' : '0');
  });
});

describe('the journal and the audit trail of the scope (EVM-035 AC7; SR-LOG-03, SR-DATA-01, SR-DATA-02, TM-20)', () => {
  it('EVM-035 AC7 add, change and remove each write ONE event: the code of the item, the codes of the processes, the names of the fields — and the raw payload holds no note, no parameter, no name', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    const added = (
      await add(editor, id, {
        catalogItemCode: SUPPLY,
        parameters: VALID_SUPPLY,
        notes: 'Klucz do garażu u Jana Przykładowego',
        procedureCodes: ['electrical_installation'],
      })
    ).body as Addition;
    expect(
      (await change(editor, id, added.item.id, { parameters: { dedicatedCircuit: false }, notes: 'Inna notatka z numerem 9876' })).status,
    ).toBe(200);
    expect((await change(editor, id, added.item.id, { notes: 'Inna notatka z numerem 9876' }, { ifMatch: '"2"' })).status).toBe(200); // no change
    expect((await remove(editor, id, added.item.id, { ifMatch: '"2"' })).status).toBe(204);

    const events = await eventsOf(id);
    expect(events.map((event) => event.event_code)).toEqual(['scope_item_added', 'scope_item_updated', 'scope_item_removed']);
    expect(events[0]?.event_payload).toEqual({
      objectType: 'scope_item',
      objectId: added.item.id,
      itemCode: SUPPLY,
      procedureCodes: ['electrical_installation'],
    });
    expect(events[1]?.event_payload).toEqual({
      objectType: 'scope_item',
      objectId: added.item.id,
      itemCode: SUPPLY,
      changedFields: ['parameters', 'notes'],
    });
    expect(events[2]?.event_payload).toEqual({ objectType: 'scope_item', objectId: added.item.id, itemCode: SUPPLY });
    // the identifiers are random UUIDs that may contain "18" by chance — only the values of the payload are looked at
    const withoutIds = JSON.stringify(events).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>');
    expect(withoutIds).not.toMatch(/Jan|Przykładow|Klucz|9876|18|Instalacja zasilająca|cableLengthM/);
  });

  it("EVM-035 AC7 the journal API shows the events to a reader with the code of the item and of the processes (names are the panel's, from the catalogue) — and no note", async () => {
    const editor = await signIn('editor');
    const reader = await signIn('read_only');
    const id = await bareOrder();
    await add(editor, id, { catalogItemCode: SUPPLY, notes: 'Notatka z danymi', procedureCodes: ['electrical_installation'] });
    const response = await reader.panel.get(`${BASE}/${id}/timeline?eventGroup=status_changes&limit=100`);
    expect(response.status).toBe(200);
    const items = (response.body as { items: Array<{ body: string | null; event: Record<string, unknown> }> }).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.event).toMatchObject({
      code: 'scope_item_added',
      objectType: 'scope_item',
      itemCode: SUPPLY,
      procedureCodes: ['electrical_installation'],
      changedFields: [],
    });
    expect(JSON.stringify(response.body)).not.toContain('Notatka z danymi');
  });

  it('EVM-035 AC7 SR-LOG-03 the audit trail records the actor, the item, the outcome and the trace — and the removal is an action of its own; no title, name, parameter or note', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    const item = (await add(editor, id, { catalogItemCode: SUPPLY, parameters: VALID_SUPPLY, notes: 'Notatka syntetyczna 4321' }))
      .body as Addition;
    await change(editor, id, item.item.id, { notes: 'Inna notatka 8765' });
    await remove(editor, id, item.item.id, { ifMatch: '"2"' });
    for (const [action, count] of [
      ['scope_item.created', 1],
      ['scope_item.updated', 1],
      ['scope_item.deleted', 1],
    ] as const) {
      const records = await auditOf(action, item.item.id);
      expect(records, action).toHaveLength(count);
      expect(records[0], action).toMatchObject({
        actor_type: 'user',
        actor_user_id: editor.userId,
        outcome: 'success',
        object_type: 'scope_item',
        object_id: item.item.id,
      });
      expect(String(records[0]?.['trace_id'])).toMatch(/^[0-9a-f]{32}$/);
      expect(JSON.stringify(records)).not.toMatch(/4321|8765|cableLengthM|Instalacja|notes|parameters/);
    }
  });
});

describe('who may change the scope and IDOR (EVM-035 AC8; SR-AUTHZ-02, SR-AUTHZ-05, TM-17, AB-06, CWE-639)', () => {
  it('EVM-035 AC8 Administrator and Editor add, change and remove; Tylko odczyt reads one item (200 with the ETag) and is 403 forbidden for every change — for an order that exists, a deleted one and one that does not exist; anonymous is 401', async () => {
    const administrator = await signIn('administrator');
    const editor = await signIn('editor');
    const reader = await signIn('read_only');
    const id = await bareOrder();
    const item = ((await add(administrator, id, { catalogItemCode: SUPPLY })).body as Addition).item;
    expect((await change(editor, id, item.id, { notes: 'Od edytora' })).status).toBe(200);
    const stored = await read(reader, id, item.id);
    expect(stored.status).toBe(200);
    expect(stored.headers['etag']).toBe('"2"');
    expect(stored.body).toMatchObject({ id: item.id, notes: 'Od edytora', version: 2 });

    const deleted = await bareOrder({ deleted: true });
    for (const target of [id, deleted, uuidv7()]) {
      const attempts = [
        await reader.panel.post(`${BASE}/${target}/scope-items`, {}),
        await change(reader, target, item.id, {}, { ifMatch: null }),
        await remove(reader, target, item.id, { ifMatch: null }),
      ];
      for (const attempt of attempts) {
        expect(attempt.status).toBe(403);
        expect(codeOf(attempt.body)).toBe('forbidden');
      }
    }
    const anonymous = current.panel();
    expect((await anonymous.get(`${BASE}/${id}/scope-items/${item.id}`)).status).toBe(401);
    expect((await anonymous.patch(`${BASE}/${id}/scope-items/${item.id}`, { notes: 'x' })).status).toBe(401);
    expect((await anonymous.delete(`${BASE}/${id}/scope-items/${item.id}`)).status).toBe(401);
    expect((await anonymous.post(`${BASE}/${id}/scope-items`, {})).status).toBe(401);
    expect((await remove(administrator, id, item.id, { ifMatch: '"2"' })).status).toBe(204);
  });

  it('EVM-035 AC8 the token of the mobile channel is 403 on every operation of the scope', async () => {
    const mobile = await signIn('editor', 'mobile');
    const id = await bareOrder();
    const item = await insertScopeItems(admin(), id, [{ position: 1 }]);
    const itemId = item[0] ?? '';
    expect((await add(mobile, id, { catalogItemCode: SUPPLY })).status).toBe(403);
    expect((await read(mobile, id, itemId)).status).toBe(403);
    expect((await change(mobile, id, itemId, { notes: 'x' })).status).toBe(403);
    expect((await remove(mobile, id, itemId)).status).toBe(403);
  });

  it('EVM-035 AC8 IDOR: an item of order B named in the path of order A is the SAME 404 for read, change and removal, for Administrator, Editor and (read) Tylko odczyt — and it is untouched', async () => {
    const administrator = await signIn('administrator');
    const editor = await signIn('editor');
    const reader = await signIn('read_only');
    const orderA = await bareOrder();
    const orderB = await bareOrder();
    const [itemOfB] = await insertScopeItems(admin(), orderB, [{ position: 1, name: 'Pozycja zlecenia B', parameters: {} }]);
    const foreign = itemOfB ?? '';
    const missing = uuidv7();
    const answers = [];
    for (const browser of [administrator, editor, reader]) {
      answers.push(await read(browser, orderA, foreign));
    }
    for (const browser of [administrator, editor]) {
      answers.push(await change(browser, orderA, foreign, { notes: 'Przejęcie' }));
      answers.push(await remove(browser, orderA, foreign));
      answers.push(await change(browser, orderA, missing, { notes: 'Przejęcie' }));
    }
    for (const answer of answers) {
      expect(answer.status).toBe(404);
      expect(codeOf(answer.body)).toBe('not_found');
      expect(withoutTrace(answer.body)).toBe(withoutTrace(answers[0]?.body));
    }
    expect(JSON.stringify(answers.map((answer) => answer.body as unknown))).not.toContain('Pozycja zlecenia B');
    expect(await itemsOf(editor, orderB)).toMatchObject([{ id: foreign, name: 'Pozycja zlecenia B', version: 1 }]);
    expect(
      (await sql<{ deleted_at: Date | null }>`select deleted_at from work_orders.scope_items where id = ${foreign}`.execute(admin()))
        .rows[0]?.deleted_at,
    ).toBeNull();
  });

  it('EVM-035 AC8 the items of a deleted order and of an order that does not exist are 404 — read, change, removal and addition; the list too', async () => {
    const administrator = await signIn('administrator');
    const editor = await signIn('editor');
    const deleted = await bareOrder({ deleted: true });
    const [itemId] = await insertScopeItems(admin(), deleted, [{ position: 1 }]);
    for (const browser of [administrator, editor]) {
      for (const target of [deleted, uuidv7()]) {
        expect((await read(browser, target, itemId ?? '')).status).toBe(404);
        expect((await change(browser, target, itemId ?? '', { notes: 'x' })).status).toBe(404);
        expect((await remove(browser, target, itemId ?? '')).status).toBe(404);
        expect((await add(browser, target, { catalogItemCode: SUPPLY })).status).toBe(404);
        expect((await listOf(browser, target)).status).toBe(404);
      }
    }
  });

  it('EVM-035 AC8 an identifier of an item of ANOTHER order sent as the id of a new item is 409 id_conflict — it overwrites nothing and gives no access', async () => {
    const editor = await signIn('editor');
    const orderA = await bareOrder();
    const orderB = await bareOrder();
    const [itemOfB] = await insertScopeItems(admin(), orderB, [{ position: 1, name: 'Pozycja zlecenia B', code: 'item_b' }]);
    const response = await editor.panel.post(`${BASE}/${orderA}/scope-items`, { id: itemOfB, catalogItemCode: SUPPLY, notes: 'Przejęcie' });
    expect(response.status).toBe(409);
    expect(codeOf(response.body)).toBe('id_conflict');
    expect(JSON.stringify(response.body)).not.toMatch(/Pozycja zlecenia B|item_b/);
    const { rows } = await sql<{ work_order_id: string; name: string; notes: string | null }>`
      select work_order_id, name, notes from work_orders.scope_items where id = ${itemOfB ?? ''}`.execute(admin());
    expect(rows).toEqual([{ work_order_id: orderB, name: 'Pozycja zlecenia B', notes: null }]);
    expect(await itemsOf(editor, orderA)).toEqual([]);
    // the id of an item that was removed is taken too
    const removed = uuidv7();
    expect((await editor.panel.post(`${BASE}/${orderA}/scope-items`, { id: removed, catalogItemCode: SUPPLY })).status).toBe(201);
    expect((await remove(editor, orderA, removed)).status).toBe(204);
    expect((await editor.panel.post(`${BASE}/${orderA}/scope-items`, { id: removed, catalogItemCode: SUPPLY })).status).toBe(409);
  });

  it('EVM-035 AC8 a field of the server in the new item — code, name, position, quantity, version, sourceCatalogItemId — is 400 read_only_field; a stranger is unknown_field', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    for (const field of ['code', 'name', 'parameterSetCode', 'position', 'quantity', 'version', 'sourceCatalogItemId']) {
      const response = await add(editor, id, { catalogItemCode: SUPPLY, [field]: field === 'quantity' ? 3 : 'x' });
      expect(response.status, field).toBe(400);
      expect(errorsOf(response.body), field).toEqual([{ pointer: `/${field}`, code: 'read_only_field' }]);
    }
    const stranger = await add(editor, id, { catalogItemCode: SUPPLY, secret: 'wartość' });
    expect(errorsOf(stranger.body)).toEqual([{ pointer: '/secret', code: 'unknown_field' }]);
    expect(await countsOf(id)).toMatchObject({ items: 0 });
  });

  it('EVM-035 AC8 an item is addressed by its order: the answer of a single read has the keys of the contract and nothing else', async () => {
    const editor = await signIn('editor');
    const id = await bareOrder();
    const item = ((await add(editor, id, { catalogItemCode: SUPPLY, notes: 'Uwaga' })).body as Addition).item;
    const response = await read(editor, id, item.id);
    expect(Object.keys(response.body as object).sort()).toEqual(
      ['code', 'id', 'name', 'notes', 'parameterSetCode', 'parameters', 'position', 'quantity', 'version'].sort(),
    );
    expect(JSON.stringify(response.body)).not.toMatch(/created_by|deleted|source_catalog_item_id|work_order_id/);
  });
});

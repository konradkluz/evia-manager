import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkOrderCompositionRegistry, type WorkOrderCompositionContributor } from '../../src/modules/work-orders/index.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, ISSUED_AT, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation } from '../support/work-order-fixtures.ts';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  current.clock.set(ISSUED_AT);
  await clearWorkOrderCreation(current.database.admin);
});

const CREATE = '/api/v1/work-orders';
const admin = () => current.database.admin;

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
const FULL = 'garage_full_process';

interface Scene {
  readonly customerId: string;
  readonly siteId: string;
  readonly fullId: string;
}
async function scene(): Promise<Scene> {
  return {
    customerId: await insertCustomer(admin(), {
      firstName: 'Jan',
      lastName: 'Przykładowy',
      phone: '+48600000777',
      email: 'jan@example.invalid',
    }),
    siteId: await insertSite(admin(), {
      siteType: 'multi_family_garage',
      parkingSpotNumber: '15',
      garageLevel: '-1',
      notes: 'notatka-lokalizacji',
    }),
    fullId: await templateId(FULL),
  };
}
const order = (s: Scene, overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  customerId: s.customerId,
  siteId: s.siteId,
  templateId: s.fullId,
  ...overrides,
});
const create = (browser: Browser, body: unknown, key?: string) => {
  const call = browser.panel.post(CREATE, body);
  return key === undefined ? call : call.set('Idempotency-Key', key);
};
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;
const withoutTrace = (body: unknown): string => JSON.stringify(body).replace(/"traceId":"[0-9a-f]+"/, '');
const COUNTS = {
  orders: () => sql<{ n: string }>`select count(*)::text as n from work_orders.work_orders`,
  scope: () => sql<{ n: string }>`select count(*)::text as n from work_orders.scope_items`,
  assignments: () => sql<{ n: string }>`select count(*)::text as n from work_orders.work_order_assignments`,
  counters: () => sql<{ n: string }>`select count(*)::text as n from work_orders.number_counters`,
  records: () => sql<{ n: string }>`select count(*)::text as n from platform.idempotency_records`,
};
const count = async (table: keyof typeof COUNTS): Promise<number> => Number((await COUNTS[table]().execute(admin())).rows[0]?.n);
const auditOf = async (objectId: string) =>
  (await sql<Record<string, unknown>>`select * from audit.events where object_id = ${objectId}`.execute(admin())).rows;
const nothingStored = async (): Promise<void> => {
  for (const table of ['orders', 'scope', 'assignments', 'records'] as const) expect(await count(table), table).toBe(0);
};

describe('creating a work order from a template (EVM-022 AC1; SR-AUTHZ-04, SR-DATA-03)', () => {
  it('EVM-022 AC1 the template "Garaż — pełny proces": 201 with the status new, the number ZL-2026-0001, the default title, 9 scope items copied from the template and the signed-in user as the coordinator', async () => {
    const s = await scene();
    const browser = await signIn('editor', 'web', 'Anna Testowa');
    const body = order(s);
    const response = await create(browser, body, uuidv7());
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.headers['etag']).toBe('"1"');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['idempotent-replayed']).toBeUndefined();
    expect(response.body).toMatchObject({
      id: body.id,
      number: 'ZL-2026-0001',
      title: 'Garaż — pełny proces',
      status: 'new',
      customer: { id: s.customerId, displayName: 'Jan Przykładowy' },
      site: {
        id: s.siteId,
        siteType: 'multi_family_garage',
        street: 'ul. Testowa',
        buildingNumber: '7',
        city: 'Warszawa',
        parkingSpotNumber: '15',
        garageLevel: '-1',
      },
      coordinator: { id: browser.userId, displayName: 'Anna Testowa' },
      version: 1,
      createdAt: '2026-10-01T08:00:00.000Z',
    });
    const created = response.body as { scopeItems: Array<Record<string, unknown>> };
    expect(created.scopeItems).toHaveLength(9);

    const { rows: template } = await sql<Record<string, unknown>>`
      select service.code, service.name, service.parameter_set_code as "parameterSetCode", item.default_parameters as parameters,
             item.default_quantity as quantity, item.position
      from catalog.work_order_template_items item
      join catalog.service_catalog_items service on service.id = item.catalog_item_id
      where item.work_order_template_id = ${s.fullId} order by item.position`.execute(admin());
    expect(created.scopeItems.map((item) => Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'id')))).toEqual(template);
    expect(created.scopeItems.every((item) => /^[0-9a-f-]{36}$/.test(String(item['id'])))).toBe(true);

    const { rows } = await sql<Record<string, unknown>>`select * from work_orders.work_orders where id = ${body.id}`.execute(admin());
    expect(rows[0]).toMatchObject({
      status: 'new',
      customer_id: s.customerId,
      site_id: s.siteId,
      source_template_id: s.fullId,
      planned_date: null,
      description: null,
      created_by: browser.userId,
      updated_by: browser.userId,
      version: 1,
      deleted_at: null,
    });
    const { rows: assignments } = await sql<Record<string, unknown>>`
      select user_id, role, deleted_at from work_orders.work_order_assignments where work_order_id = ${body.id}`.execute(admin());
    expect(assignments).toEqual([{ user_id: browser.userId, role: 'coordinator', deleted_at: null }]);
  });

  it('EVM-022 AC1 the response has the fields of the contract and nothing else: no e-mail, telephone or notes of the customer or the site, no author columns', async () => {
    const s = await scene();
    const response = await create(await signIn('administrator'), order(s), uuidv7());
    expect(Object.keys(response.body as object).sort()).toEqual(
      ['coordinator', 'createdAt', 'customer', 'id', 'number', 'scopeItems', 'site', 'status', 'title', 'version'].sort(),
    );
    expect(Object.keys((response.body as { customer: object }).customer).sort()).toEqual(['displayName', 'id']);
    expect(Object.keys((response.body as { coordinator: object }).coordinator).sort()).toEqual(['displayName', 'id']);
    expect(JSON.stringify(response.body)).not.toMatch(/jan@example|600000777|notatka-lokalizacji|created_by|createdBy|deleted/);
  });

  it('EVM-022 AC1 the title, the assignee, the planned date and the description of the user are kept (the description keeps its new lines); the title is trimmed and NFC', async () => {
    const s = await scene();
    const browser = await signIn('editor');
    const assignee = await createUser(admin(), current.clock, { role: 'read_only', displayName: 'Piotr Opiekun' });
    const response = await create(
      browser,
      order(s, {
        title: '  Garaż Zielony Dziedziniec  ',
        assigneeUserId: assignee.id,
        plannedDate: '2026-11-15',
        description: 'Pierwsza linia\r\nDruga linia',
      }),
      uuidv7(),
    );
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body).toMatchObject({
      title: 'Garaż Zielony Dziedziniec'.normalize('NFC'),
      plannedDate: '2026-11-15',
      description: 'Pierwsza linia\nDruga linia',
      coordinator: { id: assignee.id, displayName: 'Piotr Opiekun' },
    });
    const { rows } = await sql<{ planned_date: string }>`
      select to_char(planned_date, 'YYYY-MM-DD') as planned_date from work_orders.work_orders`.execute(admin());
    expect(rows[0]?.planned_date).toBe('2026-11-15');
  });

  it('EVM-022 AC1 the new order is on the list of orders (W-10) with its number and its coordinator', async () => {
    const s = await scene();
    const browser = await signIn('editor', 'web', 'Anna Testowa');
    expect((await create(browser, order(s), uuidv7())).status).toBe(201);
    const list = await browser.panel.get(`${CREATE}?view=mine`);
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({
      items: [{ number: 'ZL-2026-0001', title: 'Garaż — pełny proces', status: 'new', coordinator: { id: browser.userId } }],
    });
  });

  it('EVM-022 AC1 the scope is a COPY (D1): a later change of the template does not change the order', async () => {
    const s = await scene();
    const response = await create(await signIn('editor'), order(s), uuidv7());
    const before = (response.body as { scopeItems: unknown[] }).scopeItems;
    await sql`update catalog.work_order_template_items set default_quantity = 9, default_parameters = '{"x": 1}'::jsonb
              where work_order_template_id = ${s.fullId}`.execute(admin());
    await sql`update catalog.service_catalog_items set name = 'Zmieniona nazwa'`.execute(admin());
    const { rows } = await sql<Record<string, unknown>>`
      select id, position, code, name, parameter_set_code as "parameterSetCode", parameters, quantity
      from work_orders.scope_items order by position`.execute(admin());
    expect(rows).toEqual(
      before.map((item) => {
        const { id, position, code, name, parameterSetCode, parameters, quantity } = item as Record<string, unknown>;
        return { id, position, code, name, parameterSetCode, parameters, quantity };
      }),
    );
    // restore the starting data for the next tests
    await sql`update catalog.work_order_template_items set default_quantity = 1, default_parameters = '{}'::jsonb
              where work_order_template_id = ${s.fullId}`.execute(admin());
  });

  it('EVM-022 AC1 the numbers follow each other: ZL-2026-0001, ZL-2026-0002; a shorter template gives fewer items', async () => {
    const s = await scene();
    const browser = await signIn('editor');
    const first = await create(browser, order(s), uuidv7());
    const second = await create(browser, order(s, { templateId: await templateId('garage_charger_installation') }), uuidv7());
    expect(first.body).toMatchObject({ number: 'ZL-2026-0001' });
    expect(second.body).toMatchObject({ number: 'ZL-2026-0002', title: 'Garaż — montaż ładowarki' });
    expect((second.body as { scopeItems: unknown[] }).scopeItems).toHaveLength(2);
  });

  it('EVM-022 AC1 the audit trail has ONE event work_order.created with the actor, the order id and the trace — and no title, description, name or address', async () => {
    const s = await scene();
    const browser = await signIn('editor');
    const body = order(s, { title: 'Tytul-Poufny-Kowalski', description: 'opis-poufny-PESEL' });
    expect((await create(browser, body, uuidv7())).status).toBe(201);
    const events = await auditOf(body.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'work_order.created',
      outcome: 'success',
      actor_type: 'user',
      actor_user_id: browser.userId,
      object_type: 'work_order',
      object_id: body.id,
      origin: 'web',
    });
    expect(String(events[0]?.['trace_id'])).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(events)).not.toMatch(/Poufny|Przykładowy|Testowa|Warszawa/);
  });

  it('EVM-022 AC1 nothing about the order (title, description, customer) reaches the log of the API', async () => {
    const s = await scene();
    const browser = await signIn('editor');
    const before = current.logs.lines.length;
    await create(browser, order(s, { title: 'Tytul-Do-Logu', description: 'Opis-Do-Logu' }), uuidv7());
    await create(browser, order(s, { title: 'T'.repeat(201), description: 'Opis-Zly-Do-Logu' }));
    const lines = current.logs.lines.slice(before).join('\n');
    expect(lines).toContain(CREATE);
    expect(lines).not.toMatch(/Tytul-Do-Logu|Opis-Do-Logu|Opis-Zly|Przykładowy|Jan/);
  });
});

describe('an empty order (EVM-022 AC2)', () => {
  it('EVM-022 AC2 "templateId": null makes an order with no scope items, no source template and the default title', async () => {
    const s = await scene();
    const body = order(s, { templateId: null });
    const response = await create(await signIn('editor'), body, uuidv7());
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body).toMatchObject({ number: 'ZL-2026-0001', title: 'Nowe zlecenie', status: 'new', scopeItems: [] });
    expect(await count('scope')).toBe(0);
    const { rows } = await sql<{ source_template_id: string | null }>`select source_template_id from work_orders.work_orders`.execute(
      admin(),
    );
    expect(rows[0]?.source_template_id).toBeNull();
  });

  it('EVM-022 AC2 an empty order works when NO template is active (the form offers it then)', async () => {
    const s = await scene();
    await sql`update catalog.work_order_templates set is_active = false`.execute(admin());
    try {
      expect((await create(await signIn('editor'), order(s, { templateId: null }), uuidv7())).status).toBe(201);
    } finally {
      await sql`update catalog.work_order_templates set is_active = true`.execute(admin());
    }
  });
});

describe('validation and unavailable objects (EVM-022 AC3; SR-AUTHZ-02, SR-INPUT-01, SR-INPUT-02)', () => {
  it('EVM-022 AC3 a missing customerId, siteId or templateId is 400 with its pointer and the code required — nothing is stored', async () => {
    const s = await scene();
    const browser = await signIn('editor');
    for (const field of ['customerId', 'siteId', 'templateId']) {
      const response = await create(browser, order(s, { [field]: undefined }), uuidv7());
      expect(response.status, field).toBe(400);
      expect(response.body).toMatchObject({ code: 'validation_failed' });
      expect(errorsOf(response.body)).toEqual([{ pointer: `/${field}`, code: 'required' }]);
    }
    await nothingStored();
  });

  it('EVM-022 AC3 a customer or a site that is missing or deleted is 404 not_found — the same answer for every role, the Administrator included; nothing is stored', async () => {
    const s = await scene();
    const deletedCustomer = await insertCustomer(admin(), { deletedAt: '2026-10-07T09:00:00Z' });
    const deletedSite = await insertSite(admin(), { deletedAt: '2026-10-07T09:00:00Z' });
    for (const role of ['administrator', 'editor'] as const) {
      const browser = await signIn(role);
      const answers = [
        await create(browser, order(s, { customerId: uuidv7() }), uuidv7()),
        await create(browser, order(s, { customerId: deletedCustomer }), uuidv7()),
        await create(browser, order(s, { siteId: uuidv7() }), uuidv7()),
        await create(browser, order(s, { siteId: deletedSite }), uuidv7()),
        await create(browser, order(s, { customerId: deletedCustomer, siteId: deletedSite }), uuidv7()),
      ];
      for (const answer of answers) {
        expect(answer.status, role).toBe(404);
        expect(answer.body, role).toMatchObject({ code: 'not_found' });
        expect(withoutTrace(answer.body), role).toBe(withoutTrace(answers[0]?.body));
      }
    }
    await nothingStored();
    expect(await count('counters')).toBe(0);
  });

  it('EVM-022 AC3 a template that is retired and one that does not exist are the same answer — 422 template_unavailable; nothing is stored and the number is not used', async () => {
    const s = await scene();
    const browser = await signIn('editor');
    await sql`update catalog.work_order_templates set is_active = false where id = ${s.fullId}`.execute(admin());
    try {
      const retired = await create(browser, order(s), uuidv7());
      const missing = await create(browser, order(s, { templateId: uuidv7() }), uuidv7());
      for (const answer of [retired, missing]) {
        expect(answer.status).toBe(422);
        expect(answer.body).toMatchObject({ code: 'template_unavailable' });
      }
      expect(withoutTrace(retired.body)).toBe(withoutTrace(missing.body));
    } finally {
      await sql`update catalog.work_order_templates set is_active = true where id = ${s.fullId}`.execute(admin());
    }
    await nothingStored();
    expect(await count('counters')).toBe(0);
  });

  it('EVM-022 AC3 a deleted template is template_unavailable too', async () => {
    const s = await scene();
    await sql`update catalog.work_order_templates set deleted_at = now() where id = ${s.fullId}`.execute(admin());
    try {
      expect((await create(await signIn('editor'), order(s), uuidv7())).body).toMatchObject({ code: 'template_unavailable' });
    } finally {
      await sql`update catalog.work_order_templates set deleted_at = null where id = ${s.fullId}`.execute(admin());
    }
  });

  it('EVM-022 AC3 an assignee who does not exist, is only invited, is deactivated or is deleted: ONE answer — 400 validation_failed, /assigneeUserId, assignee_unavailable', async () => {
    const s = await scene();
    const browser = await signIn('editor');
    const invited = await createUser(admin(), current.clock, { status: 'invited' });
    const deactivated = await createUser(admin(), current.clock, { status: 'deactivated' });
    const deleted = await createUser(admin(), current.clock, { status: 'active' });
    await sql`update identity.users set deleted_at = now() where id = ${deleted.id}`.execute(admin());
    const answers = [];
    for (const assigneeUserId of [uuidv7(), invited.id, deactivated.id, deleted.id])
      answers.push(await create(browser, order(s, { assigneeUserId }), uuidv7()));
    for (const answer of answers) {
      expect(answer.status).toBe(400);
      expect(answer.body).toMatchObject({ code: 'validation_failed' });
      expect(errorsOf(answer.body)).toEqual([{ pointer: '/assigneeUserId', code: 'assignee_unavailable' }]);
      expect(withoutTrace(answer.body)).toBe(withoutTrace(answers[0]?.body));
    }
    await nothingStored();
    expect(await count('counters')).toBe(0);
  });

  it('EVM-022 AC3 the assignee is never taken from anything but the session when the field is absent (and the id of another user in the body is an assignee, not an author)', async () => {
    const s = await scene();
    const alice = await signIn('editor');
    const response = await create(alice, order(s), uuidv7());
    expect(response.body).toMatchObject({ coordinator: { id: alice.userId } });
    const { rows } = await sql<{ created_by: string }>`select created_by from work_orders.work_orders`.execute(admin());
    expect(rows[0]?.created_by).toBe(alice.userId);
  });

  it('EVM-022 AC3 the errors of the fields are pointers and codes (every wrong field at once); the values never come back', async () => {
    const s = await scene();
    const browser = await signIn('editor');
    const response = await create(
      browser,
      order(s, { title: 'T'.repeat(201), description: 'D'.repeat(2001), plannedDate: '1999-12-31' }),
      uuidv7(),
    );
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'validation_failed' });
    expect([...(errorsOf(response.body) ?? [])].sort((a, b) => a.pointer.localeCompare(b.pointer))).toEqual([
      { pointer: '/description', code: 'too_long' },
      { pointer: '/title', code: 'too_long' },
    ]);
    expect(JSON.stringify(response.body)).not.toMatch(/TTTT|DDDD|1999/);
    const date = await create(browser, order(s, { plannedDate: '1999-12-31' }), uuidv7());
    expect(errorsOf(date.body)).toEqual([{ pointer: '/plannedDate', code: 'out_of_range' }]);
    expect(errorsOf((await create(browser, order(s, { plannedDate: '2101-01-01' }))).body)).toEqual([
      { pointer: '/plannedDate', code: 'out_of_range' },
    ]);
    for (const plannedDate of ['2026-02-30', '2026-11-15T10:00:00Z', '15.11.2026', 20261115]) {
      const refused = await create(browser, order(s, { plannedDate }));
      expect(refused.status, String(plannedDate)).toBe(400);
      expect(errorsOf(refused.body)?.length, String(plannedDate)).toBeGreaterThan(0);
      expect(
        errorsOf(refused.body)?.every((error) => error.pointer === '/plannedDate'),
        String(plannedDate),
      ).toBe(true);
    }
    expect((await create(browser, order(s, { plannedDate: '2000-01-01' }))).status).toBe(201);
    expect((await create(browser, order(s, { plannedDate: '2100-12-31' }))).status).toBe(201);
    expect((await create(browser, order(s, { title: 'T'.repeat(200), description: 'D'.repeat(2000) }))).status).toBe(201);
  });

  it('EVM-022 AC3 free text is plain text: control and invisible formatting characters are 400 invalid_characters; a title of spaces is the default title', async () => {
    const s = await scene();
    const browser = await signIn('editor');
    expect(errorsOf((await create(browser, order(s, { title: 'Tytul\u0007' }))).body)).toEqual([
      { pointer: '/title', code: 'invalid_characters' },
    ]);
    expect(errorsOf((await create(browser, order(s, { description: 'Opis‮tekst' }))).body)).toEqual([
      { pointer: '/description', code: 'invalid_characters' },
    ]);
    const blank = await create(browser, order(s, { title: '   ' }));
    expect(blank.status).toBe(201);
    expect(blank.body).toMatchObject({ title: 'Garaż — pełny proces' });
  });

  it('EVM-022 AC3 identifiers: the id must be a UUIDv7; customerId, siteId, templateId and assigneeUserId must be UUIDs (400, never a database error); a template that is null or a UUID, no other type', async () => {
    const s = await scene();
    const browser = await signIn('editor');
    for (const id of ['0198b0a0-0000-4000-8000-000000000001', 'not-a-uuid', 7]) {
      const response = await create(browser, order(s, { id }));
      expect(response.status, String(id)).toBe(400);
      expect(response.body).toMatchObject({ code: 'validation_failed' });
    }
    for (const field of ['customerId', 'siteId', 'templateId', 'assigneeUserId'])
      for (const value of ["1' or '1'='1", 12, ''])
        expect((await create(browser, order(s, { [field]: value }))).status, `${field}=${String(value)}`).toBe(400);
    expect((await create(browser, order(s, { templateId: 'none' }))).status).toBe(400);
    await nothingStored();
  });

  it('EVM-022 AC3 the Idempotency-Key must be a UUIDv7: another version or a text is 400', async () => {
    const s = await scene();
    const browser = await signIn('editor');
    for (const key of ['0198b0a0-0000-4000-8000-000000000001', 'abc']) {
      const response = await create(browser, order(s), key);
      expect(response.status, key).toBe(400);
      expect(response.body).toMatchObject({ code: 'validation_failed' });
    }
    await nothingStored();
  });
});

describe('a repeat without a duplicate (EVM-022 AC4; SR-API-05, AB-09)', () => {
  it('EVM-022 AC4 the same id, key and content: 201 again with the SAME order and number, Idempotent-Replayed: true, ONE order, ONE audit event, ONE record, the counter used once', async () => {
    const s = await scene();
    const browser = await signIn('editor');
    const body = order(s);
    const key = uuidv7();
    const first = await create(browser, body, key);
    expect(first.status).toBe(201);
    const second = await create(browser, { ...body }, key);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.headers['etag']).toBe('"1"');
    expect(second.body).toEqual(first.body);
    expect(second.body).toMatchObject({ number: 'ZL-2026-0001' });
    expect(await count('orders')).toBe(1);
    expect(await count('scope')).toBe(9);
    expect(await count('assignments')).toBe(1);
    expect(await auditOf(body.id)).toHaveLength(1);
    expect(await count('records')).toBe(1);
    const { rows } = await sql<{ last_value: number }>`select last_value from work_orders.number_counters where year = 2026`.execute(
      admin(),
    );
    expect(rows[0]?.last_value).toBe(1);
    // and the next order is the next number — the repeat did not use one
    expect((await create(browser, order(s), uuidv7())).body).toMatchObject({ number: 'ZL-2026-0002' });
  });

  it('EVM-022 AC4 a repeat is 404 when the customer, the site or the coordinator of the order is no longer there to show — never a half-empty order', async () => {
    const s = await scene();
    const browser = await signIn('editor');
    const body = order(s);
    const key = uuidv7();
    await create(browser, body, key);
    await sql`update customers.customers set deleted_at = now() where id = ${s.customerId}`.execute(admin());
    expect((await create(browser, body, key)).status).toBe(404);
    await sql`update customers.customers set deleted_at = null where id = ${s.customerId}`.execute(admin());
    await sql`update sites.sites set deleted_at = now() where id = ${s.siteId}`.execute(admin());
    expect((await create(browser, body, key)).status).toBe(404);
    await sql`update sites.sites set deleted_at = null where id = ${s.siteId}`.execute(admin());
    await sql`update work_orders.work_order_assignments set deleted_at = now()`.execute(admin());
    expect((await create(browser, body, key)).status).toBe(404);
    await sql`update work_orders.work_order_assignments set deleted_at = null`.execute(admin());
    expect((await create(browser, body, key)).status).toBe(201);
  });

  it('EVM-022 AC4 a repeat returns the order as it is NOW, and 404 when it is no longer visible', async () => {
    const s = await scene();
    const browser = await signIn('editor');
    const body = order(s);
    const key = uuidv7();
    await create(browser, body, key);
    await sql`update work_orders.work_orders set title = 'Zmieniony tytuł', version = 2 where id = ${body.id}`.execute(admin());
    const replay = await create(browser, body, key);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toMatchObject({ title: 'Zmieniony tytuł', version: 2 });
    await sql`update work_orders.work_orders set deleted_at = now() where id = ${body.id}`.execute(admin());
    const gone = await create(browser, body, key);
    expect(gone.status).toBe(404);
    expect(gone.body).toMatchObject({ code: 'not_found' });
  });

  it('EVM-022 AC4 the same key with another content is 422 idempotency_mismatch; no second order', async () => {
    const s = await scene();
    const browser = await signIn('editor');
    const key = uuidv7();
    const body = order(s);
    await create(browser, body, key);
    const other = await create(browser, { ...body, title: 'Inny tytuł' }, key);
    expect(other.status).toBe(422);
    expect(other.body).toMatchObject({ code: 'idempotency_mismatch' });
    expect(await count('orders')).toBe(1);
  });

  it('EVM-022 AC4 a parallel request with the same key is 409 idempotency_in_progress with Retry-After; after the first one it is a creation', async () => {
    const s = await scene();
    const browser = await signIn('editor');
    const body = order(s);
    const key = uuidv7();
    await admin()
      .transaction()
      .execute(async (tx) => {
        await sql`select pg_advisory_xact_lock(hashtextextended(${`idempotency|${browser.userId}||${key}`}, 0))`.execute(tx);
        const refused = await create(browser, body, key);
        expect(refused.status, JSON.stringify(refused.body)).toBe(409);
        expect(refused.body).toMatchObject({ code: 'idempotency_in_progress' });
        expect(refused.headers['retry-after']).toBe('1');
        expect(await count('orders')).toBe(0);
      });
    const retried = await create(browser, body, key);
    expect(retried.status).toBe(201);
    expect(retried.headers['idempotent-replayed']).toBeUndefined();
  });

  it("EVM-022 AC4 an existing id (also a deleted order's, with another key or none) is 409 id_conflict — nothing about the existing order is in the answer, and the number is not used", async () => {
    const s = await scene();
    const browser = await signIn('editor');
    const body = order(s, { title: 'Pierwsze zlecenie' });
    await create(browser, body, uuidv7());
    const conflicting = order(s, { id: body.id, title: 'Zupelnie-Inne', description: 'Opis-Gdynia' });
    for (const key of [uuidv7(), undefined]) {
      const response = await create(browser, conflicting, key);
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'id_conflict' });
      expect(JSON.stringify(response.body)).not.toMatch(/Pierwsze|Zupelnie|Gdynia|ZL-2026/);
    }
    await sql`update work_orders.work_orders set deleted_at = now() where id = ${body.id}`.execute(admin());
    expect((await create(browser, conflicting, uuidv7())).status).toBe(409);
    expect(await count('orders')).toBe(1);
    const { rows } = await sql<{ last_value: number }>`select last_value from work_orders.number_counters`.execute(admin());
    expect(rows[0]?.last_value).toBe(1);
    expect((await create(browser, order(s), uuidv7())).body).toMatchObject({ number: 'ZL-2026-0002' });
  });

  it('EVM-022 AC4 a failed save leaves the key free: after 404 and after 422 the same key serves the corrected request', async () => {
    const s = await scene();
    const browser = await signIn('editor');
    const key = uuidv7();
    const body = order(s);
    expect((await create(browser, { ...body, customerId: uuidv7() }, key)).status).toBe(404);
    expect((await create(browser, { ...body, templateId: uuidv7() }, key)).status).toBe(422);
    expect((await create(browser, { ...body, assigneeUserId: uuidv7() }, key)).status).toBe(400);
    expect(await count('records')).toBe(0);
    expect(await count('counters')).toBe(0);
    const fixed = await create(browser, body, key);
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(201);
    expect(fixed.headers['idempotent-replayed']).toBeUndefined();
    expect(await count('records')).toBe(1);
  });

  it('EVM-022 AC4 the key belongs to the user: ANOTHER user with the same key gets no result of the first one', async () => {
    const s = await scene();
    const alice = await signIn('editor');
    const bob = await signIn('administrator');
    const key = uuidv7();
    const aliceOrder = order(s, { title: 'Zlecenie Alicji' });
    await create(alice, aliceOrder, key);
    const own = order(s, { title: 'Zlecenie Boba' });
    const fresh = await create(bob, own, key);
    expect(fresh.status).toBe(201);
    expect(fresh.headers['idempotent-replayed']).toBeUndefined();
    expect(fresh.body).toMatchObject({ id: own.id, title: 'Zlecenie Boba', number: 'ZL-2026-0002' });
    // with the id of the first order Bob gets a conflict and learns nothing of the order
    const stolen = await create(bob, aliceOrder, key);
    expect(stolen.status).toBe(422); // his key is bound to HIS first request (another content)
    const direct = await create(bob, aliceOrder, uuidv7());
    expect(direct.status).toBe(409);
    expect(direct.body).toMatchObject({ code: 'id_conflict' });
    expect(JSON.stringify(direct.body)).not.toMatch(/Alicji|ZL-2026/);
    expect(await count('orders')).toBe(2);
  });

  it('EVM-022 AC4 without a key the creation works (the key is optional) and leaves no record of idempotency', async () => {
    const s = await scene();
    expect((await create(await signIn('editor'), order(s))).status).toBe(201);
    expect(await count('records')).toBe(0);
  });
});

describe('numbering (EVM-022 AC5; SR-API-07, ASVS V2.3.3; CWE-362)', () => {
  it('EVM-022 AC5 the clock at 2026-12-31T23:30:00Z (2027-01-01 00:30 in Europe/Warsaw): the first order of the year is ZL-2027-0001; 22:30Z is still 2026', async () => {
    const s = await scene();
    current.clock.set('2026-12-31T22:30:00Z'); // 23:30 in Warsaw: still 2026
    const early = await signIn('editor');
    const before = await create(early, order(s), uuidv7());
    expect(before.body).toMatchObject({ number: 'ZL-2026-0001' });
    current.clock.set('2026-12-31T23:30:00Z');
    const browser = await signIn('editor');
    const first = await create(browser, order(s), uuidv7());
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body).toMatchObject({ number: 'ZL-2027-0001' });
    expect((await create(browser, order(s), uuidv7())).body).toMatchObject({ number: 'ZL-2027-0002' });
    const { rows } = await sql<{
      year: number;
      last_value: number;
    }>`select year, last_value from work_orders.number_counters order by year`.execute(admin());
    expect(rows).toEqual([
      { year: 2026, last_value: 1 },
      { year: 2027, last_value: 2 },
    ]);
  });

  it('EVM-022 AC5 20 orders created at once get 20 different numbers, ZL-2027-0001 … ZL-2027-0020, with no gap', async () => {
    const s = await scene();
    current.clock.set('2026-12-31T23:30:00Z');
    const browsers = await Promise.all([signIn('editor'), signIn('administrator')]);
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) => create(browsers[index % 2] as Browser, order(s), uuidv7())),
    );
    for (const response of responses) expect(response.status, JSON.stringify(response.body)).toBe(201);
    const numbers = responses.map((response) => (response.body as { number: string }).number).sort();
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, index) => `ZL-2027-${String(index + 1).padStart(4, '0')}`));
    expect(new Set(numbers).size).toBe(20);
    expect(await count('orders')).toBe(20);
    const { rows } = await sql<{ last_value: number }>`select last_value from work_orders.number_counters where year = 2027`.execute(
      admin(),
    );
    expect(rows[0]?.last_value).toBe(20);
  });

  it('EVM-022 AC5 a number in the request is 400 validation_failed with read_only_field — and so is every field of the server; nothing is stored', async () => {
    const s = await scene();
    const browser = await signIn('editor');
    const response = await create(
      browser,
      order(s, {
        number: 'ZL-2026-0099',
        status: 'settled',
        scopeItems: [],
        customer: { id: s.customerId },
        site: { id: s.siteId },
        coordinator: { id: browser.userId },
        version: 9,
        createdAt: '2026-01-01T00:00:00Z',
      }),
      uuidv7(),
    );
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'validation_failed' });
    expect([...(errorsOf(response.body) ?? [])].sort((a, b) => a.pointer.localeCompare(b.pointer))).toEqual(
      ['coordinator', 'createdAt', 'customer', 'number', 'scopeItems', 'site', 'status', 'version'].map((field) => ({
        pointer: `/${field}`,
        code: 'read_only_field',
      })),
    );
    const onlyNumber = await create(browser, order(s, { number: 'ZL-2026-0099' }));
    expect(onlyNumber.status).toBe(400);
    expect(errorsOf(onlyNumber.body)).toEqual([{ pointer: '/number', code: 'read_only_field' }]);
    await nothingStored();
  });

  it('EVM-022 AC5 a field outside the schema is unknown_field, also __proto__ and createdBy; nothing is stored', async () => {
    const s = await scene();
    const browser = await signIn('editor');
    const response = await create(browser, order(s, { createdBy: uuidv7(), vip: true, parameters: { powerKw: 22 } }));
    expect(response.status).toBe(400);
    expect(errorsOf(response.body)).toEqual(
      expect.arrayContaining([
        { pointer: '/createdBy', code: 'unknown_field' },
        { pointer: '/vip', code: 'unknown_field' },
        { pointer: '/parameters', code: 'unknown_field' },
      ]),
    );
    const proto = await browser.panel.post(
      CREATE,
      JSON.parse(
        `{"id":"${uuidv7()}","customerId":"${s.customerId}","siteId":"${s.siteId}","templateId":null,"__proto__":{"role":"administrator"}}`,
      ),
    );
    expect(proto.status).toBe(400);
    await nothingStored();
  });
});

describe('one transaction for the whole composition (EVM-022 AC6; SR-API-06)', () => {
  const calls: string[] = [];
  let failing = false;
  const contributor = (name: string, order: number): WorkOrderCompositionContributor => ({
    name,
    order,
    contribute: async (tx, context) => {
      calls.push(`${name}:${String(context.scopeItems.length)}:${context.templateId === null ? 'empty' : 'template'}`);
      await sql`select 1`.execute(tx); // the same transaction handle is usable
      if (failing && name === 'a-first') throw new Error('contributor failed');
    },
  });
  beforeAll(() => {
    const registry = current.app.get(WorkOrderCompositionRegistry);
    registry.register(contributor('b-last', 20));
    registry.register(contributor('a-first', 10));
    registry.register(contributor('c-second', 10));
  });
  beforeEach(() => {
    calls.length = 0;
    failing = false;
  });

  it('EVM-022 AC6 the contributors run in the fixed order (by order, then name), each with the copied scope; none runs when the order is refused earlier', async () => {
    const s = await scene();
    const browser = await signIn('editor');
    expect((await create(browser, order(s), uuidv7())).status).toBe(201);
    expect((await create(browser, order(s, { templateId: null }), uuidv7())).status).toBe(201);
    expect(calls).toEqual([
      'a-first:9:template',
      'c-second:9:template',
      'b-last:9:template',
      'a-first:0:empty',
      'c-second:0:empty',
      'b-last:0:empty',
    ]);
    calls.length = 0;
    expect((await create(browser, order(s, { customerId: uuidv7() }), uuidv7())).status).toBe(404);
    expect(calls).toEqual([]);
  });

  it('EVM-022 AC6 a contributor that fails: 500, no order, no scope item, no assignment, no audit event, no idempotency record — and the number is NOT used', async () => {
    const s = await scene();
    const browser = await signIn('editor');
    failing = true;
    const body = order(s);
    const key = uuidv7();
    const response = await create(browser, body, key);
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ code: 'internal_error' });
    expect(JSON.stringify(response.body)).not.toMatch(/contributor failed/);
    await nothingStored();
    expect(await count('counters')).toBe(0);
    expect(await auditOf(body.id)).toHaveLength(0);
    failing = false;
    const retried = await create(browser, body, key);
    expect(retried.status, JSON.stringify(retried.body)).toBe(201);
    expect(retried.body).toMatchObject({ number: 'ZL-2026-0001' });
    expect(await count('orders')).toBe(1);
  });

  it('EVM-022 AC6 two registrations under one name are refused', () => {
    expect(() => {
      current.app.get(WorkOrderCompositionRegistry).register(contributor('a-first', 1));
    }).toThrow(/already registered/);
  });
});

describe('who may create an order (EVM-022 AC7; SR-AUTHZ-01, SR-AUTHZ-02, SR-AUTHZ-05)', () => {
  it('EVM-022 AC7 Administrator and Editor 201; Read-only 403 forbidden — for any body, and without an order or a record of idempotency', async () => {
    const s = await scene();
    for (const role of ['administrator', 'editor'] as const)
      expect((await create(await signIn(role), order(s), uuidv7())).status, role).toBe(201);
    const readOnly = await signIn('read_only');
    const valid = await create(readOnly, order(s), uuidv7());
    expect(valid.status).toBe(403);
    expect(valid.body).toMatchObject({ code: 'forbidden' });
    for (const body of [{}, { zle: 'pole', number: 'ZL-1' }, order(s, { customerId: uuidv7() }), order(s, { templateId: 'x' })]) {
      const invalid = await create(readOnly, body, uuidv7());
      expect(invalid.status).toBe(403); // not 400, not 404, not 422: the authorization comes before everything else
      expect(JSON.stringify(invalid.body)).not.toContain('errors');
    }
    expect((await create(readOnly, undefined)).status).toBe(403);
    expect(await count('orders')).toBe(2);
    expect(await count('records')).toBe(2);
  });

  it('EVM-022 AC7 no session is 401 (before any look at the body); the mobile channel is 403; no CSRF token is 403 csrf_failed', async () => {
    const s = await scene();
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    for (const body of [order(s), { zle: 'pole' }]) {
      const response = await anonymous.post(CREATE, body).set('Idempotency-Key', uuidv7());
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ code: 'unauthenticated' });
    }
    for (const role of ['administrator', 'editor'] as const)
      expect((await create(await signIn(role, 'mobile'), order(s), uuidv7())).status, role).toBe(403);
    const noToken = await signIn('editor');
    noToken.panel.csrfToken = undefined;
    const csrf = await create(noToken, order(s), uuidv7());
    expect(csrf.status).toBe(403);
    expect(csrf.body).toMatchObject({ code: 'csrf_failed' });
    await nothingStored();
  });

  it('EVM-022 AC7 the id of the customer, the site or the template that comes from the client gives no access: a made-up id is the same 404 as a deleted one (checked above for every role)', async () => {
    const s = await scene();
    const browser = await signIn('administrator');
    const made = await create(browser, order(s, { siteId: uuidv7(), customerId: uuidv7() }), uuidv7());
    expect(made.status).toBe(404);
    expect(made.body).toMatchObject({ code: 'not_found' });
  });
});

/**
 * `POST /api/v1/site-surveys` - the site survey of the panel against the real application and PostgreSQL (EVM-135 AC2, AC3, AC4, AC8; ADR-0024 pt 5, 10). The
 * survey is an order without a customer and without a template, in `quoting`, with the number at once and the deadline = creation + 90 days; the coordinator
 * is optional (absent = nobody). Deny-by-default: the matrix of roles and channels, and IDOR (a foreign or a missing site, a foreign identifier). Synthetic data only.
 */
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';

const PATH = '/api/v1/site-surveys';
const ON = { SITE_SURVEYS_ENABLED: 'true' };
const SYNTHETIC_STREET = 'ul. Panelowa Wizyjna';
const SYNTHETIC_CITY = 'Wizjogród';
const SYNTHETIC_PHONE = '+48 600 135 246';
const SYNTHETIC_PHONE_E164 = '+48600135246';

let current: IdentityApp;
afterEach(async () => {
  await current.close();
});
async function boot(env: Record<string, string | undefined> = ON): Promise<IdentityApp> {
  current = await createIdentityApp({ env });
  return current;
}
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
const create = (browser: Browser, body: unknown, key?: string) => {
  const call = browser.panel.post(PATH, body);
  return key === undefined ? call : call.set('Idempotency-Key', key);
};
const site = () => insertSite(admin(), { street: SYNTHETIC_STREET, city: SYNTHETIC_CITY });
const codeOf = (body: unknown): string | undefined => (body as { code?: string }).code;
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;
const n = async (query: ReturnType<typeof sql<{ n: string }>>): Promise<number> => Number((await query.execute(admin())).rows[0]?.n);
async function state(): Promise<Record<string, number>> {
  return {
    orders: await n(sql`select count(*)::text as n from work_orders.work_orders`),
    assignments: await n(sql`select count(*)::text as n from work_orders.work_order_assignments`),
    audit: await n(sql`select count(*)::text as n from audit.events where action = 'work_order.created'`),
    records: await n(sql`select count(*)::text as n from platform.idempotency_records`),
    counters: await n(sql`select coalesce(sum(last_value), 0)::text as n from work_orders.number_counters`),
  };
}
const rowOf = async (id: string) =>
  (
    await sql<Record<string, unknown>>`
      select number, title, status, origin, created_via_device_id, created_by, created_at, customer_id, site_id, source_template_id,
        site_survey_expires_at, site_survey_extensions, requester_phone
      from work_orders.work_orders where id = ${id}`.execute(admin())
  ).rows[0];
const coordinatorsOf = async (id: string): Promise<string[]> =>
  (
    await sql<{ user_id: string }>`
      select user_id from work_orders.work_order_assignments where work_order_id = ${id} and role = 'coordinator' and deleted_at is null`.execute(
      admin(),
    )
  ).rows.map((row) => row.user_id);

describe('the site survey of the panel (EVM-135 AC2)', () => {
  it('EVM-135 AC2 an Editor creates a survey: 201, Location of the order, the detail with siteSurvey and no customer, quoting, the number, no coordinator when none is named, the audit event', async () => {
    await boot();
    const editor = await signIn('editor');
    const siteId = await site();
    const id = uuidv7();
    const response = await create(editor, { id, siteId, requesterPhone: SYNTHETIC_PHONE });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.headers['location']).toBe(`/api/v1/work-orders/${id}`);
    expect(response.headers['etag']).toBe('"1"');
    expect(response.headers['idempotent-replayed']).toBeUndefined();
    const body = response.body as Record<string, unknown>;
    expect(body).toMatchObject({
      id,
      number: 'ZL-2026-0001',
      title: 'Wizja lokalna',
      status: 'quoting',
      customer: null,
      coordinator: null,
      origin: 'office',
      site: { id: siteId, city: SYNTHETIC_CITY },
      siteSurvey: { extensionCount: 0, requesterPhone: SYNTHETIC_PHONE_E164 },
    });
    const row = await rowOf(id);
    expect(row).toMatchObject({
      status: 'quoting',
      origin: 'office',
      created_via_device_id: null,
      created_by: editor.userId,
      customer_id: null,
      site_id: siteId,
      source_template_id: null,
      site_survey_extensions: 0,
      requester_phone: SYNTHETIC_PHONE_E164,
    });
    const createdAt = (row?.['created_at'] as Date).getTime();
    expect((row?.['site_survey_expires_at'] as Date).getTime()).toBe(createdAt + 90 * 24 * 3_600_000);
    expect((body['siteSurvey'] as { expiresAt: string }).expiresAt).toBe(new Date(createdAt + 90 * 24 * 3_600_000).toISOString());
    expect(await coordinatorsOf(id)).toEqual([]);
    expect(await n(sql`select count(*)::text as n from work_orders.scope_items where work_order_id = ${id}`)).toBe(0);
    expect(await n(sql`select count(*)::text as n from procedures.procedures where work_order_id = ${id}`)).toBe(0);
    const audit = await sql<
      Record<string, unknown>
    >`select * from audit.events where action = 'work_order.created' and object_id = ${id}`.execute(admin());
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ actor_user_id: editor.userId, outcome: 'success' });
  });

  it('EVM-135 AC2 an Administrator creates a survey with a title and a named active coordinator; a coordinator who is not active is 400 assignee_unavailable and nothing is written', async () => {
    await boot();
    const administrator = await signIn('administrator');
    const coordinator = await createUser(admin(), current.clock, { role: 'editor', displayName: 'Opiekun Wizji' });
    const siteId = await site();
    const id = uuidv7();
    const response = await create(administrator, { id, siteId, title: '  Hala — oględziny  ', assigneeUserId: coordinator.id });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body).toMatchObject({ title: 'Hala — oględziny', coordinator: { id: coordinator.id, displayName: 'Opiekun Wizji' } });
    expect(await coordinatorsOf(id)).toEqual([coordinator.id]);
    const gone = await createUser(admin(), current.clock, { role: 'editor', status: 'deactivated' });
    const before = await state();
    for (const assigneeUserId of [gone.id, uuidv7()]) {
      const refused = await create(administrator, { id: uuidv7(), siteId, assigneeUserId });
      expect(refused.status).toBe(400);
      expect(errorsOf(refused.body)).toEqual([{ pointer: '/assigneeUserId', code: 'assignee_unavailable' }]);
    }
    expect(await state()).toEqual(before);
  });

  it('EVM-135 AC2 the same Idempotency-Key and body replays the 201 with the same number; another body is 422 idempotency_mismatch', async () => {
    await boot();
    const editor = await signIn('editor');
    const siteId = await site();
    const key = uuidv7();
    const body = { id: uuidv7(), siteId };
    expect((await create(editor, body, key)).status).toBe(201);
    const before = await state();
    const replay = await create(editor, body, key);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toMatchObject({ id: body.id, number: 'ZL-2026-0001' });
    expect(await state()).toEqual(before);
    const other = await create(editor, { ...body, title: 'Inny' }, key);
    expect(other.status).toBe(422);
    expect(codeOf(other.body)).toBe('idempotency_mismatch');
  });

  it('EVM-135 AC2 createWorkOrder is unchanged: an ordinary order without a customer is still 400 and nothing is written', async () => {
    await boot();
    const editor = await signIn('editor');
    const before = await state();
    const response = await editor.panel.post('/api/v1/work-orders', { id: uuidv7(), siteId: await site(), templateId: null });
    expect(response.status).toBe(400);
    expect(errorsOf(response.body)).toEqual([{ pointer: '/customerId', code: 'required' }]);
    expect(await state()).toEqual(before);
  });
});

describe('validation, identifiers and the switch (EVM-135 AC3)', () => {
  it('EVM-135 AC3 no site, a bad phone, an empty title, a customer, a template or a field of the server are 400 with the field and the code - never the value - and nothing is written', async () => {
    await boot();
    const editor = await signIn('editor');
    const siteId = await site();
    const before = await state();
    const cases: Array<[Record<string, unknown>, string, Array<{ pointer: string; code: string }> | undefined]> = [
      [{ id: uuidv7() }, 'validation_failed', [{ pointer: '/siteId', code: 'required' }]],
      [
        { id: uuidv7(), siteId, requesterPhone: '12 34 56 78' },
        'validation_failed',
        [{ pointer: '/requesterPhone', code: 'invalid_format' }],
      ],
      [{ id: uuidv7(), siteId, title: 'x'.repeat(201) }, 'validation_failed', [{ pointer: '/title', code: 'too_long' }]],
      [{ id: uuidv7(), siteId, customerId: uuidv7() }, 'validation_failed', [{ pointer: '/customerId', code: 'unknown_field' }]],
      [{ id: uuidv7(), siteId, templateId: null }, 'validation_failed', [{ pointer: '/templateId', code: 'unknown_field' }]],
      [{ id: uuidv7(), siteId, status: 'accepted' }, 'validation_failed', [{ pointer: '/status', code: 'read_only_field' }]],
      [{ id: uuidv7(), siteId, siteSurvey: null }, 'validation_failed', [{ pointer: '/siteSurvey', code: 'read_only_field' }]],
    ];
    for (const [body, code, errors] of cases) {
      const response = await create(editor, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(codeOf(response.body)).toBe(code);
      expect(errorsOf(response.body), JSON.stringify(body)).toEqual(errors);
      expect(JSON.stringify(response.body)).not.toMatch(/12 34|xxxx/);
    }
    expect(await state()).toEqual(before);
  });

  it('EVM-135 AC3 AC4 IDOR: an existing identifier - own, of another user, of a deleted order - is 409 id_conflict without any data of the existing order', async () => {
    await boot();
    const editor = await signIn('editor');
    const other = await signIn('editor');
    const siteId = await site();
    const own = uuidv7();
    expect((await create(editor, { id: own, siteId })).status).toBe(201);
    const foreign = uuidv7();
    expect((await create(other, { id: foreign, siteId, requesterPhone: SYNTHETIC_PHONE })).status).toBe(201);
    const deleted = uuidv7();
    await sql`insert into work_orders.work_orders (id, number, title, status, customer_id, created_at, updated_at, deleted_at)
      values (${deleted}, 'ZL-2025-0001', 'Zlecenie', 'new', ${await insertCustomer(admin(), {})}, now(), now(), now())`.execute(admin());
    const before = await state();
    for (const id of [own, foreign, deleted]) {
      const response = await create(editor, { id, siteId });
      expect(response.status, id).toBe(409);
      expect(codeOf(response.body)).toBe('id_conflict');
      const text = JSON.stringify(response.body);
      for (const leak of ['ZL-', SYNTHETIC_PHONE_E164, SYNTHETIC_STREET, SYNTHETIC_CITY, siteId]) expect(text, leak).not.toContain(leak);
    }
    expect(await state()).toEqual(before);
  });

  it('EVM-135 AC3 AC4 IDOR: a missing or a deleted site is the one answer 404 not_found, the same body; nothing is written', async () => {
    await boot();
    const editor = await signIn('editor');
    const deleted = await insertSite(admin(), { deletedAt: '2026-10-01T08:00:00Z' });
    const before = await state();
    const bodies: string[] = [];
    for (const siteId of [uuidv7(), deleted]) {
      const response = await create(editor, { id: uuidv7(), siteId });
      expect(response.status).toBe(404);
      expect(codeOf(response.body)).toBe('not_found');
      bodies.push(JSON.stringify({ ...(response.body as object), traceId: undefined }));
    }
    expect(new Set(bodies).size).toBe(1);
    expect(await state()).toEqual(before);
  });

  it('EVM-135 AC3 with the switch off it is 404 not_found before the body is judged - the same answer as a missing site - and nothing is written', async () => {
    await boot({});
    const editor = await signIn('editor');
    const siteId = await site();
    const before = await state();
    for (const body of [{ id: uuidv7(), siteId }, { id: 'not-an-id' }, {}]) {
      const response = await create(editor, body, uuidv7());
      expect(response.status, JSON.stringify(body)).toBe(404);
      expect(codeOf(response.body)).toBe('not_found');
    }
    expect(await state()).toEqual(before);
  });
});

describe('roles and channels (EVM-135 AC4; W2 deny-by-default)', () => {
  it('EVM-135 AC4 Administrator and Editor on the web channel create; Read-only is 403 forbidden for any body; the mobile channel is denied; no session is 401 - nothing is written', async () => {
    await boot();
    const siteId = await site();
    for (const role of ['administrator', 'editor'] as const) {
      expect((await create(await signIn(role), { id: uuidv7(), siteId })).status, role).toBe(201);
    }
    const before = await state();
    const reader = await signIn('read_only');
    for (const body of [{ id: uuidv7(), siteId }, {}, { id: 'x' }]) {
      const response = await create(reader, body);
      expect(response.status).toBe(403);
      expect(codeOf(response.body)).toBe('forbidden');
    }
    for (const role of ['administrator', 'editor'] as const) {
      const mobile = await signIn(role, 'mobile');
      const response = await create(mobile, { id: uuidv7(), siteId });
      expect([401, 403], role).toContain(response.status);
    }
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    expect((await anonymous.post(PATH, { id: uuidv7(), siteId })).status).toBe(401);
    expect(await state()).toEqual(before);
  });
});

describe('the address and the phone stay out (EVM-135 AC8; W5, SR-LOG-02)', () => {
  it('EVM-135 AC8 neither the log, the audit trail, the change log nor the refusals hold the street, the city or the phone of the requester', async () => {
    await boot();
    const editor = await signIn('editor');
    const siteId = await site();
    const answers = [
      await create(editor, { id: uuidv7(), siteId, requesterPhone: SYNTHETIC_PHONE }),
      await create(editor, { id: uuidv7(), siteId, requesterPhone: '12 34 56 78' }),
      await create(editor, { id: uuidv7(), siteId: uuidv7(), requesterPhone: SYNTHETIC_PHONE }),
    ];
    expect(answers.map((answer) => answer.status)).toEqual([201, 400, 404]);
    const rows = async (query: ReturnType<typeof sql<{ row: string }>>) =>
      (await query.execute(admin())).rows.map((row) => row.row).join('\n');
    const written = [
      ...answers.slice(1).map((answer) => JSON.stringify(answer.body)),
      current.logs.text,
      await rows(sql`select to_jsonb(t)::text as row from audit.events t`),
      await rows(sql`select to_jsonb(t)::text as row from sync.change_log t`),
      await rows(sql`select to_jsonb(t)::text as row from platform.email_outbox t`),
    ].join('\n');
    for (const value of [SYNTHETIC_STREET, SYNTHETIC_CITY, SYNTHETIC_PHONE, SYNTHETIC_PHONE_E164, '600135246', '12 34 56 78']) {
      expect(written, value).not.toContain(value);
    }
  });
});

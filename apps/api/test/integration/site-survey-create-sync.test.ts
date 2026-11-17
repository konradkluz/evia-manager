/**
 * `CreateSiteSurvey` v1 through `POST /api/v1/sync/mutations` against the real application and PostgreSQL (EVM-135 AC1, AC3, AC4, AC8; ADR-0024 pt 5, 10). The
 * survey is an order without a customer and without a template, in `quoting`, with the number at once and the deadline = creation + 90 days. Every result but
 * `applied` leaves nothing behind. Synthetic data only: the addresses and the telephone numbers are invented.
 */
import { sql, type RawBuilder } from 'kysely';
import type { Response } from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { IDEMPOTENCY_RETENTION_MS } from '../../src/platform/idempotency/idempotency.ts';
import type { IdentityApp } from '../support/identity-app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { enrolledAccount } from '../support/login-flows.ts';
import { newPhone, signedInPhone, type Phone } from '../support/mobile-flows.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { bootSync, counter, drain, editor, upsertOf } from '../support/sync-harness.ts';
import { addTotp, type TotpAccount } from '../support/totp-flows.ts';
import { uuidv7 } from '../support/uuid.ts';

const PATH = '/api/v1/sync/mutations';
const ON = { SITE_SURVEYS_ENABLED: 'true' };
const SYNTHETIC_STREET = 'ul. Wymyślona Wizyjna';
const SYNTHETIC_CITY = 'Oględzinowo';
const SYNTHETIC_POSTAL = '00-735';
const SYNTHETIC_PHONE = '600 735 135';
const SYNTHETIC_PHONE_E164 = '+48600735135';

let current: IdentityApp;
afterEach(async () => {
  await current.close();
});
async function boot(env: Record<string, string | undefined> = ON): Promise<IdentityApp> {
  current = (await bootSync(env)).app;
  return current;
}

const admin = () => current.database.admin;
interface Result {
  readonly mutationId: string;
  readonly outcome: string;
  readonly code?: string;
  readonly warnings?: string[];
  readonly workOrderNumber?: string;
  readonly errors?: Array<{ pointer: string; code: string }>;
}
const push = (phone: Phone, body: unknown) => phone.post(PATH, body, phone.authorised());
async function pushOne(phone: Phone, mutation: unknown): Promise<Result> {
  const response: Response = await push(phone, { mutations: [mutation] });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return (response.body as { results: Result[] }).results[0] as Result;
}

const newSite = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  siteType: 'single_family_house',
  street: SYNTHETIC_STREET,
  buildingNumber: '7',
  postalCode: SYNTHETIC_POSTAL,
  city: SYNTHETIC_CITY,
  ...overrides,
});
/** A survey of an existing site; `undefined` removes a field. */
const survey = (payload: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  mutationId: uuidv7(),
  type: 'CreateSiteSurvey',
  commandVersion: 1,
  payload: { workOrderId: uuidv7(), ...payload },
  ...extra,
});
const orderIdOf = (mutation: { payload: object }): string => String((mutation.payload as Record<string, unknown>)['workOrderId']);

const n = async (query: ReturnType<typeof sql<{ n: string }>>): Promise<number> => Number((await query.execute(admin())).rows[0]?.n);
/** What a rejected command must leave untouched, as one value. */
async function state(): Promise<Record<string, number>> {
  return {
    sites: await n(sql`select count(*)::text as n from sites.sites`),
    orders: await n(sql`select count(*)::text as n from work_orders.work_orders`),
    assignments: await n(sql`select count(*)::text as n from work_orders.work_order_assignments`),
    entries: await n(sql`select count(*)::text as n from timeline.timeline_entries`),
    changes: await n(sql`select count(*)::text as n from sync.change_log`),
    audit: await n(sql`select count(*)::text as n from audit.events where action not like 'sync.quota%'`),
    records: await n(sql`select count(*)::text as n from platform.idempotency_records`),
    counters: await n(sql`select coalesce(sum(last_value), 0)::text as n from work_orders.number_counters`),
  };
}
const orderRow = async (id: string): Promise<Record<string, unknown> | undefined> =>
  (
    await sql<Record<string, unknown>>`
      select number, title, status, origin, created_via_device_id, created_by, created_at, customer_id, site_id, source_template_id, description,
        planned_date, site_survey_expires_at, site_survey_extensions, requester_phone
      from work_orders.work_orders where id = ${id}`.execute(admin())
  ).rows[0];
const auditOf = async (action: string): Promise<Array<Record<string, unknown>>> =>
  (await sql<Record<string, unknown>>`select * from audit.events where action = ${action} order by occurred_at, id`.execute(admin())).rows;
async function administratorPhone(app: IdentityApp): Promise<Phone> {
  const enrolled = await enrolledAccount(app, { role: 'administrator' });
  const secret = await addTotp(app, enrolled);
  return signedInPhone(app, { ...enrolled, secret } as unknown as TotpAccount);
}

describe('the site survey from the phone (EVM-135 AC1)', () => {
  it('EVM-135 AC1 an Editor with a phone creates a survey of an existing site: quoting, ZL- number, no customer, no template, empty composition, deadline +90 days, the creator and coordinator, origin mobile_quick, the audit event and the change', async () => {
    const app = await boot();
    const siteId = await insertSite(admin(), {});
    const { account, phone } = await editor(app);
    const mutation = survey({ siteId, requesterPhone: SYNTHETIC_PHONE });
    expect(await pushOne(phone, mutation)).toEqual({
      mutationId: mutation.mutationId,
      outcome: 'applied',
      workOrderNumber: 'ZL-2026-0001',
    });
    const id = orderIdOf(mutation);
    const row = await orderRow(id);
    expect(row).toMatchObject({
      number: 'ZL-2026-0001',
      title: 'Wizja lokalna',
      status: 'quoting',
      origin: 'mobile_quick',
      created_via_device_id: phone.deviceId,
      created_by: account.user.id,
      customer_id: null,
      site_id: siteId,
      source_template_id: null,
      description: null,
      planned_date: null,
      site_survey_extensions: 0,
      requester_phone: SYNTHETIC_PHONE_E164,
    });
    const createdAt = (row?.['created_at'] as Date).getTime();
    expect((row?.['site_survey_expires_at'] as Date).getTime()).toBe(createdAt + 90 * 24 * 3_600_000);
    // an empty composition: no scope, no process, no milestone
    expect(await n(sql`select count(*)::text as n from work_orders.scope_items where work_order_id = ${id}`)).toBe(0);
    expect(await n(sql`select count(*)::text as n from procedures.procedures where work_order_id = ${id}`)).toBe(0);
    expect(await n(sql`select count(*)::text as n from payments.payment_milestones where work_order_id = ${id}`)).toBe(0);
    const coordinators = await sql<{ user_id: string }>`
      select user_id from work_orders.work_order_assignments where work_order_id = ${id} and role = 'coordinator' and deleted_at is null`.execute(
      admin(),
    );
    expect(coordinators.rows).toEqual([{ user_id: account.user.id }]);
    const applied = await auditOf('sync.mutation_applied');
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({
      object_type: 'work_order',
      object_id: id,
      work_order_id: id,
      device_id: phone.deviceId,
      command_type: 'CreateSiteSurvey',
      actor_user_id: account.user.id,
    });
    expect((await auditOf('work_order.created')).map((event) => event['object_id'])).toEqual([id]);
    // the survey is in the next pull of the phone of its creator, with siteSurvey and without a customer
    const pulled = await drain(phone);
    expect(upsertOf(pulled.changes, 'work_order', id)).toMatchObject({
      number: 'ZL-2026-0001',
      status: 'quoting',
      customerId: null,
      siteSurvey: { extensionCount: 0, requesterPhone: SYNTHETIC_PHONE_E164 },
    });
    expect(counter(app, 'sync_mutation_outcomes_total', { type: 'create_site_survey', outcome: 'applied', code: 'none' })).toBe(1);
  });

  it('EVM-135 AC1 an Administrator with a phone creates a survey with a new site and a title; the site is created with the device', async () => {
    const app = await boot();
    const phone = await administratorPhone(app);
    const site = newSite();
    const mutation = survey({ newSite: site, title: '  Garaż — oględziny  ' });
    expect((await pushOne(phone, mutation)).outcome).toBe('applied');
    expect(await orderRow(orderIdOf(mutation))).toMatchObject({
      title: 'Garaż — oględziny',
      site_id: site.id,
      customer_id: null,
      requester_phone: null,
    });
    const created = await sql<{
      created_via_device_id: string;
    }>`select created_via_device_id from sites.sites where id = ${site.id}`.execute(admin());
    expect(created.rows).toEqual([{ created_via_device_id: phone.deviceId }]);
  });

  it('EVM-135 AC1 the same command again is a duplicate with the same number and no second order or site; other content with the same mutationId is idempotency_mismatch', async () => {
    const app = await boot();
    const { phone } = await editor(app);
    const mutation = survey({ newSite: newSite() });
    expect((await pushOne(phone, mutation)).workOrderNumber).toBe('ZL-2026-0001');
    const before = await state();
    expect(await pushOne(phone, mutation)).toEqual({
      mutationId: mutation.mutationId,
      outcome: 'duplicate',
      workOrderNumber: 'ZL-2026-0001',
    });
    expect(await state()).toEqual(before);
    const changed = { ...mutation, payload: { ...mutation.payload, title: 'Inny tytuł' } };
    expect(await pushOne(phone, changed)).toEqual({ mutationId: mutation.mutationId, outcome: 'rejected', code: 'idempotency_mismatch' });
    expect(await state()).toEqual(before);
  });

  it('EVM-135 AC1 after the record expired a retry of the own survey (same user and device) is a duplicate with idempotency_expired and the number; another user is id_conflict', async () => {
    const app = await boot();
    const siteId = await insertSite(admin(), {});
    const { phone } = await editor(app);
    const colleague = await editor(app);
    const mutation = survey({ siteId });
    expect((await pushOne(phone, mutation)).outcome).toBe('applied');
    // the record of idempotency has expired and been purged; the survey is older than the retention
    await sql`update work_orders.work_orders set created_at = ${new Date(app.clock.now().getTime() - IDEMPOTENCY_RETENTION_MS - 60_000)} where id = ${orderIdOf(mutation)}`.execute(
      admin(),
    );
    await sql`delete from platform.idempotency_records`.execute(admin());
    const before = await state();
    const retried = { ...mutation, mutationId: uuidv7() };
    expect(await pushOne(phone, retried)).toEqual({
      mutationId: retried.mutationId,
      outcome: 'duplicate',
      warnings: ['idempotency_expired'],
      workOrderNumber: 'ZL-2026-0001',
    });
    expect(await pushOne(colleague.phone, { ...mutation, mutationId: uuidv7() })).toMatchObject({
      outcome: 'conflict',
      code: 'id_conflict',
    });
    expect(await state()).toEqual(before);
  });

  it('EVM-135 AC1 a new site of a survey counts in the limit of 20 new sites per device shared with CreateQuickWorkOrder; the 21st is quota_exceeded and writes nothing', async () => {
    const app = await boot();
    const { phone } = await editor(app);
    for (let from = 0; from < 20; from += 10) {
      const response = await push(phone, { mutations: Array.from({ length: 10 }, () => survey({ newSite: newSite() })) });
      expect((response.body as { results: Result[] }).results.every((result) => result.outcome === 'applied')).toBe(true);
    }
    const before = await state();
    const extra = survey({ newSite: newSite() });
    expect(await pushOne(phone, extra)).toEqual({ mutationId: extra.mutationId, outcome: 'rejected', code: 'quota_exceeded' });
    expect(await state()).toEqual(before);
    expect((await auditOf('sync.quota_exceeded')).map((event) => event['quota_kind'])).toEqual(['site']);
    // EVM-140 AC4: the phone has 20 open surveys now (the limit of open surveys); one is deleted here, so only the limit of NEW SITES is under test below
    await sql`update work_orders.work_orders set deleted_at = now() where id = (select id from work_orders.work_orders order by number limit 1)`.execute(
      admin(),
    );
    // a survey of an existing site is not limited, and the number of the refused command was not used
    const existing = survey({ siteId: await insertSite(admin(), {}) });
    expect(await pushOne(phone, existing)).toMatchObject({ outcome: 'applied', workOrderNumber: 'ZL-2026-0021' });
  });

  it('EVM-135 AC1 CreateQuickWorkOrder is unchanged: without a customer it is still validation_failed at /customerId', async () => {
    const app = await boot();
    const { phone } = await editor(app);
    const quick = {
      mutationId: uuidv7(),
      type: 'CreateQuickWorkOrder',
      commandVersion: 1,
      payload: { workOrderId: uuidv7(), templateId: uuidv7(), title: 'Montaż', siteId: await insertSite(admin(), {}) },
    };
    expect(await pushOne(phone, quick)).toMatchObject({
      outcome: 'rejected',
      code: 'validation_failed',
      errors: [{ pointer: '/customerId', code: 'exactly_one_of' }],
    });
  });
});

describe('validation, identifiers and the switch (EVM-135 AC3)', () => {
  it('EVM-135 AC3 no site, both sites, a phone that is no number, a customer or a template in the payload are validation_failed with the field and the code - nothing written, never the value', async () => {
    const app = await boot();
    const siteId = await insertSite(admin(), {});
    const { phone } = await editor(app);
    const before = await state();
    const cases: Array<[Record<string, unknown>, Array<{ pointer: string; code: string }>]> = [
      [{}, [{ pointer: '/siteId', code: 'exactly_one_of' }]],
      [{ siteId, newSite: newSite() }, [{ pointer: '/siteId', code: 'exactly_one_of' }]],
      [{ siteId, requesterPhone: '12 34 56 78' }, [{ pointer: '/requesterPhone', code: 'invalid_format' }]],
      [{ siteId, customerId: uuidv7() }, [{ pointer: '', code: 'unknown_field' }]],
      [{ siteId, templateId: uuidv7() }, [{ pointer: '', code: 'unknown_field' }]],
      [{ newSite: newSite({ postalCode: '00735' }) }, [{ pointer: '/newSite/postalCode', code: 'invalid_format' }]],
    ];
    for (const [payload, errors] of cases) {
      const result = await pushOne(phone, survey(payload));
      expect(result, JSON.stringify(payload)).toMatchObject({ outcome: 'rejected', code: 'validation_failed', errors });
      expect(JSON.stringify(result)).not.toMatch(/12 34|00735|Wymyślona/);
    }
    expect(await state()).toEqual(before);
  });

  it('EVM-135 AC3 an existing identifier - an own order, a foreign one, a deleted one - is the same id_conflict and changes nothing; the same identifier for the order and the new site too', async () => {
    const app = await boot();
    const siteId = await insertSite(admin(), {});
    const { phone } = await editor(app);
    const other = await editor(app);
    const own = survey({ siteId });
    expect((await pushOne(phone, own)).outcome).toBe('applied');
    const foreign = survey({ siteId });
    expect((await pushOne(other.phone, foreign)).outcome).toBe('applied');
    const customerId = await insertCustomer(admin(), {});
    const deletedId = uuidv7();
    await sql`insert into work_orders.work_orders (id, number, title, status, customer_id, created_at, updated_at, deleted_at)
      values (${deletedId}, 'ZL-2025-0001', 'Zlecenie', 'new', ${customerId}, now(), now(), now())`.execute(admin());
    const before = await state();
    for (const id of [orderIdOf(foreign), deletedId]) {
      expect(await pushOne(phone, survey({ workOrderId: id, siteId }))).toMatchObject({ outcome: 'conflict', code: 'id_conflict' });
    }
    // an own survey under ANOTHER mutation identifier (a new command for the same order) is a conflict too - only a retry of the same command is a duplicate
    expect(await pushOne(phone, survey({ workOrderId: orderIdOf(own), siteId }))).toMatchObject({
      outcome: 'conflict',
      code: 'id_conflict',
    });
    const same = uuidv7();
    expect(await pushOne(phone, survey({ workOrderId: same, newSite: newSite({ id: same }) }))).toMatchObject({
      outcome: 'conflict',
      code: 'id_conflict',
    });
    expect(await state()).toEqual(before);
  });

  it('EVM-135 AC3 a missing or deleted site is the one answer target_unavailable and changes nothing', async () => {
    const app = await boot();
    const { phone } = await editor(app);
    const deleted = await insertSite(admin(), { deletedAt: '2026-10-01T08:00:00Z' });
    const before = await state();
    for (const siteId of [uuidv7(), deleted]) {
      expect(await pushOne(phone, survey({ siteId }))).toMatchObject({ outcome: 'rejected', code: 'target_unavailable' });
    }
    expect(await state()).toEqual(before);
  });

  it('EVM-135 AC3 with the switch off the command is rejected feature_disabled - before the payload is judged; nothing is written, no number is used, no record of idempotency', async () => {
    const app = await boot({});
    const siteId = await insertSite(admin(), {});
    const { phone } = await editor(app);
    const before = await state();
    for (const mutation of [survey({ siteId }), survey({ newSite: newSite() }), survey({})]) {
      expect(await pushOne(phone, mutation)).toEqual({ mutationId: mutation.mutationId, outcome: 'rejected', code: 'feature_disabled' });
    }
    expect(await state()).toEqual(before);
    expect(
      counter(app, 'sync_mutation_outcomes_total', { type: 'create_site_survey', outcome: 'rejected', code: 'feature_disabled' }),
    ).toBe(3);
  });
});

describe('roles and sessions (EVM-135 AC4)', () => {
  it('EVM-135 AC4 Read-only (after a change of the role) is 403 forbidden and no token 401 - with no effect', async () => {
    const app = await boot();
    const siteId = await insertSite(admin(), {});
    const demoted = await editor(app);
    await sql`update identity.users set role = 'read_only' where id = ${demoted.account.user.id}`.execute(admin());
    const before = await state();
    const denied = await push(demoted.phone, { mutations: [survey({ siteId })] });
    expect(denied.status).toBe(403);
    expect((denied.body as { code: string }).code).toBe('forbidden');
    expect((await newPhone(app).post(PATH, { mutations: [survey({ siteId })] }, {})).status).toBe(401);
    expect(await state()).toEqual(before);
  });
});

describe('the address and the phone stay out (EVM-135 AC8; W5, SR-LOG-02)', () => {
  it('EVM-135 AC8 neither the log, the audit trail, the change log, the alerts, the e-mail outbox nor the answers hold the street, the city, the postal code or the phone of the requester', async () => {
    const app = await boot();
    const { phone } = await editor(app);
    const responses = [
      await push(phone, {
        mutations: [survey({ newSite: newSite(), requesterPhone: SYNTHETIC_PHONE }), survey({ requesterPhone: '12 34 56 78' })],
      }),
    ];
    // a refusal by the limit writes an alert and an audit event: 20 new sites first
    for (let from = 0; from < 20; from += 10) {
      responses.push(
        await push(phone, { mutations: Array.from({ length: 10 }, () => survey({ newSite: newSite(), requesterPhone: SYNTHETIC_PHONE })) }),
      );
    }
    const rowsOf = async (query: RawBuilder<{ row: string }>) => (await query.execute(admin())).rows.map((row) => row.row).join('\n');
    const written = [
      ...responses.map((response) => JSON.stringify(response.body)),
      app.logs.text,
      await rowsOf(sql`select to_jsonb(t)::text as row from audit.events t`),
      await rowsOf(sql`select to_jsonb(t)::text as row from sync.change_log t`),
      await rowsOf(sql`select to_jsonb(t)::text as row from platform.security_alert_outbox t`),
      await rowsOf(sql`select to_jsonb(t)::text as row from platform.email_outbox t`),
    ].join('\n');
    expect(written).toContain('quota_exceeded');
    for (const value of [
      SYNTHETIC_STREET,
      'Wymyślona',
      SYNTHETIC_CITY,
      SYNTHETIC_POSTAL,
      SYNTHETIC_PHONE,
      SYNTHETIC_PHONE_E164,
      '600735135',
      '12 34 56 78',
    ]) {
      expect(written, value).not.toContain(value);
    }
    // the phone is not in the search text of the order either (DO-K)
    expect(await n(sql`select count(*)::text as n from work_orders.work_orders where search_text like '%600735135%'`)).toBe(0);
  });
});

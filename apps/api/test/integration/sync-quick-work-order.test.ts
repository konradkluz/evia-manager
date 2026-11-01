/**
 * `CreateQuickWorkOrder` through `POST /api/v1/sync/mutations` against the real application and PostgreSQL (EVM-099). Synthetic data only: the names, the
 * telephone numbers and the addresses are invented. The command is judged in ONE transaction: every result but `applied` leaves nothing behind.
 */
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { IDEMPOTENCY_RETENTION_MS } from '../../src/platform/idempotency/idempotency.ts';
import type { IdentityApp } from '../support/identity-app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { MOBILE, newPhone, setDeviceState, signedInPhone, type Phone } from '../support/mobile-flows.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { bootSync, counter, drain, editor, upsertOf } from '../support/sync-harness.ts';
import { enrolledAccount } from '../support/login-flows.ts';
import { addTotp, nextStep, totpAccount, type TotpAccount } from '../support/totp-flows.ts';
import { uuidv7 } from '../support/uuid.ts';

const PATH = '/api/v1/sync/mutations';
const FULL = 'garage_full_process';
const SYNTHETIC_PHONE = '600 000 731';
const SYNTHETIC_PHONE_E164 = '+48600000731';
const SYNTHETIC_NAME = 'Zofia Wymyślona';
const SYNTHETIC_STREET = 'ul. Zmyślona';
const SYNTHETIC_TITLE = 'Montaż wallboxa u Wymyślonej';
const SYNTHETIC_NOTE = 'Klientka prosi o telefon po szesnastej.';

let current: IdentityApp;
afterEach(async () => {
  await current.close();
});
async function boot(env: Record<string, string | undefined> = {}): Promise<IdentityApp> {
  current = (await bootSync(env)).app;
  return current;
}

const admin = () => current.database.admin;
const problemOf = (response: Response): string => (response.body as { code: string }).code;
interface Result {
  readonly mutationId: string;
  readonly outcome: string;
  readonly code?: string;
  readonly warnings?: string[];
  readonly workOrderNumber?: string;
  readonly errors?: Array<{ pointer: string; code: string }>;
}
const resultsOf = (response: Response): Result[] => (response.body as { results: Result[] }).results;
const noStore = (response: Response): void => {
  expect(response.headers['cache-control']).toBe('no-store');
};
const push = (phone: Phone, body: unknown) => phone.post(PATH, body, phone.authorised());
async function pushOne(phone: Phone, mutation: unknown): Promise<Result> {
  const response = await push(phone, { mutations: [mutation] });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  noStore(response);
  return resultsOf(response)[0] as Result;
}

const templateId = async (code: string): Promise<string> =>
  (await sql<{ id: string }>`select id from catalog.work_order_templates where code = ${code}`.execute(admin())).rows[0]?.id ?? '';

interface Scene {
  readonly customerId: string;
  readonly siteId: string;
  readonly templateId: string;
}
async function scene(): Promise<Scene> {
  return {
    customerId: await insertCustomer(admin(), { firstName: 'Jan', lastName: 'Przykładowy', phone: '+48600000777' }),
    siteId: await insertSite(admin(), {}),
    templateId: await templateId(FULL),
  };
}

const newCustomer = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  kind: 'person',
  displayName: SYNTHETIC_NAME,
  phone: SYNTHETIC_PHONE,
  ...overrides,
});
const newSite = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  siteType: 'single_family_house',
  street: SYNTHETIC_STREET,
  buildingNumber: '12',
  postalCode: '00-950',
  city: 'Fikcyjnowo',
  ...overrides,
});
/** A command for the existing customer and site of the scene; `undefined` removes a field. */
const quick = (s: Scene, payload: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  mutationId: uuidv7(),
  type: 'CreateQuickWorkOrder',
  commandVersion: 1,
  payload: {
    workOrderId: uuidv7(),
    templateId: s.templateId,
    title: SYNTHETIC_TITLE,
    customerId: s.customerId,
    siteId: s.siteId,
    ...payload,
  },
  ...extra,
});
/** A command that creates its customer and its site. */
const quickNew = (s: Scene, payload: Record<string, unknown> = {}) =>
  quick(s, { customerId: undefined, siteId: undefined, newCustomer: newCustomer(), newSite: newSite(), ...payload });
const orderIdOf = (mutation: { payload: object }): string => String((mutation.payload as Record<string, unknown>)['workOrderId']);
const objectIdOf = (mutation: { payload: object }, key: 'newCustomer' | 'newSite'): string =>
  ((mutation.payload as unknown as Record<string, { id: string }>)[key] as { id: string }).id;
const note = (workOrderId: string) => ({
  mutationId: uuidv7(),
  type: 'CreateNote',
  commandVersion: 1,
  payload: {
    id: uuidv7(),
    workOrderId,
    noteCategory: 'site_visit',
    body: 'Sprawdzono miejsce pod wallbox.',
    capturedAt: new Date(current.clock.now().getTime() - 60_000).toISOString(),
  },
});

const n = async (query: ReturnType<typeof sql<{ n: string }>>): Promise<number> => Number((await query.execute(admin())).rows[0]?.n);
/** What a rejected command must leave untouched, as one value. */
async function state(): Promise<Record<string, number>> {
  return {
    customers: await n(sql`select count(*)::text as n from customers.customers`),
    sites: await n(sql`select count(*)::text as n from sites.sites`),
    orders: await n(sql`select count(*)::text as n from work_orders.work_orders`),
    scope: await n(sql`select count(*)::text as n from work_orders.scope_items`),
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
      select id, number, title, status, origin, created_via_device_id, created_by, customer_id, site_id, source_template_id, description, planned_date
      from work_orders.work_orders where id = ${id}`.execute(admin())
  ).rows[0];
const customerRow = async (id: string): Promise<Record<string, unknown> | undefined> =>
  (await sql<Record<string, unknown>>`select * from customers.customers where id = ${id}`.execute(admin())).rows[0];
const siteRow = async (id: string): Promise<Record<string, unknown> | undefined> =>
  (await sql<Record<string, unknown>>`select * from sites.sites where id = ${id}`.execute(admin())).rows[0];
const auditOf = async (action: string): Promise<Array<Record<string, unknown>>> =>
  (await sql<Record<string, unknown>>`select * from audit.events where action = ${action} order by occurred_at, id`.execute(admin())).rows;

describe('the order from existing objects (EVM-099 AC1)', () => {
  it('EVM-099 AC1 an Editor with a phone creates the order: new, the composition of the template, origin mobile_quick, the number and the device, the note as the first entry, the audit event and the changes', async () => {
    const app = await boot();
    const s = await scene();
    const { account, phone } = await editor(app);
    const mutation = quick(s, { note: SYNTHETIC_NOTE });
    const result = await pushOne(phone, mutation);
    expect(result).toEqual({ mutationId: mutation.mutationId, outcome: 'applied', workOrderNumber: 'ZL-2026-0001' });
    const id = orderIdOf(mutation);
    expect(await orderRow(id)).toMatchObject({
      number: 'ZL-2026-0001',
      title: SYNTHETIC_TITLE,
      status: 'new',
      origin: 'mobile_quick',
      created_via_device_id: phone.deviceId,
      created_by: account.user.id,
      customer_id: s.customerId,
      site_id: s.siteId,
      source_template_id: s.templateId,
    });
    expect(await n(sql`select count(*)::text as n from work_orders.scope_items where work_order_id = ${id}`)).toBe(9);
    expect(await n(sql`select count(*)::text as n from procedures.procedures where work_order_id = ${id}`)).toBe(9);
    expect(
      await n(
        sql`select count(*)::text as n from work_orders.work_order_assignments where work_order_id = ${id} and user_id = ${account.user.id}`,
      ),
    ).toBe(1);

    const { rows: entries } = await sql<Record<string, unknown>>`
      select kind, note_category, body, origin, captured_at, created_by, created_via_device_id, event_code
      from timeline.timeline_entries where work_order_id = ${id} order by created_at, id`.execute(admin());
    const manual = entries.filter((entry) => entry['kind'] === 'note');
    expect(manual).toEqual([
      {
        kind: 'note',
        note_category: 'other',
        body: SYNTHETIC_NOTE,
        origin: 'mobile',
        captured_at: null,
        created_by: account.user.id,
        created_via_device_id: phone.deviceId,
        event_code: null,
      },
    ]);
    expect(entries.some((entry) => entry['event_code'] === 'work_order_created')).toBe(true);

    const applied = await auditOf('sync.mutation_applied');
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({
      object_type: 'work_order',
      object_id: id,
      work_order_id: id,
      device_id: phone.deviceId,
      command_type: 'CreateQuickWorkOrder',
      actor_user_id: account.user.id,
    });
    expect((await auditOf('work_order.created')).map((event) => event['object_id'])).toEqual([id]);
    expect(
      await n(sql`select count(*)::text as n from sync.change_log where entity_type = 'work_order' and entity_id = ${id}`),
    ).toBeGreaterThanOrEqual(1);

    // the order is in the next pull of the phone and in the panel
    const pulled = await drain(phone);
    expect(upsertOf(pulled.changes, 'work_order', id)).toMatchObject({ number: 'ZL-2026-0001', status: 'new', title: SYNTHETIC_TITLE });
    const detail = await account.panel.get(`/api/v1/work-orders/${id}`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body).toMatchObject({ origin: 'mobile_quick', number: 'ZL-2026-0001' });
  });

  it('EVM-099 AC1 the composition is the one of the panel: the same scope, processes, stages and payment plan for the same template', async () => {
    const app = await boot();
    const s = await scene();
    const { account, phone } = await editor(app);
    const mutation = quick(s);
    expect((await pushOne(phone, mutation)).outcome).toBe('applied');
    const panelId = uuidv7();
    const created = await account.panel
      .post('/api/v1/work-orders', { id: panelId, customerId: s.customerId, siteId: s.siteId, templateId: s.templateId })
      .set('Idempotency-Key', uuidv7());
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const shape = async (id: string) => ({
      scope: (
        await sql<Record<string, unknown>>`
          select position, code, name, parameter_set_code, parameters, quantity, notes
          from work_orders.scope_items where work_order_id = ${id} order by position`.execute(admin())
      ).rows,
      procedures: (
        await sql<Record<string, unknown>>`
          select p.code, p.name, s.position, s.name as stage, s.status
          from procedures.procedures p join procedures.procedure_stages s on s.procedure_id = p.id
          where p.work_order_id = ${id} order by p.code, s.position`.execute(admin())
      ).rows,
      milestones: (
        await sql<Record<string, unknown>>`
          select position, name, status, amount_minor
          from payments.payment_milestones where work_order_id = ${id} order by position`.execute(admin())
      ).rows,
    });
    const quickShape = await shape(orderIdOf(mutation));
    expect(quickShape.scope.length).toBeGreaterThan(0);
    expect(quickShape).toEqual(await shape(panelId));
    const panelRow = await orderRow(panelId);
    expect(panelRow).toMatchObject({ origin: 'office', created_via_device_id: null });
  });
});

describe('a new customer and a new site (EVM-099 AC2, AC3)', () => {
  it('EVM-099 AC2 a new customer and a new site are created from the fields of the command only, with the device; the telephone is E.164 and the name of a person is split at the last space', async () => {
    const app = await boot();
    const s = await scene();
    const { account, phone } = await editor(app);
    const mutation = quickNew(s, {
      newCustomer: newCustomer({ displayName: 'Anna Maria Wymyślona', phone: '0048 600-000-731' }),
      newSite: newSite({ apartmentNumber: '5', siteType: 'multi_family_garage', parkingSpotNumber: 'P-15' }),
    });
    const payload = { newCustomer: { id: objectIdOf(mutation, 'newCustomer') }, newSite: { id: objectIdOf(mutation, 'newSite') } };
    expect((await pushOne(phone, mutation)).outcome).toBe('applied');
    expect(await customerRow(payload.newCustomer.id)).toMatchObject({
      kind: 'person',
      first_name: 'Anna Maria',
      last_name: 'Wymyślona',
      company_name: null,
      phone: SYNTHETIC_PHONE_E164,
      email: null,
      tax_id: null,
      street: null,
      notes: null,
      created_by: account.user.id,
      created_via_device_id: phone.deviceId,
      anonymized_at: null,
      deleted_at: null,
    });
    expect(await siteRow(payload.newSite.id)).toMatchObject({
      site_type: 'multi_family_garage',
      street: SYNTHETIC_STREET,
      building_number: '12',
      apartment_number: '5',
      postal_code: '00-950',
      city: 'Fikcyjnowo',
      parking_spot_number: 'P-15',
      garage_level: null,
      connection_power_kw: null,
      metering_point_id: null,
      distribution_system_operator_party_id: null,
      manager_party_id: null,
      notes: null,
      created_via_device_id: phone.deviceId,
    });
    expect(await orderRow(orderIdOf(mutation))).toMatchObject({ customer_id: payload.newCustomer.id, site_id: payload.newSite.id });
    expect((await auditOf('customer.created')).map((event) => event['object_id'])).toEqual([payload.newCustomer.id]);
    expect((await auditOf('site.created')).map((event) => event['object_id'])).toEqual([payload.newSite.id]);
  });

  it('EVM-099 AC2 the telephone written as 9 digits, with +48, with 0048, with spaces or hyphens is the same E.164 number; a company keeps its name; a new customer with an existing site and the other way round', async () => {
    const app = await boot();
    const s = await scene();
    const { phone } = await editor(app);
    const writings = ['600000731', '+48 600 000 731', '0048600000731', '600-000-731', '(600) 000 731'];
    for (const writing of writings) {
      const mutation = quick(s, { customerId: undefined, newCustomer: newCustomer({ phone: writing }) });
      expect((await pushOne(phone, mutation)).outcome, writing).toBe('applied');
      const id = objectIdOf(mutation, 'newCustomer');
      expect((await customerRow(id))?.['phone'], writing).toBe(SYNTHETIC_PHONE_E164);
    }
    const company = quick(s, {
      customerId: undefined,
      newCustomer: newCustomer({ kind: 'company', displayName: 'Firma Fikcyjna sp. z o.o.' }),
    });
    expect((await pushOne(phone, company)).outcome).toBe('applied');
    const companyId = objectIdOf(company, 'newCustomer');
    expect(await customerRow(companyId)).toMatchObject({ kind: 'company', company_name: 'Firma Fikcyjna sp. z o.o.', first_name: null });
    const mixed = quick(s, { siteId: undefined, newSite: newSite() });
    expect((await pushOne(phone, mixed)).outcome).toBe('applied');
    expect(await orderRow(orderIdOf(mixed))).toMatchObject({ customer_id: s.customerId });
  });

  it('EVM-099 AC3 a customer with the same telephone and name, and a site with the same address, are separate rows - no warning, no merge, nothing changed', async () => {
    const app = await boot();
    const s = await scene();
    const { phone } = await editor(app);
    const existing = await insertCustomer(admin(), { firstName: 'Zofia', lastName: 'Wymyślona', phone: SYNTHETIC_PHONE_E164 });
    const existingSite = await insertSite(admin(), {
      street: SYNTHETIC_STREET,
      buildingNumber: '12',
      postalCode: '00-950',
      city: 'Fikcyjnowo',
    });
    const before = [await customerRow(existing), await siteRow(existingSite)];
    const first = quickNew(s);
    const second = quickNew(s);
    const response = await push(phone, { mutations: [first, second] });
    expect(resultsOf(response).map((result) => [result.outcome, result.warnings, result.code])).toEqual([
      ['applied', undefined, undefined],
      ['applied', undefined, undefined],
    ]);
    const created = [first, second].map((m) => objectIdOf(m, 'newCustomer'));
    expect(new Set(created).size).toBe(2);
    expect(await n(sql`select count(*)::text as n from customers.customers where phone = ${SYNTHETIC_PHONE_E164}`)).toBe(3);
    expect(await n(sql`select count(*)::text as n from sites.sites where street = ${SYNTHETIC_STREET}`)).toBe(3);
    expect([await customerRow(existing), await siteRow(existingSite)]).toEqual(before);
  });
});

describe('INSERT only and atomicity (EVM-099 AC4)', () => {
  it('EVM-099 AC4 an identifier of the order, of the new customer or of the new site that exists - own, foreign, deleted, anonymized - is the same conflict id_conflict and changes nothing', async () => {
    const app = await boot();
    const s = await scene();
    const { account, phone } = await editor(app);
    const stranger = await totpAccount(app, { role: 'editor' });
    const foreignOrder = uuidv7();
    await sql`insert into work_orders.work_orders (id, number, title, status, customer_id, site_id, created_at, created_by, updated_at, updated_by)
      values (${foreignOrder}, 'ZL-2026-0900', 'Cudze', 'new', ${s.customerId}, ${s.siteId}, ${current.clock.now()}, ${stranger.user.id}, ${current.clock.now()}, ${stranger.user.id})`.execute(
      admin(),
    );
    const deletedOrder = uuidv7();
    await sql`insert into work_orders.work_orders (id, number, title, status, customer_id, site_id, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by)
      values (${deletedOrder}, 'ZL-2026-0901', 'Usunięte', 'new', ${s.customerId}, ${s.siteId}, ${current.clock.now()}, ${account.user.id}, ${current.clock.now()}, ${account.user.id}, ${current.clock.now()}, ${account.user.id})`.execute(
      admin(),
    );
    const deletedCustomer = await insertCustomer(admin(), { deletedAt: '2026-10-08T08:00:00Z' });
    const anonymizedCustomer = await insertCustomer(admin(), {});
    await sql`update customers.customers set first_name = 'Klient', last_name = 'zanonimizowany', phone = '+48000000000', anonymized_at = now(), anonymized_by = ${account.user.id} where id = ${anonymizedCustomer}`.execute(
      admin(),
    );
    const deletedSite = await insertSite(admin(), { deletedAt: '2026-10-08T08:00:00Z' });
    const before = await state();

    const cases: Array<[string, ReturnType<typeof quick>]> = [
      ['foreign order', quick(s, { workOrderId: foreignOrder })],
      ['deleted order', quick(s, { workOrderId: deletedOrder })],
      ['existing customer id', quickNew(s, { newCustomer: newCustomer({ id: s.customerId }) })],
      ['deleted customer id', quickNew(s, { newCustomer: newCustomer({ id: deletedCustomer }) })],
      ['anonymized customer id', quickNew(s, { newCustomer: newCustomer({ id: anonymizedCustomer }) })],
      ['existing site id', quickNew(s, { newSite: newSite({ id: s.siteId }) })],
      ['deleted site id', quickNew(s, { newSite: newSite({ id: deletedSite }) })],
    ];
    const batch = await push(phone, { mutations: cases.map(([, mutation]) => mutation) });
    expect(batch.status).toBe(200);
    for (const [index, result] of resultsOf(batch).entries()) {
      expect(result, cases[index]?.[0]).toEqual({ mutationId: cases[index]?.[1].mutationId, outcome: 'conflict', code: 'id_conflict' });
    }
    expect(await state()).toEqual(before);

    // the same identifier twice in one command (the order and the customer, the order and the site, the customer and the site)
    const twice = uuidv7();
    const dup = [
      quickNew(s, { workOrderId: twice, newCustomer: newCustomer({ id: twice }) }),
      quickNew(s, { workOrderId: twice, newSite: newSite({ id: twice }) }),
      (() => {
        const shared = uuidv7();
        return quickNew(s, { newCustomer: newCustomer({ id: shared }), newSite: newSite({ id: shared }) });
      })(),
    ];
    for (const mutation of dup) {
      expect(await pushOne(phone, mutation), mutation.mutationId).toEqual({
        mutationId: mutation.mutationId,
        outcome: 'conflict',
        code: 'id_conflict',
      });
    }
    expect(await state()).toEqual(before);
  });

  it('EVM-099 AC4 a conflict of the second object leaves no trace of the first: no customer, no site, no order, no number used', async () => {
    const app = await boot();
    const s = await scene();
    const { phone } = await editor(app);
    const before = await state();
    // the new customer is free, the new site collides: the customer inserted a moment before is rolled back with everything else
    const mutation = quickNew(s, { newSite: newSite({ id: s.siteId }) });
    expect((await pushOne(phone, mutation)).code).toBe('id_conflict');
    const freeCustomer = objectIdOf(mutation, 'newCustomer');
    expect(await customerRow(freeCustomer)).toBeUndefined();
    expect(await state()).toEqual(before);
  });
});

describe('validation, the template and the targets (EVM-099 AC5)', () => {
  it('EVM-099 AC5 a template that is retired, deleted, missing, or whose plan has more than 20 milestones is template_unavailable - for every one nothing is written and the number is not used', async () => {
    const app = await boot();
    const s = await scene();
    const { phone } = await editor(app);
    const retired = uuidv7();
    const deleted = uuidv7();
    const longPlan = uuidv7();
    const at = '2026-10-13T08:00:00Z';
    await sql`insert into catalog.work_order_templates (id, code, name, is_active, position, created_at, updated_at)
      values (${retired}, 'quick_retired', 'Wycofany', false, 97, ${at}, ${at}), (${longPlan}, 'quick_long_plan', 'Długi plan', true, 98, ${at}, ${at})`.execute(
      admin(),
    );
    await sql`insert into catalog.work_order_templates (id, code, name, is_active, position, created_at, updated_at, deleted_at)
      values (${deleted}, 'quick_deleted', 'Usunięty', true, 99, ${at}, ${at}, ${at})`.execute(admin());
    // the catalogue allows positions 1..20 only (a CHECK): the test lifts it for the 21 milestones - the planner must refuse whatever the catalogue lets through
    await sql`alter table catalog.payment_milestone_templates drop constraint payment_milestone_templates_position_check`.execute(admin());
    for (let position = 1; position <= 21; position += 1) {
      await sql`insert into catalog.payment_milestone_templates (work_order_template_id, code, name, position, share_percent, invoice_hint, payment_term_days, created_at, updated_at)
        values (${longPlan}, ${`part_${position}`}, ${`Część ${position}`}, ${position}, 5, 'po etapie', 7, ${at}, ${at})`.execute(admin());
    }
    const before = await state();
    for (const id of [retired, deleted, uuidv7(), longPlan]) {
      const withTrap = quickNew(s, { templateId: id });
      const result = await pushOne(phone, withTrap);
      expect(result, id).toEqual({ mutationId: withTrap.mutationId, outcome: 'rejected', code: 'template_unavailable' });
      expect(await state(), id).toEqual(before);
    }
    // the same command with a good template afterwards takes the FIRST number
    const good = quickNew(s);
    expect((await pushOne(phone, good)).workOrderNumber).toBe('ZL-2026-0001');
  });

  it('EVM-099 AC5 a customer or a site that is missing, deleted or anonymized is the one answer target_unavailable - the same code and the same fields - and changes nothing', async () => {
    const app = await boot();
    const s = await scene();
    const { account, phone } = await editor(app);
    const deletedCustomer = await insertCustomer(admin(), { deletedAt: '2026-10-08T08:00:00Z' });
    const anonymizedCustomer = await insertCustomer(admin(), {});
    await sql`update customers.customers set first_name = 'Klient', last_name = 'zanonimizowany', phone = '+48000000000', anonymized_at = now(), anonymized_by = ${account.user.id} where id = ${anonymizedCustomer}`.execute(
      admin(),
    );
    const deletedSite = await insertSite(admin(), { deletedAt: '2026-10-08T08:00:00Z' });
    const before = await state();
    const results: Result[] = [];
    for (const payload of [
      { customerId: uuidv7() },
      { customerId: deletedCustomer },
      { customerId: anonymizedCustomer },
      { siteId: uuidv7() },
      { siteId: deletedSite },
    ]) {
      const mutation = quick(s, payload);
      const result = await pushOne(phone, mutation);
      results.push({ ...result, mutationId: 'x' });
    }
    expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(1);
    expect(results[0]).toEqual({ mutationId: 'x', outcome: 'rejected', code: 'target_unavailable' });
    expect(await state()).toEqual(before);
  });

  it('EVM-099 AC5 exactly one of each pair, a bad telephone, a one-word name of a person, a bad postal code, a bad title and an unknown commandVersion are validation_failed with the field and the code - never the value - and nothing is written', async () => {
    const app = await boot();
    const s = await scene();
    const { phone } = await editor(app);
    const before = await state();
    const cases: Array<[ReturnType<typeof quick>, Array<{ pointer: string; code: string }>]> = [
      [quick(s, { customerId: undefined }), [{ pointer: '/customerId', code: 'exactly_one_of' }]],
      [quick(s, { newCustomer: newCustomer() }), [{ pointer: '/customerId', code: 'exactly_one_of' }]],
      [quick(s, { siteId: undefined }), [{ pointer: '/siteId', code: 'exactly_one_of' }]],
      [quick(s, { newSite: newSite() }), [{ pointer: '/siteId', code: 'exactly_one_of' }]],
      [
        quick(s, { customerId: undefined, newCustomer: newCustomer({ phone: '600 abc 731' }) }),
        [{ pointer: '/newCustomer/phone', code: 'invalid_format' }],
      ],
      [
        quick(s, { customerId: undefined, newCustomer: newCustomer({ phone: '12 34 56' }) }),
        [{ pointer: '/newCustomer/phone', code: 'invalid_format' }],
      ],
      [
        quick(s, { customerId: undefined, newCustomer: newCustomer({ displayName: 'Wymyślona' }) }),
        [{ pointer: '/newCustomer/displayName', code: 'single_word_name' }],
      ],
      [
        quick(s, { siteId: undefined, newSite: newSite({ postalCode: '009-50' }) }),
        [{ pointer: '/newSite/postalCode', code: 'invalid_format' }],
      ],
      [
        quick(s, { siteId: undefined, newSite: newSite({ siteType: 'castle' }) }),
        [{ pointer: '/newSite/siteType', code: 'invalid_value' }],
      ],
      [
        quick(s, { siteId: undefined, newSite: newSite({ parkingSpotNumber: 'P-15' }) }),
        [{ pointer: '/newSite/parkingSpotNumber', code: 'not_allowed_for_site_type' }],
      ],
      [quick(s, { title: '  ' }), [{ pointer: '/title', code: 'required' }]],
      [quick(s, { title: 'x'.repeat(201) }), [{ pointer: '/title', code: 'too_long' }]],
      [quick(s, { note: 'x'.repeat(2001) }), [{ pointer: '/note', code: 'too_long' }]],
      [quick(s, {}, { commandVersion: 2 }), [{ pointer: '/commandVersion', code: 'unsupported_version' }]],
    ];
    const response = await push(phone, { mutations: cases.map(([mutation]) => mutation) });
    expect(response.status).toBe(200);
    for (const [index, result] of resultsOf(response).entries()) {
      expect(result, JSON.stringify(cases[index]?.[0].payload)).toEqual({
        mutationId: cases[index]?.[0].mutationId,
        outcome: 'rejected',
        code: 'validation_failed',
        errors: cases[index]?.[1],
      });
    }
    // not one value of the input comes back
    const text = JSON.stringify(response.body);
    for (const value of ['600 abc 731', '12 34 56', 'Wymyślona', '009-50', 'castle', 'P-15']) expect(text).not.toContain(value);
    expect(await state()).toEqual(before);
  });

  it('EVM-099 AC5 a field of the server or a stranger in the payload, the new customer or the new site (origin, number, status, createdViaDeviceId, email, nip, ppe, version, __proto__) is validation_failed with nothing written', async () => {
    const app = await boot();
    const s = await scene();
    const { phone } = await editor(app);
    const before = await state();
    const extras = ['origin', 'number', 'status', 'createdViaDeviceId', 'email', 'nip', 'ppe', 'version', '__proto__'];
    const mutations = extras.flatMap((name) => {
      const field = JSON.parse(`{"${name}":"x"}`) as Record<string, unknown>;
      return [
        quick(s, field),
        quick(s, { customerId: undefined, newCustomer: { ...newCustomer(), ...field } }),
        quick(s, { siteId: undefined, newSite: { ...newSite(), ...field } }),
      ];
    });
    for (let from = 0; from < mutations.length; from += 50) {
      const response = await push(phone, { mutations: mutations.slice(from, from + 50) });
      for (const result of resultsOf(response)) expect([result.outcome, result.code]).toEqual(['rejected', 'validation_failed']);
    }
    expect(await state()).toEqual(before);
  });

  it('EVM-099 AC5 a note that the journal refuses is validation_failed at /note and rolls everything back, the counter included', async () => {
    const app = await boot();
    const s = await scene();
    const { phone } = await editor(app);
    const before = await state();
    const mutation = quickNew(s, { note: 'tekst\u0007ze sterującym' });
    const result = await pushOne(phone, mutation);
    expect(result.code).toBe('validation_failed');
    expect(result.errors).toEqual([{ pointer: '/note', code: 'invalid_characters' }]);
    expect(await state()).toEqual(before);
  });
});

describe('idempotency and dependants (EVM-099 AC6)', () => {
  it('EVM-099 AC6 the same command again is a duplicate with the SAME number and no new number, customer or site; another content with the same mutationId is idempotency_mismatch', async () => {
    const app = await boot();
    const s = await scene();
    const { phone } = await editor(app);
    const mutation = quickNew(s, { note: SYNTHETIC_NOTE });
    const first = await pushOne(phone, mutation);
    expect(first).toEqual({ mutationId: mutation.mutationId, outcome: 'applied', workOrderNumber: 'ZL-2026-0001' });
    const after = await state();
    const again = await pushOne(phone, mutation);
    expect(again).toEqual({ mutationId: mutation.mutationId, outcome: 'duplicate', workOrderNumber: 'ZL-2026-0001' });
    expect(await state()).toEqual(after);
    const changed = { ...mutation, payload: { ...mutation.payload, title: 'Inny tytuł' } };
    expect(await pushOne(phone, changed)).toEqual({ mutationId: mutation.mutationId, outcome: 'rejected', code: 'idempotency_mismatch' });
    expect(await state()).toEqual(after);
    // the number is read for a duplicate even when the order was deleted since
    await sql`update work_orders.work_orders set deleted_at = now(), deleted_by = null where id = ${orderIdOf(mutation)}`.execute(admin());
    expect(await pushOne(phone, mutation)).toMatchObject({ outcome: 'duplicate', workOrderNumber: 'ZL-2026-0001' });
  });

  it('EVM-099 AC6 after the record expired a retry of the own order (same user and device) is a duplicate with idempotency_expired and the number; any other case is id_conflict; no record is written', async () => {
    const app = await boot();
    const s = await scene();
    const { account, phone } = await editor(app);
    const colleague = await editor(app);
    const mutation = quickNew(s, { note: SYNTHETIC_NOTE });
    expect((await pushOne(phone, mutation)).outcome).toBe('applied');
    const id = orderIdOf(mutation);
    // the record of idempotency has expired and been purged; the order is older than the retention
    await sql`update work_orders.work_orders set created_at = ${new Date(app.clock.now().getTime() - IDEMPOTENCY_RETENTION_MS - 60_000)} where id = ${id}`.execute(
      admin(),
    );
    await sql`delete from platform.idempotency_records`.execute(admin());
    nextStep(app);
    const secondPhone = await signedInPhone(app, account);
    const before = await state();
    const retried = { ...mutation, mutationId: uuidv7() };
    expect(await pushOne(phone, retried)).toEqual({
      mutationId: retried.mutationId,
      outcome: 'duplicate',
      warnings: ['idempotency_expired'],
      workOrderNumber: 'ZL-2026-0001',
    });
    expect(await state()).toEqual(before);
    // another user, another device of the same user, an order of the office or a young order: id_conflict
    const otherUser = await pushOne(colleague.phone, { ...mutation, mutationId: uuidv7() });
    expect([otherUser.outcome, otherUser.code, otherUser.workOrderNumber]).toEqual(['conflict', 'id_conflict', undefined]);
    const otherDevice = await pushOne(secondPhone, { ...mutation, mutationId: uuidv7() });
    expect([otherDevice.outcome, otherDevice.code, otherDevice.workOrderNumber]).toEqual(['conflict', 'id_conflict', undefined]);
    await sql`update work_orders.work_orders set origin = 'office', created_via_device_id = null where id = ${id}`.execute(admin());
    const afterUpdate = await state();
    const office = await pushOne(phone, { ...mutation, mutationId: uuidv7() });
    expect([office.outcome, office.code]).toEqual(['conflict', 'id_conflict']);
    expect(await state()).toEqual(afterUpdate);
  });

  it('EVM-099 AC6 an entry for an order that its command has not created yet is forbidden (the one answer for no access and no such order, EVM-098 AC6) and after the order is applied - in the same batch or a later one - the entry is applied', async () => {
    const app = await boot();
    const s = await scene();
    const { phone } = await editor(app);
    const mutation = quickNew(s);
    const id = orderIdOf(mutation);
    const early = await pushOne(phone, note(id));
    expect([early.outcome, early.code]).toEqual(['rejected', 'forbidden']);
    expect(await n(sql`select count(*)::text as n from timeline.timeline_entries where kind = 'note'`)).toBe(0);
    const together = note(id);
    const batch = await push(phone, { mutations: [mutation, together] });
    expect(resultsOf(batch).map((result) => result.outcome)).toEqual(['applied', 'applied']);
    expect((await pushOne(phone, note(id))).outcome).toBe('applied');
    expect(await n(sql`select count(*)::text as n from timeline.timeline_entries where kind = 'note'`)).toBe(2);
    // an order whose command was rejected is no order: the entry is forbidden again, nothing was stored
    const rejected = quickNew(s, { templateId: uuidv7() });
    expect((await pushOne(phone, rejected)).code).toBe('template_unavailable');
    expect((await pushOne(phone, note(orderIdOf(rejected)))).code).toBe('forbidden');
  });
});

describe('the limit of new customers and sites per device (EVM-099 AC7)', () => {
  const customerOnly = (s: Scene) => quick(s, { customerId: undefined, newCustomer: newCustomer() });
  const siteOnly = (s: Scene) => quick(s, { siteId: undefined, newSite: newSite() });
  const batchOf = (mutations: unknown[]) => ({ mutations });

  it('EVM-099 AC7 20 new customers in 24 hours are applied, the 21st is quota_exceeded with nothing written; the sites are counted apart; existing objects and duplicates are not limited', async () => {
    const app = await boot();
    const s = await scene();
    const { phone } = await editor(app);
    const twenty = Array.from({ length: 20 }, () => customerOnly(s));
    for (let from = 0; from < twenty.length; from += 10) {
      const response = await push(phone, batchOf(twenty.slice(from, from + 10)));
      expect(resultsOf(response).every((result) => result.outcome === 'applied')).toBe(true);
    }
    const before = await state();
    const extra = customerOnly(s);
    expect(await pushOne(phone, extra)).toEqual({ mutationId: extra.mutationId, outcome: 'rejected', code: 'quota_exceeded' });
    expect(await state()).toEqual(before);
    // the sites are another count; an order of existing objects and the repeat of an applied command are not limited
    expect((await pushOne(phone, siteOnly(s))).outcome).toBe('applied');
    expect((await pushOne(phone, quick(s))).outcome).toBe('applied');
    expect((await pushOne(phone, twenty[0])).outcome).toBe('duplicate');
    // a command with both: the customer limit refuses it as a whole, no new site is left
    const sitesBefore = await n(sql`select count(*)::text as n from sites.sites`);
    const both = quickNew(s);
    expect((await pushOne(phone, both)).code).toBe('quota_exceeded');
    expect(await n(sql`select count(*)::text as n from sites.sites`)).toBe(sitesBefore);
    // the number of the refused command is not used
    expect((await pushOne(phone, quick(s))).workOrderNumber).toBe('ZL-2026-0023');
  });

  it('EVM-099 AC7 20 new sites are applied and the 21st is quota_exceeded, while customers are still free; another device has its own count', async () => {
    const app = await boot();
    const s = await scene();
    const { phone } = await editor(app);
    const other = await editor(app);
    for (let from = 0; from < 20; from += 10) {
      const response = await push(phone, batchOf(Array.from({ length: 10 }, () => siteOnly(s))));
      expect(resultsOf(response).every((result) => result.outcome === 'applied')).toBe(true);
    }
    expect((await pushOne(phone, siteOnly(s))).code).toBe('quota_exceeded');
    expect((await pushOne(phone, customerOnly(s))).outcome).toBe('applied');
    expect((await pushOne(other.phone, siteOnly(s))).outcome).toBe('applied');
  });

  it('EVM-099 AC7 the window rolls on the clock of the server: after 24 hours the oldest are out; deleted rows still count; the time of the phone does not matter', async () => {
    const app = await boot();
    const s = await scene();
    const { phone } = await editor(app);
    const first = Array.from({ length: 20 }, () => customerOnly(s));
    for (let from = 0; from < 20; from += 10) await push(phone, batchOf(first.slice(from, from + 10)));
    await sql`update customers.customers set deleted_at = now(), deleted_by = null where created_via_device_id = ${phone.deviceId}`.execute(
      admin(),
    );
    expect((await pushOne(phone, customerOnly(s))).code).toBe('quota_exceeded');
    // the rows are 24 hours minus a second old: still inside the window; two seconds later they are out (the session of the test would not outlive a day on the clock)
    const rowsAge = async (milliseconds: number) =>
      sql`update customers.customers set created_at = ${new Date(app.clock.now().getTime() - milliseconds)} where created_via_device_id = ${phone.deviceId}`.execute(
        admin(),
      );
    await rowsAge(24 * 3_600_000 - 1000);
    expect((await pushOne(phone, customerOnly(s))).code).toBe('quota_exceeded');
    await rowsAge(24 * 3_600_000 + 1000);
    expect((await pushOne(phone, customerOnly(s))).outcome).toBe('applied');
  });

  it('EVM-099 AC7 the refusal is recorded once per device, kind and hour: the audit event with the device and the kind, one security alert without the device, the metric with a closed label', async () => {
    const app = await boot();
    const s = await scene();
    const { account, phone } = await editor(app);
    for (let from = 0; from < 20; from += 10) await push(phone, batchOf(Array.from({ length: 10 }, () => customerOnly(s))));
    for (let attempt = 0; attempt < 3; attempt += 1) expect((await pushOne(phone, customerOnly(s))).code).toBe('quota_exceeded');
    expect(await auditOf('sync.quota_exceeded')).toHaveLength(1);
    expect((await auditOf('sync.quota_exceeded'))[0]).toMatchObject({
      outcome: 'denied',
      object_type: 'device',
      object_id: phone.deviceId,
      device_id: phone.deviceId,
      quota_kind: 'customer',
      actor_user_id: account.user.id,
      work_order_id: null,
      command_type: null,
    });
    const alerts = (
      await sql<
        Record<string, unknown>
      >`select * from platform.security_alert_outbox where alert_code = 'sync_quick_create_quota_exceeded'`.execute(admin())
    ).rows;
    expect(alerts).toHaveLength(1);
    expect(JSON.stringify(alerts)).not.toContain(phone.deviceId ?? 'x');
    expect(counter(app, 'sync_quota_exceeded_total', { kind: 'customer' })).toBe(3);
    expect(counter(app, 'sync_quota_exceeded_total', { kind: 'site' })).toBe(0);
    // the site limit is a mark of its own, and the next hour opens a new one
    for (let from = 0; from < 20; from += 10) await push(phone, batchOf(Array.from({ length: 10 }, () => siteOnly(s))));
    expect((await pushOne(phone, siteOnly(s))).code).toBe('quota_exceeded');
    expect((await auditOf('sync.quota_exceeded')).map((event) => event['quota_kind'])).toEqual(['customer', 'site']);
    // the next hour: the marks are of an earlier window
    await sql`update sync.quota_alerts set window_start = window_start - interval '1 hour'`.execute(admin());
    expect((await pushOne(phone, customerOnly(s))).code).toBe('quota_exceeded');
    expect(await auditOf('sync.quota_exceeded')).toHaveLength(3);
  });

  it('EVM-099 AC7 two batches of one device at the same moment never pass the limit: 2 x 15 new customers give exactly 20', async () => {
    const app = await boot();
    const s = await scene();
    const { phone } = await editor(app);
    const batches = [0, 1].map(() => Array.from({ length: 15 }, () => customerOnly(s)));
    const responses = await Promise.all(batches.map((mutations) => push(phone, batchOf(mutations))));
    for (const response of responses) expect(response.status).toBe(200);
    const outcomes = responses.flatMap((response) => resultsOf(response).map((result) => result.code ?? result.outcome));
    expect(outcomes.filter((outcome) => outcome === 'applied')).toHaveLength(20);
    expect(outcomes.filter((outcome) => outcome === 'quota_exceeded')).toHaveLength(10);
    expect(await n(sql`select count(*)::text as n from customers.customers where created_via_device_id = ${phone.deviceId}`)).toBe(20);
  });
});

describe('roles, sessions and IDOR (EVM-099 AC8)', () => {
  async function administratorPhone(app: IdentityApp): Promise<Phone> {
    const enrolled = await enrolledAccount(app, { role: 'administrator' });
    const secret = await addTotp(app, enrolled);
    return signedInPhone(app, { ...enrolled, secret } as unknown as TotpAccount);
  }

  it('EVM-099 AC8 Administrator and Editor create the order; Read-only (also after a change of the role) is 403 forbidden; no token is 401 - with no effect', async () => {
    const app = await boot();
    const s = await scene();
    const adminPhone = await administratorPhone(app);
    const { phone: editorPhone } = await editor(app);
    for (const phone of [adminPhone, editorPhone]) expect((await pushOne(phone, quickNew(s))).outcome).toBe('applied');
    const demoted = await editor(app);
    await sql`update identity.users set role = 'read_only' where id = ${demoted.account.user.id}`.execute(admin());
    const before = await state();
    const denied = await push(demoted.phone, { mutations: [quickNew(s)] });
    expect(denied.status).toBe(403);
    expect(problemOf(denied)).toBe('forbidden');
    noStore(denied);
    const anonymous = await newPhone(app).post(PATH, { mutations: [quickNew(s)] }, {});
    expect(anonymous.status).toBe(401);
    noStore(anonymous);
    expect(await state()).toEqual(before);
  });

  it('EVM-099 AC8 a device to wipe is 401 device_wipe_required and a revoked session 401 session_revoked for the whole batch - nothing is created, not even the pendingItems', async () => {
    const app = await boot();
    const s = await scene();
    const wiped = await editor(app);
    await setDeviceState(app, wiped.phone.deviceId ?? '', 'wipe_required');
    const revoked = await editor(app);
    expect((await revoked.phone.post(MOBILE.logout, undefined, revoked.phone.authorised())).status).toBe(204);
    const before = await state();
    const answer = await push(wiped.phone, { mutations: [quickNew(s), quickNew(s)], pendingItems: 4 });
    expect([answer.status, problemOf(answer)]).toEqual([401, 'device_wipe_required']);
    noStore(answer);
    const gone = await push(revoked.phone, { mutations: [quickNew(s)] });
    expect([gone.status, problemOf(gone)]).toEqual([401, 'session_revoked']);
    expect(await state()).toEqual(before);
    expect(await n(sql`select coalesce(sum(pending_items_reported), 0)::text as n from identity.devices`)).toBe(0);
  });

  it('EVM-099 AC8 foreign or deleted identifiers and a template without access never reveal a thing: every id gets its own conflict or the one target_unavailable, and the answers do not differ in shape', async () => {
    const app = await boot();
    const s = await scene();
    const { phone } = await editor(app);
    const other = await editor(app);
    const foreign = quickNew(s);
    expect((await pushOne(other.phone, foreign)).outcome).toBe('applied');
    const foreignPayload = {
      workOrderId: orderIdOf(foreign),
      newCustomer: { id: objectIdOf(foreign, 'newCustomer') },
      newSite: { id: objectIdOf(foreign, 'newSite') },
    };
    const results = [
      await pushOne(phone, quick(s, { workOrderId: foreignPayload.workOrderId })),
      await pushOne(phone, quick(s, { customerId: undefined, newCustomer: newCustomer({ id: foreignPayload.newCustomer.id }) })),
      await pushOne(phone, quick(s, { siteId: undefined, newSite: newSite({ id: foreignPayload.newSite.id }) })),
    ];
    for (const result of results)
      expect([result.outcome, result.code, Object.keys(result).sort()]).toEqual([
        'conflict',
        'id_conflict',
        ['code', 'mutationId', 'outcome'],
      ]);
    // the customer of another user is just a customer of the company (the roles read all): the order is created - the policy, not the author, decides
    const asCustomer = await pushOne(phone, quick(s, { customerId: foreignPayload.newCustomer.id, siteId: foreignPayload.newSite.id }));
    expect(asCustomer.outcome).toBe('applied');
  });
});

describe('the detail of the order, the log and the metric (EVM-099 AC8; SR-LOG-02, SR-DATA-03)', () => {
  it('EVM-099 AC8 the detail has origin, the author and the time of creation as read-only fields: office for the panel, mobile_quick for the phone; every role reads, nobody not signed in; a write of them is 400 read_only_field', async () => {
    const app = await boot();
    const s = await scene();
    const { account, phone } = await editor(app);
    const mutation = quick(s);
    expect((await pushOne(phone, mutation)).outcome).toBe('applied');
    const id = orderIdOf(mutation);
    const detail = await account.panel.get(`/api/v1/work-orders/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.headers['cache-control']).toBe('no-store');
    expect(detail.body).toMatchObject({
      origin: 'mobile_quick',
      createdBy: { displayName: expect.any(String) as string },
      createdAt: expect.any(String) as string,
    });
    expect(Object.keys((detail.body as { createdBy: object }).createdBy)).toEqual(['displayName']);
    const panelId = uuidv7();
    await account.panel
      .post('/api/v1/work-orders', { id: panelId, customerId: s.customerId, siteId: s.siteId, templateId: null })
      .set('Idempotency-Key', uuidv7());
    const office = await account.panel.get(`/api/v1/work-orders/${panelId}`);
    expect(office.body).toMatchObject({ origin: 'office' });

    const read = await totpAccount(app, { role: 'read_only' });
    const readDetail = await read.panel.get(`/api/v1/work-orders/${id}`);
    expect([readDetail.status, (readDetail.body as { origin: string }).origin]).toEqual([200, 'mobile_quick']);
    const anonymous = await newPhone(app).get(`/api/v1/work-orders/${id}`, {});
    expect(anonymous.status).toBe(401);

    const current = await account.panel.get(`/api/v1/work-orders/${id}`);
    for (const field of [{ origin: 'office' }, { createdBy: { displayName: 'X' } }, { createdAt: '2026-01-01T00:00:00.000Z' }]) {
      const patched = await account.panel.patch(`/api/v1/work-orders/${id}`, field, { 'If-Match': String(current.headers['etag']) });
      const name = Object.keys(field)[0];
      expect([patched.status, (patched.body as { errors: unknown }).errors]).toEqual([
        400,
        [{ pointer: `/${name}`, code: 'read_only_field' }],
      ]);
    }
    const created = await account.panel
      .post('/api/v1/work-orders', { id: uuidv7(), customerId: s.customerId, siteId: s.siteId, templateId: null, origin: 'mobile_quick' })
      .set('Idempotency-Key', uuidv7());
    expect([created.status, (created.body as { errors: unknown }).errors]).toEqual([
      400,
      [{ pointer: '/origin', code: 'read_only_field' }],
    ]);
  });

  it('EVM-099 AC8 the author of the detail that is gone has no createdBy and the detail is still served', async () => {
    const app = await boot();
    const s = await scene();
    const { account, phone } = await editor(app);
    const mutation = quick(s);
    await pushOne(phone, mutation);
    const id = orderIdOf(mutation);
    await sql`update work_orders.work_orders set created_by = null where id = ${id}`.execute(admin());
    const detail = await account.panel.get(`/api/v1/work-orders/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ origin: 'mobile_quick' });
    expect(detail.body).not.toHaveProperty('createdBy');
  });

  it('EVM-099 AC1 SR-LOG-02 neither the log, the audit trail, the change log, the alerts nor the answer holds the telephone, the name, the address, the title or the note', async () => {
    const app = await boot();
    const s = await scene();
    const { phone } = await editor(app);
    const mutation = quickNew(s, { note: SYNTHETIC_NOTE });
    const response = await push(phone, { mutations: [mutation, quickNew(s, { newCustomer: newCustomer({ phone: '12 34' }) })] });
    expect(response.status).toBe(200);
    const written = [
      JSON.stringify(response.body),
      current.logs.text,
      (await sql<{ row: string }>`select to_jsonb(t)::text as row from audit.events t`.execute(admin())).rows
        .map((row) => row.row)
        .join('\n'),
      (await sql<{ row: string }>`select to_jsonb(t)::text as row from sync.change_log t`.execute(admin())).rows
        .map((row) => row.row)
        .join('\n'),
      (await sql<{ row: string }>`select to_jsonb(t)::text as row from platform.security_alert_outbox t`.execute(admin())).rows
        .map((row) => row.row)
        .join('\n'),
    ].join('\n');
    for (const value of [
      '600000731',
      '600 000 731',
      '12 34',
      'Zofia',
      'Wymyślona',
      SYNTHETIC_STREET,
      'Fikcyjnowo',
      SYNTHETIC_TITLE,
      SYNTHETIC_NOTE,
    ]) {
      expect(written, value).not.toContain(value);
    }
  });

  it('EVM-099 AC7 the operator counts the results of the quick order by type, outcome and code - closed labels, no identifier', async () => {
    const app = await boot();
    const s = await scene();
    const { phone } = await editor(app);
    await pushOne(phone, quick(s));
    await pushOne(phone, quick(s, { templateId: uuidv7() }));
    expect(counter(app, 'sync_mutation_outcomes_total', { type: 'create_quick_work_order', outcome: 'applied', code: 'none' })).toBe(1);
    expect(
      counter(app, 'sync_mutation_outcomes_total', { type: 'create_quick_work_order', outcome: 'rejected', code: 'template_unavailable' }),
    ).toBe(1);
  });
});

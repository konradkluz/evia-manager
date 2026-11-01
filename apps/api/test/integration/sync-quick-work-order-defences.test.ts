/**
 * The defensive branches of `CreateQuickWorkOrder` (EVM-099): results of the ports of other modules that the real ports give only in a race (an identifier taken a
 * moment ago, a rule of the journal that the decoder did not state, a user deactivated between the guard and the write). The service must turn each into a
 * verdict - never a 500, never a half-written order - so the ports are replaced by doubles that give exactly that answer. Synthetic data only.
 */
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { CUSTOMER_QUICK_CREATION, type CustomerQuickCreation } from '../../src/modules/customers/system-ports.ts';
import { SITE_QUICK_CREATION, type SiteQuickCreation } from '../../src/modules/sites/system-ports.ts';
import { MOBILE_ENTRY_COMMANDS, type MobileEntryCommands } from '../../src/modules/timeline/system-ports.ts';
import {
  WORK_ORDER_QUICK_CREATION,
  type QuickCreationResult,
  type WorkOrderQuickCreation,
} from '../../src/modules/work-orders/system-ports.ts';
import { runInTransaction } from '../../src/platform/database/transactional.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createUser } from '../support/identity-fixtures.ts';
import type { Phone } from '../support/mobile-flows.ts';
import { principal } from '../support/principals.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { editor } from '../support/sync-harness.ts';
import { uuidv7 } from '../support/uuid.ts';

const PATH = '/api/v1/sync/mutations';
const context = { origin: 'web' as const, traceId: 'd'.repeat(32) };

type Answer = 'created' | 'invalid' | 'id_conflict';
/** What each double answers; a test changes it. */
const answers = {
  customer: 'created' as Answer,
  site: 'created' as Answer,
  order: { ok: true, number: 'ZL-2026-9999' } as QuickCreationResult,
  note: 'applied' as 'applied' | 'invalid' | 'id_conflict',
};
const reset = (): void => {
  answers.customer = 'created';
  answers.site = 'created';
  answers.order = { ok: true, number: 'ZL-2026-9999' };
  answers.note = 'applied';
};

const customers: CustomerQuickCreation = {
  check: () => [],
  create: () => Promise.resolve(answers.customer),
  lockUsable: () => Promise.resolve(true),
  countCreatedBy: () => Promise.resolve(0),
};
const sites: SiteQuickCreation = {
  check: () => [],
  create: () => Promise.resolve(answers.site),
  countCreatedBy: () => Promise.resolve(0),
};
const orders: WorkOrderQuickCreation = {
  probe: () => Promise.resolve({ kind: 'free' }),
  numberOf: () => Promise.resolve(undefined),
  templateAvailable: () => Promise.resolve(true),
  create: () => Promise.resolve(answers.order),
};
const entries: MobileEntryCommands = {
  create: () => Promise.resolve(answers.note),
  matchesOwnEntry: () => Promise.resolve(false),
};

let current: IdentityApp;
afterEach(async () => {
  reset();
  await current.close();
});

const mutation = (payload: Record<string, unknown> = {}) => ({
  mutationId: uuidv7(),
  type: 'CreateQuickWorkOrder',
  commandVersion: 1,
  payload: {
    workOrderId: uuidv7(),
    templateId: uuidv7(),
    title: 'Montaż wallboxa',
    newCustomer: { id: uuidv7(), kind: 'company', displayName: 'Firma Zmyślona', phone: '600600600' },
    newSite: { id: uuidv7(), siteType: 'other', street: 'ul. Zmyślona', buildingNumber: '1', postalCode: '00-001', city: 'Fikcyjnowo' },
    ...payload,
  },
});
async function resultOf(phone: Phone, input: unknown): Promise<Record<string, unknown>> {
  const response = await phone.post(PATH, { mutations: [input] }, phone.authorised());
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return (response.body as { results: Array<Record<string, unknown>> }).results[0] ?? {};
}

describe('results of the other modules that only a race gives (EVM-099 AC4, AC5)', () => {
  async function doubles(): Promise<Phone> {
    current = await createIdentityApp({
      configure: (builder) =>
        builder
          .overrideProvider(CUSTOMER_QUICK_CREATION)
          .useValue(customers)
          .overrideProvider(SITE_QUICK_CREATION)
          .useValue(sites)
          .overrideProvider(WORK_ORDER_QUICK_CREATION)
          .useValue(orders)
          .overrideProvider(MOBILE_ENTRY_COMMANDS)
          .useValue(entries),
    });
    return (await editor(current)).phone;
  }

  it('EVM-099 AC5 the note that the journal refuses is validation_failed at /note, and the identifier of the note taken a moment ago a conflict - never a 500', async () => {
    const phone = await doubles();
    answers.note = 'invalid';
    expect(await resultOf(phone, mutation({ note: 'Zadzwonić.' }))).toMatchObject({
      outcome: 'rejected',
      code: 'validation_failed',
      errors: [{ pointer: '/note', code: 'invalid_format' }],
    });
    answers.note = 'id_conflict';
    expect(await resultOf(phone, mutation({ note: 'Zadzwonić.' }))).toMatchObject({ outcome: 'conflict', code: 'id_conflict' });
    answers.note = 'applied';
    expect(await resultOf(phone, mutation({ note: 'Zadzwonić.' }))).toMatchObject({ outcome: 'applied', workOrderNumber: 'ZL-2026-9999' });
  });

  it('EVM-099 AC4 AC5 a new customer or a new site that the port refuses - for its content or for its identifier - is a verdict, and so is an order whose identifier was taken a moment ago', async () => {
    const phone = await doubles();
    answers.customer = 'invalid';
    expect(await resultOf(phone, mutation())).toMatchObject({ outcome: 'rejected', code: 'validation_failed' });
    answers.customer = 'id_conflict';
    expect(await resultOf(phone, mutation())).toMatchObject({ outcome: 'conflict', code: 'id_conflict' });
    answers.customer = 'created';
    answers.site = 'invalid';
    expect(await resultOf(phone, mutation())).toMatchObject({ outcome: 'rejected', code: 'validation_failed' });
    answers.site = 'id_conflict';
    expect(await resultOf(phone, mutation())).toMatchObject({ outcome: 'conflict', code: 'id_conflict' });
    answers.site = 'created';
    answers.order = { ok: false, reason: 'id_conflict' };
    expect(await resultOf(phone, mutation())).toMatchObject({ outcome: 'conflict', code: 'id_conflict' });
    answers.order = { ok: false, reason: 'target_unavailable' };
    expect(await resultOf(phone, mutation())).toMatchObject({ outcome: 'rejected', code: 'target_unavailable' });
  });
});

describe('the real ports in the cases of a race (EVM-099 AC5)', () => {
  it('EVM-099 AC5 the ports refuse the content they were not checked for, before any write; a user deactivated after the guard is target_unavailable', async () => {
    current = await createIdentityApp();
    const customerPort = current.app.get<CustomerQuickCreation>(CUSTOMER_QUICK_CREATION, { strict: false });
    const sitePort = current.app.get<SiteQuickCreation>(SITE_QUICK_CREATION, { strict: false });
    const orderPort = current.app.get<WorkOrderQuickCreation>(WORK_ORDER_QUICK_CREATION, { strict: false });
    const db = current.database.admin;
    const caller = principal({ role: 'editor', channel: 'mobile' });
    const deviceId = uuidv7();
    expect(
      await runInTransaction(db, (tx) =>
        customerPort.create(tx, caller, deviceId, { id: uuidv7(), kind: 'person', displayName: 'Jedno', phone: '600600600' }, context),
      ),
    ).toBe('invalid');
    expect(
      await runInTransaction(db, (tx) =>
        sitePort.create(
          tx,
          caller,
          deviceId,
          { id: uuidv7(), siteType: 'other', street: 'ul. Zmyślona', buildingNumber: '1', postalCode: 'zły', city: 'Fikcyjnowo' },
          context,
        ),
      ),
    ).toBe('invalid');
    expect(await n(sql`select count(*)::text as n from customers.customers`)).toBe(0);
    expect(await n(sql`select count(*)::text as n from sites.sites`)).toBe(0);

    const user = await createUser(db, current.clock, { role: 'editor', status: 'deactivated' });
    const customerId = await insertCustomer(db, {});
    const siteId = await insertSite(db);
    const templateId = (await sql<{ id: string }>`select id from catalog.work_order_templates limit 1`.execute(db)).rows[0]?.id ?? '';
    const result = await runInTransaction(db, (tx) =>
      orderPort.create(
        tx,
        { ...caller, userId: user.id },
        deviceId,
        { id: uuidv7(), templateId, title: 'Montaż', customerId, siteId },
        context,
      ),
    );
    expect(result).toEqual({ ok: false, reason: 'target_unavailable' });
    expect(await n(sql`select count(*)::text as n from work_orders.work_orders`)).toBe(0);
  });
});

const n = async (query: ReturnType<typeof sql<{ n: string }>>): Promise<number> =>
  Number((await query.execute(current.database.admin)).rows[0]?.n);

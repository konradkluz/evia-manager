/**
 * The limit of open site surveys (EVM-140 AC4, AC5; ADR-0024 pt 10; W7): 20 open surveys per creator and 100 in all (an open survey: no customer, not cancelled, not
 * deleted). The panel gets `409 site_survey_limit_exceeded`, the phone a `rejected` result with the same code; the assignment of a customer and the rejection free
 * a place; ordinary orders do not count. The limit holds at the boundary (the 20th is allowed, the 21st is not) and under a race. Synthetic data only.
 */
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import type { IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { bootSync, editor } from '../support/sync-harness.ts';
import type { Phone } from '../support/mobile-flows.ts';
import { uuidv7 } from '../support/uuid.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';

const PATH = '/api/v1/site-surveys';
const ON = { SITE_SURVEYS_ENABLED: 'true' };
const STREET = 'ul. Znacznik-limitu-synt';
const CITY = 'Limitowo-synt';
const PHONE = '+48600140002';
const DEADLINE = new Date('2027-02-14T08:00:00.000Z');

let current: IdentityApp;
afterEach(async () => {
  await current.close();
});
const admin = () => current.database.admin;
const codeOf = (body: unknown): string | undefined => (body as { code?: string }).code;
let numbering = 0;

async function signIn(role: Role = 'editor') {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, { channel: 'web' });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;

/** Open surveys of a creator written straight into the database; `creator` null - nobody (they count in the total only). */
async function seed(
  count: number,
  creator: string | null,
  over: { status?: 'cancelled'; deletedAt?: Date; customer?: boolean } = {},
): Promise<string[]> {
  const siteId = await insertSite(admin(), { street: STREET, city: CITY });
  const specs = Array.from({ length: count }, () => {
    numbering += 1;
    return {
      number: `ZL-2090-${String(numbering).padStart(4, '0')}`,
      siteId,
      ...(over.customer === true ? {} : { siteSurveyExpiresAt: DEADLINE }),
      ...(over.status === undefined ? {} : { status: over.status, closedAt: new Date('2026-10-02T08:00:00Z') }),
      ...(over.deletedAt === undefined ? {} : { deletedAt: over.deletedAt }),
    };
  });
  const ids = [...(await insertWorkOrders(admin(), specs)).values()];
  if (creator !== null && ids.length > 0) {
    await sql`update work_orders.work_orders set created_by = ${creator}, requester_phone = ${over.customer === true ? null : PHONE}
      where id in (${sql.join(ids)})`.execute(admin());
  }
  return ids;
}

const create = (browser: Browser, siteId: string, id = uuidv7()) => browser.panel.post(PATH, { id, siteId });
const openOf = async (creator: string): Promise<number> =>
  Number(
    (
      await sql<{ n: string }>`
        select count(*)::text as n from work_orders.work_orders
        where created_by = ${creator} and site_survey_expires_at is not null and status <> 'cancelled' and deleted_at is null`.execute(
        admin(),
      )
    ).rows[0]?.n,
  );
const orderCount = async (): Promise<number> =>
  Number((await sql<{ n: string }>`select count(*)::text as n from work_orders.work_orders`.execute(admin())).rows[0]?.n);

describe('the limit of open surveys of the panel (EVM-140 AC4)', () => {
  it('EVM-140 AC4 the 20th open survey of a creator is created, the 21st is 409 site_survey_limit_exceeded and leaves nothing behind (no order, no number, no audit)', async () => {
    current = (await bootSync(ON)).app;
    const editorOne = await signIn('editor');
    const siteId = await insertSite(admin(), { street: STREET, city: CITY });
    await seed(19, editorOne.userId);

    const twentieth = await create(editorOne, siteId);
    expect(twentieth.status, JSON.stringify(twentieth.body)).toBe(201);
    expect(await openOf(editorOne.userId)).toBe(20);

    const before = {
      orders: await orderCount(),
      counters: Number(
        (await sql<{ n: string }>`select coalesce(sum(last_value), 0)::text as n from work_orders.number_counters`.execute(admin())).rows[0]
          ?.n,
      ),
      audit: Number(
        (await sql<{ n: string }>`select count(*)::text as n from audit.events where action = 'work_order.created'`.execute(admin()))
          .rows[0]?.n,
      ),
    };
    const refused = await create(editorOne, siteId);
    expect([refused.status, codeOf(refused.body)]).toEqual([409, 'site_survey_limit_exceeded']);
    expect(JSON.stringify(refused.body)).not.toContain(STREET);
    expect(await openOf(editorOne.userId)).toBe(20);
    expect(await orderCount()).toBe(before.orders);
    expect(
      Number(
        (await sql<{ n: string }>`select coalesce(sum(last_value), 0)::text as n from work_orders.number_counters`.execute(admin())).rows[0]
          ?.n,
      ),
    ).toBe(before.counters);
    expect(
      Number(
        (await sql<{ n: string }>`select count(*)::text as n from audit.events where action = 'work_order.created'`.execute(admin()))
          .rows[0]?.n,
      ),
    ).toBe(before.audit);

    // the limit is per creator: another Editor is not affected
    const editorTwo = await signIn('editor');
    expect((await create(editorTwo, siteId)).status).toBe(201);
  });

  it('EVM-140 AC4 cancelled and deleted surveys, surveys with a customer and ordinary orders do not count against the limit', async () => {
    current = (await bootSync(ON)).app;
    const browser = await signIn('editor');
    const siteId = await insertSite(admin(), { street: STREET, city: CITY });
    await seed(19, browser.userId);
    await seed(5, browser.userId, { status: 'cancelled' });
    await seed(5, browser.userId, { deletedAt: new Date('2026-10-02T08:00:00Z') });
    const ordinary = await seed(5, browser.userId, { customer: true });
    expect(ordinary).toHaveLength(5);

    expect((await create(browser, siteId)).status).toBe(201);
    expect((await create(browser, siteId)).status).toBe(409);
  });

  it('EVM-140 AC4 the assignment of a customer and the rejection of a survey free a place', async () => {
    current = (await bootSync(ON)).app;
    const browser = await signIn('editor');
    const siteId = await insertSite(admin(), { street: STREET, city: CITY });
    const ids = await seed(20, browser.userId);
    expect(codeOf((await create(browser, siteId)).body)).toBe('site_survey_limit_exceeded');

    const customerId = await insertCustomer(admin());
    const assigned = await browser.panel.put(`/api/v1/work-orders/${ids[0]}/customer`, { customerId, version: 1 });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    expect((await create(browser, siteId)).status).toBe(201);
    expect(codeOf((await create(browser, siteId)).body)).toBe('site_survey_limit_exceeded');

    const rejected = await browser.panel.post(
      `/api/v1/work-orders/${ids[1]}/transitions`,
      { to: 'cancelled', reasonCode: 'offer_rejected' },
      { 'If-Match': '"1"' },
    );
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    expect((await create(browser, siteId)).status).toBe(201);
    expect(await openOf(browser.userId)).toBe(20);
  });

  it('EVM-140 AC4 the global limit: 100 open surveys in all - the 101st is 409 for anybody, also with no survey of their own; the 100th is allowed', async () => {
    current = (await bootSync(ON)).app;
    const browser = await signIn('editor');
    const siteId = await insertSite(admin(), { street: STREET, city: CITY });
    await seed(99, null);
    expect((await create(browser, siteId)).status).toBe(201);
    const refused = await create(browser, siteId);
    expect([refused.status, codeOf(refused.body)]).toEqual([409, 'site_survey_limit_exceeded']);
    const other = await signIn('administrator');
    expect(codeOf((await create(other, siteId)).body)).toBe('site_survey_limit_exceeded');
    expect(await orderCount()).toBe(100);
  });

  it('EVM-140 AC4 two parallel creations at 19 open surveys: exactly one 201 and one 409, the creator ends with 20', async () => {
    current = (await bootSync(ON)).app;
    const browser = await signIn('editor');
    const siteId = await insertSite(admin(), { street: STREET, city: CITY });
    await seed(19, browser.userId);
    const answers = await Promise.all([create(browser, siteId), create(browser, siteId)]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([201, 409]);
    expect(codeOf(answers.find((answer) => answer.status === 409)?.body)).toBe('site_survey_limit_exceeded');
    expect(await openOf(browser.userId)).toBe(20);
  });

  it('EVM-140 AC4 an ordinary order is not limited by the surveys', async () => {
    current = (await bootSync(ON)).app;
    const browser = await signIn('editor');
    await seed(20, browser.userId);
    const ordinary = await seed(1, browser.userId, { customer: true });
    expect(ordinary).toHaveLength(1);
    expect(await openOf(browser.userId)).toBe(20);
  });
});

describe('the limit of open surveys of the phone (EVM-140 AC4)', () => {
  const mutation = (siteId: string) => ({
    mutationId: uuidv7(),
    type: 'CreateSiteSurvey',
    commandVersion: 1,
    payload: { workOrderId: uuidv7(), siteId },
  });
  const pushOne = async (phone: Phone, body: unknown) => {
    const response = await phone.post('/api/v1/sync/mutations', { mutations: [body] }, phone.authorised());
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return (response.body as { results: Array<{ outcome: string; code?: string }> }).results[0];
  };

  it('EVM-140 AC4 the 21st survey of the phone is rejected with site_survey_limit_exceeded and leaves nothing behind; the 20th is applied; the number is not used', async () => {
    current = (await bootSync(ON)).app;
    const { account, phone } = await editor(current);
    const siteId = await insertSite(admin(), { street: STREET, city: CITY });
    await seed(19, account.user.id);

    const twentieth = await pushOne(phone, mutation(siteId));
    expect(twentieth).toMatchObject({ outcome: 'applied' });
    const before = await orderCount();
    const refused = await pushOne(phone, mutation(siteId));
    expect(refused).toMatchObject({ outcome: 'rejected', code: 'site_survey_limit_exceeded' });
    expect(await orderCount()).toBe(before);
    expect(await openOf(account.user.id)).toBe(20);
  });

  it('EVM-140 AC4 AC5 the rejection of the limit with a NEW site leaves the site behind no more than any other rejection (the transaction is rolled back) and no street or phone is in the log or the audit trail', async () => {
    current = (await bootSync(ON)).app;
    const { account, phone } = await editor(current);
    await seed(20, account.user.id);
    const sitesBefore = Number((await sql<{ n: string }>`select count(*)::text as n from sites.sites`.execute(admin())).rows[0]?.n);
    const body = {
      mutationId: uuidv7(),
      type: 'CreateSiteSurvey',
      commandVersion: 1,
      payload: {
        workOrderId: uuidv7(),
        newSite: {
          id: uuidv7(),
          siteType: 'single_family_house',
          street: 'ul. Nowa-limitowa-synt',
          buildingNumber: '7',
          postalCode: '99-140',
          city: 'Nowolimitowo',
        },
        requesterPhone: '600 140 140',
      },
    };
    const refused = await pushOne(phone, body);
    expect(refused).toMatchObject({ outcome: 'rejected', code: 'site_survey_limit_exceeded' });
    expect(Number((await sql<{ n: string }>`select count(*)::text as n from sites.sites`.execute(admin())).rows[0]?.n)).toBe(sitesBefore);
    const audit = JSON.stringify((await sql`select to_jsonb(t) as r from audit.events t`.execute(admin())).rows);
    for (const secret of ['Nowa-limitowa-synt', 'Nowolimitowo', '600140140', '600 140 140']) {
      expect(audit).not.toContain(secret);
      expect(current.logs.text).not.toContain(secret);
    }
  });
});

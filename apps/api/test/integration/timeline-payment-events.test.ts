import { Kysely, PostgresDialect, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../src/platform/config/config.ts';
import { createPool, type Database } from '../../src/platform/database/database.ts';
import type { Logger } from '../../src/platform/logging/logger.ts';
import { APP_CONFIG, DATABASE, LOGGER } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertMilestones, type MilestoneSpec } from '../support/payment-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { insertEntries } from '../support/timeline-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

const START = Date.parse('2026-10-13T08:00:00.000Z');
const BASE = '/api/v1/work-orders';
const REASON = 'powod-znacznik-synt';
/** Every statement the application sends (Kysely `log` hook): what the test of N+1 counts. */
const statements: string[] = [];

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp({
    configure: (builder) =>
      builder.overrideProvider(DATABASE).useFactory({
        inject: [APP_CONFIG, LOGGER],
        factory: (config: AppConfig, logger: Logger) =>
          new Kysely<Database>({
            dialect: new PostgresDialect({ pool: createPool({ url: config.databaseUrl, logger }) }),
            log: (event) => {
              if (event.level === 'query') statements.push(event.query.sql);
            },
          }),
      }),
  });
});
afterAll(async () => {
  await current.close();
});
let minute = 0;
beforeEach(async () => {
  minute = 0;
  current.clock.set(new Date(START));
  await clearWorkOrderCreation(current.database.admin);
});
/** A new minute for every write: the order of the journal is then the order of the calls. */
const tick = (): void => {
  minute += 1;
  current.clock.set(new Date(START + minute * 60_000));
};
const admin = () => current.database.admin;

async function signIn() {
  const user = await createUser(admin(), current.clock, { role: 'editor' });
  const session = await createSession(admin(), current.clock, user, { channel: 'web' });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;

let numbering = 0;
async function order(milestones: MilestoneSpec[]) {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `jan${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [
    { number: `ZL-3${String(numbering).padStart(3, '0')}-0154`, customerId, siteId, status: 'in_progress' },
  ]);
  const id = [...ids.values()][0] ?? '';
  return { id, milestoneIds: await insertMilestones(admin(), id, milestones) };
}

const move = async (browser: Browser, orderId: string, milestoneId: string, body: unknown, version: number) => {
  tick();
  const response = await browser.panel.post(`${BASE}/${orderId}/payment-milestones/${milestoneId}/transitions`, body, {
    'If-Match': `"${version}"`,
    'Idempotency-Key': uuidv7(),
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
};
const cancelOrder = async (browser: Browser, orderId: string) => {
  tick();
  const response = await browser.panel.post(
    `${BASE}/${orderId}/transitions`,
    { to: 'cancelled', reason: REASON },
    { 'If-Match': '"1"', 'Idempotency-Key': uuidv7() },
  );
  expect(response.status, JSON.stringify(response.body)).toBe(200);
};

interface EventView {
  code: string;
  objectType: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  paymentMilestone?: { id: string; name: string | null };
  [key: string]: unknown;
}
interface Page {
  items: Array<{ id: string; createdAt: string; event: EventView | null }>;
}
const journal = async (browser: Browser, orderId: string, query = '') => {
  const response = await browser.panel.get(`${BASE}/${orderId}/timeline${query}`);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as Page;
};

describe('the journal of the payments of an order (EVM-054 AC3; EVM-038; SR-LOG-03, SR-DATA-01)', () => {
  it('EVM-054 AC3 every change of the status of a milestone — invoice, payment, cancellation and the effect of the cancellation of the order — is an event with the codes of the statuses, no amount; the filter "Płatności" shows them', async () => {
    const editor = await signIn();
    const created = await order([
      { name: 'Zaliczka', paymentTermDays: 7 },
      { name: 'Płatność końcowa' },
      { name: 'Dodatkowa' },
      { name: 'Po montażu' },
    ]);
    const [advance, final, extra, last] = created.milestoneIds as [string, string, string, string];
    await move(
      editor,
      created.id,
      advance,
      { to: 'invoiced', amount: { amountMinor: 123000, currency: 'PLN' }, invoiceNumber: 'FV/TEST/0021/2026' },
      1,
    );
    await move(editor, created.id, advance, { to: 'paid' }, 2);
    await move(editor, created.id, extra, { to: 'cancelled', reason: REASON }, 1);
    await cancelOrder(editor, created.id);

    const page = await journal(editor, created.id, '?eventGroup=payments');
    expect(page.items.map((item) => [item.event?.paymentMilestone?.name, item.event?.fromStatus, item.event?.toStatus])).toEqual([
      ['Po montażu', 'planned', 'cancelled'],
      ['Płatność końcowa', 'planned', 'cancelled'],
      ['Dodatkowa', 'planned', 'cancelled'],
      ['Zaliczka', 'invoiced', 'paid'],
      ['Zaliczka', 'planned', 'invoiced'],
    ]);
    for (const item of page.items) {
      expect(item.event).toMatchObject({ code: 'payment_milestone_status_changed', objectType: 'payment_milestone' });
      expect(JSON.stringify(item.event)).not.toMatch(/amount|123000|FV\/TEST|powod/);
    }
    expect(page.items.map((item) => item.event?.paymentMilestone?.id)).toEqual([last, final, extra, advance, advance]);
    const { rows } = await sql<{ event_payload: unknown }>`
      select event_payload from timeline.timeline_entries where work_order_id = ${created.id} and kind = 'event'`.execute(admin());
    expect(JSON.stringify(rows)).not.toMatch(/amount|123000|FV\/TEST|Zaliczka|powod/);
  });

  it('EVM-054 AC3 the groups are disjoint: "Zmiany statusów" has the status of the order and no change of a payment; the whole journal has both', async () => {
    const editor = await signIn();
    const created = await order([{}]);
    await cancelOrder(editor, created.id);
    const statuses = await journal(editor, created.id, '?eventGroup=status_changes');
    expect(statuses.items.map((item) => item.event?.code)).toEqual(['work_order_status_changed']);
    const payments = await journal(editor, created.id, '?eventGroup=payments');
    expect(payments.items.map((item) => item.event?.code)).toEqual(['payment_milestone_status_changed']);
    const all = await journal(editor, created.id);
    expect(all.items.map((item) => item.event?.code).sort()).toEqual(['payment_milestone_status_changed', 'work_order_status_changed']);
  });

  it('EVM-054 AC3 the entries written in one transaction keep one deterministic order (createdAt, then the identifier) on every read', async () => {
    const editor = await signIn();
    const created = await order([{}, {}, {}]);
    await cancelOrder(editor, created.id);
    const first = await journal(editor, created.id);
    const second = await journal(editor, created.id);
    expect(first.items.map((item) => item.id)).toEqual(second.items.map((item) => item.id));
    const times = new Set(first.items.map((item) => item.createdAt));
    expect(times.size).toBe(1);
    expect(first.items.map((item) => item.id)).toEqual([...first.items.map((item) => item.id)].sort().reverse());
  });

  it('EVM-054 AC3 K9 CWE-639 the name comes from the current data of THIS order: a deleted milestone has none, the milestone of another order named in an event has none', async () => {
    const editor = await signIn();
    const created = await order([{ name: 'Zaliczka' }]);
    const other = await order([{ name: 'Cudza transza' }]);
    const milestoneId = created.milestoneIds[0] ?? '';
    await move(editor, created.id, milestoneId, { to: 'cancelled', reason: REASON }, 1);
    await insertEntries(admin(), created.id, editor.userId, [
      {
        kind: 'event',
        eventCode: 'payment_milestone_status_changed',
        eventPayload: { objectType: 'payment_milestone', objectId: other.milestoneIds[0], fromStatus: 'planned', toStatus: 'cancelled' },
      },
    ]);
    const names = (await journal(editor, created.id, '?eventGroup=payments')).items.map((item) => item.event?.paymentMilestone);
    expect(names).toContainEqual({ id: other.milestoneIds[0], name: null });
    expect(names).toContainEqual({ id: milestoneId, name: 'Zaliczka' });
    await sql`update payments.payment_milestones set deleted_at = ${new Date(START)} where id = ${milestoneId}`.execute(admin());
    const after = (await journal(editor, created.id, '?eventGroup=payments')).items.map((item) => item.event?.paymentMilestone);
    expect(after).toContainEqual({ id: milestoneId, name: null });
    expect(JSON.stringify(after)).not.toContain('Cudza');
  });

  it('EVM-054 AC3 SR-API-02 the names of the milestones of a page are ONE query, whatever the number of events', async () => {
    const editor = await signIn();
    const created = await order(Array.from({ length: 6 }, (_, index) => ({ name: `Transza ${index + 1}` })));
    await cancelOrder(editor, created.id);
    for (const limit of [2, 7]) {
      statements.length = 0;
      const page = await journal(editor, created.id, `?eventGroup=payments&limit=${limit}`);
      expect(page.items.length).toBe(Math.min(limit, 6));
      expect(
        statements.filter((text) => text.includes('"payments"."payment_milestones"')),
        String(limit),
      ).toHaveLength(1);
    }
  });
});

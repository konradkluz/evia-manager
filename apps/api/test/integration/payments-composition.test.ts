import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkOrderCompositionRegistry, type WorkOrderCompositionContributor } from '../../src/modules/work-orders/index.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, ISSUED_AT, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser } from '../support/identity-fixtures.ts';
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

const admin = () => current.database.admin;
const CREATE = '/api/v1/work-orders';

async function signIn() {
  const user = await createUser(admin(), current.clock, { role: 'editor' });
  const session = await createSession(admin(), current.clock, user, { channel: 'web' });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}

const templateId = async (code: string): Promise<string> =>
  (await sql<{ id: string }>`select id from catalog.work_order_templates where code = ${code}`.execute(admin())).rows[0]?.id ?? '';
async function newOrder(template: { code: string } | { id: string } | null, key: string = uuidv7()) {
  const customerId = await insertCustomer(admin(), { email: 'jan@example.invalid' });
  const siteId = await insertSite(admin());
  const browser = await signIn();
  const id = template === null ? null : 'id' in template ? template.id : await templateId(template.code);
  const body = { id: uuidv7(), customerId, siteId, templateId: id };
  const response = await browser.panel.post(CREATE, body).set('Idempotency-Key', key);
  return { browser, body, response, key };
}

interface MilestoneRow {
  code: string | null;
  name: string;
  position: number;
  share_percent: number | null;
  payment_term_days: number | null;
  amount_minor: string | null;
  currency: string | null;
  status: string;
  version: number;
  source_template_id: string | null;
  created_by: string | null;
}
const milestonesOf = async (workOrderId: string): Promise<MilestoneRow[]> =>
  (
    await sql<MilestoneRow>`
      select code, name, position, share_percent, payment_term_days, amount_minor, currency, status, version, source_template_id, created_by
      from payments.payment_milestones where work_order_id = ${workOrderId} order by position`.execute(admin())
  ).rows;
const total = async (): Promise<number> =>
  Number((await sql<{ n: string }>`select count(*)::text as n from payments.payment_milestones`.execute(admin())).rows[0]?.n);

describe('the payment milestones of a new order (EVM-053 AC1; domain-model → "Kompozycja zlecenia z szablonu")', () => {
  it('EVM-053 AC1 the template "Garaż — pełny proces" (20/30/30/20) gives 4 milestones "Planowana" with the names, shares and payment terms of the plan, without amounts, in the order of the plan', async () => {
    const { response, body, browser } = await newOrder({ code: 'garage_full_process' });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const { rows: plan } = await sql<{ id: string; code: string; name: string; share_percent: number; payment_term_days: number }>`
      select milestone.id, milestone.code, milestone.name, milestone.share_percent, milestone.payment_term_days
      from catalog.payment_milestone_templates milestone
      join catalog.work_order_templates template on template.id = milestone.work_order_template_id
      where template.code = 'garage_full_process' and milestone.deleted_at is null order by milestone.position`.execute(admin());
    expect(plan.map((milestone) => milestone.share_percent)).toEqual([20, 30, 30, 20]);

    const milestones = await milestonesOf(body.id);
    expect(milestones).toEqual(
      plan.map((milestone, index) => ({
        code: milestone.code,
        name: milestone.name,
        position: index + 1,
        share_percent: milestone.share_percent,
        payment_term_days: milestone.payment_term_days,
        amount_minor: null,
        currency: null,
        status: 'planned',
        version: 1,
        source_template_id: milestone.id,
        created_by: browser.userId,
      })),
    );
    expect(milestones[0]).toMatchObject({ name: 'Zaliczka', payment_term_days: 7 });
  });

  it('EVM-053 AC1 the list of the order shows the 4 copied milestones (W-06)', async () => {
    const { body, browser } = await newOrder({ code: 'garage_full_process' });
    const list = await browser.panel.get(`${CREATE}/${body.id}/payment-milestones`);
    expect(list.status).toBe(200);
    const items = (list.body as { items: Array<{ name: string; sharePercent: number; status: string; amount: unknown }> }).items;
    expect(items.map((item) => [item.sharePercent, item.status, item.amount])).toEqual([
      [20, 'planned', null],
      [30, 'planned', null],
      [30, 'planned', null],
      [20, 'planned', null],
    ]);
  });

  it('EVM-053 AC1 a template without a payment plan gives an order without milestones; so does an order without a template', async () => {
    const at = '2026-10-13T08:00:00Z';
    const { rows: created } = await sql<{ id: string }>`
      insert into catalog.work_order_templates (code, name, is_active, position, created_at, updated_at)
      values ('test_no_payment_plan', 'Szablon bez planu płatności', true, 97, ${at}, ${at}) returning id`.execute(admin());
    const templateRow = created[0]?.id ?? '';
    try {
      const fromTemplate = await newOrder({ id: templateRow });
      expect(fromTemplate.response.status, JSON.stringify(fromTemplate.response.body)).toBe(201);
      expect(await milestonesOf(fromTemplate.body.id)).toEqual([]);
      const empty = await newOrder(null);
      expect(empty.response.status).toBe(201);
      expect(await total()).toBe(0);
    } finally {
      await clearWorkOrderCreation(admin());
      await sql`delete from catalog.work_order_templates where id = ${templateRow}`.execute(admin());
    }
  });

  it('EVM-053 AC1 a repeat of the creation (same key and id) does not make the milestones twice; two orders have their own copies', async () => {
    const first = await newOrder({ code: 'garage_full_process' });
    const repeat = await first.browser.panel.post(CREATE, first.body).set('Idempotency-Key', first.key);
    expect(repeat.status).toBe(201);
    expect(repeat.headers['idempotent-replayed']).toBe('true');
    expect(await total()).toBe(4);
    await newOrder({ code: 'garage_full_process' });
    expect(await total()).toBe(8);
  });
});

describe('one transaction with the order (EVM-053 AC1; SR-API-06 — fail closed)', () => {
  let failing = false;
  const contributor: WorkOrderCompositionContributor = {
    name: 'zz-after-payments',
    order: 300,
    contribute: async (tx) => {
      await sql`select 1`.execute(tx);
      if (failing) throw new Error('contributor failed');
    },
  };
  beforeAll(() => {
    current.app.get(WorkOrderCompositionRegistry).register(contributor);
  });
  beforeEach(() => {
    failing = false;
  });

  it('EVM-053 AC1 a contributor that fails AFTER the milestones were written: 500, and there is no order, no milestone, no audit event, no idempotency record, the number is not used', async () => {
    failing = true;
    const { response, body, browser, key } = await newOrder({ code: 'garage_full_process' });
    expect(response.status).toBe(500);
    expect(await total()).toBe(0);
    const counts = await sql<{ orders: string; events: string; records: string; counters: string }>`
      select (select count(*) from work_orders.work_orders)::text as orders,
             (select count(*) from audit.events where object_id = ${body.id})::text as events,
             (select count(*) from platform.idempotency_records)::text as records,
             (select count(*) from work_orders.number_counters)::text as counters`.execute(admin());
    expect(counts.rows[0]).toEqual({ orders: '0', events: '0', records: '0', counters: '0' });

    failing = false;
    const retried = await browser.panel.post(CREATE, body).set('Idempotency-Key', key);
    expect(retried.status, JSON.stringify(retried.body)).toBe(201);
    expect((retried.body as { number: string }).number).toMatch(/-0001$/);
    expect(await total()).toBe(4);
  });

  it('EVM-053 AC1 a payment plan of more than 20 milestones fails the creation (CHECK of the catalogue aside): the contributor throws, nothing is trimmed', async () => {
    const at = '2026-10-13T08:00:00Z';
    const { rows: created } = await sql<{ id: string }>`
      insert into catalog.work_order_templates (code, name, is_active, position, created_at, updated_at)
      values ('test_long_plan', 'Szablon z długim planem', true, 96, ${at}, ${at}) returning id`.execute(admin());
    const templateRow = created[0]?.id ?? '';
    // the catalogue allows positions 1..20 only (a CHECK), so the test drops that CHECK for its duration: the planner must refuse a
    // plan of 21 milestones whatever the catalogue lets through (defence in depth)
    await sql`alter table catalog.payment_milestone_templates drop constraint payment_milestone_templates_position_check`.execute(admin());
    try {
      for (let position = 1; position <= 21; position += 1) {
        await sql`
          insert into catalog.payment_milestone_templates (work_order_template_id, code, name, position, share_percent, invoice_hint,
            payment_term_days, created_at, updated_at)
          values (${templateRow}, ${`part_${position}`}, ${`Część ${position}`}, ${position}, 5, 'po etapie', 7, ${at}, ${at})`.execute(
          admin(),
        );
      }
      const { response } = await newOrder({ id: templateRow });
      expect(response.status).toBe(500);
      expect(await total()).toBe(0);
      expect(Number((await sql<{ n: string }>`select count(*)::text as n from work_orders.work_orders`.execute(admin())).rows[0]?.n)).toBe(
        0,
      );
    } finally {
      await sql`delete from catalog.payment_milestone_templates where work_order_template_id = ${templateRow}`.execute(admin());
      await sql`alter table catalog.payment_milestone_templates add constraint payment_milestone_templates_position_check
        check (position between 1 and 20)`.execute(admin());
      await sql`delete from catalog.work_order_templates where id = ${templateRow}`.execute(admin());
    }
  });
});

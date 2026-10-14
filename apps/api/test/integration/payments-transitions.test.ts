import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkOrderTransitionRegistry, type WorkOrderTransitionParticipant } from '../../src/modules/work-orders/index.ts';
import type { WorkOrderStatus } from '../../src/modules/work-orders/domain/work-order-status.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, ISSUED_AT, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertMilestones, type MilestoneSpec } from '../support/payment-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

/** A participant AFTER `payments` that fails on demand: its error must roll back the effect of `payments` as well (SR-API-06). */
let failApply = false;
const FAILING: WorkOrderTransitionParticipant = {
  name: 'zz-after-payments',
  order: 1000,
  check: () => Promise.resolve(undefined),
  apply: async (tx) => {
    await sql`select 1`.execute(tx);
    if (failApply) throw new Error('the participant failed');
  },
};

let current: IdentityApp;
let tests = 0;
beforeAll(async () => {
  current = await createIdentityApp();
  current.app.get(WorkOrderTransitionRegistry).register(FAILING);
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  tests += 1;
  current.clock.set(new Date(Date.parse(ISSUED_AT) + tests * 61_000)); // a new minute for every test: the per-address limit never adds up
  failApply = false;
  await clearWorkOrderCreation(current.database.admin);
});

const admin = () => current.database.admin;
const BASE = '/api/v1/work-orders';
const REASON = 'Rezygnacja klienta';

async function signIn(role: 'editor' | 'administrator' = 'editor') {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, { channel: 'web' });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, sessionId: session.id, panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;

let numbering = 0;
async function order(status: WorkOrderStatus, milestones: MilestoneSpec[]) {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `jan${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [{ number: `ZL-3${String(numbering).padStart(3, '0')}-0530`, status, customerId, siteId }]);
  const id = [...ids.values()][0] ?? '';
  if (status === 'on_hold') await sql`update work_orders.work_orders set resume_status = 'in_progress' where id = ${id}`.execute(admin());
  if (status === 'completed') await sql`update work_orders.work_orders set completed_on = '2026-10-12' where id = ${id}`.execute(admin());
  return { id, milestoneIds: await insertMilestones(admin(), id, milestones) };
}

const go = (browser: Browser, orderId: string, to: WorkOrderStatus, extra: Record<string, unknown> = {}) =>
  browser.panel.post(`${BASE}/${orderId}/transitions`, { to, ...extra }, { 'If-Match': '"1"', 'Idempotency-Key': uuidv7() });
const addMilestone = (browser: Browser, orderId: string) =>
  browser.panel.post(`${BASE}/${orderId}/payment-milestones`, { id: uuidv7(), name: 'Dopłata' }, { 'Idempotency-Key': uuidv7() });

const statusOf = async (orderId: string): Promise<string> =>
  (await sql<{ status: string }>`select status from work_orders.work_orders where id = ${orderId}`.execute(admin())).rows[0]?.status ?? '';
const milestonesOf = async (orderId: string) =>
  (
    await sql<{ id: string; status: string; version: number; updated_by: string | null }>`
      select id, status, version, updated_by from payments.payment_milestones where work_order_id = ${orderId} order by position`.execute(
      admin(),
    )
  ).rows;

describe('the settlement of an order with milestones (EVM-053 AC6; SR-API-06)', () => {
  it('EVM-053 AC6 an order "Zakończone" with a milestone "Planowana" is 422 transition_condition_not_met with /to unpaid_milestones; nothing changes', async () => {
    const editor = await signIn();
    const completed = await order('completed', [{ status: 'paid' }, {}]);
    const response = await go(editor, completed.id, 'settled');
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: 'transition_condition_not_met',
      errors: [{ pointer: '/to', code: 'unpaid_milestones' }],
    });
    expect(await statusOf(completed.id)).toBe('completed');
    expect((await milestonesOf(completed.id)).map((milestone) => milestone.status)).toEqual(['paid', 'planned']);
  });

  it('EVM-053 AC6 an invoiced milestone keeps the order from being settled as well; paid and cancelled ones do not', async () => {
    const editor = await signIn();
    const invoiced = await order('completed', [{ status: 'invoiced' }]);
    expect((await go(editor, invoiced.id, 'settled')).status).toBe(422);
    const done = await order('completed', [{ status: 'paid' }, { status: 'cancelled' }]);
    const response = await go(editor, done.id, 'settled');
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(await statusOf(done.id)).toBe('settled');
  });

  it('EVM-053 AC6 an order without milestones is settled as in EVM-030 (regression)', async () => {
    const editor = await signIn();
    const bare = await order('completed', []);
    expect((await go(editor, bare.id, 'settled')).status).toBe(200);
    expect(await statusOf(bare.id)).toBe('settled');
  });
});

describe('the cancellation of an order with milestones (EVM-053 AC6; SR-API-06, SR-LOG-03)', () => {
  it.each(['in_progress', 'on_hold'] as const)(
    'EVM-053 AC6 an order "%s" with 3 milestones "Planowana" is cancelled in ONE transaction with its 3 milestones "Anulowana" — the actor of the command, one audit event with the amount each; a paid milestone stays',
    async (from) => {
      const editor = await signIn();
      const created = await order(from, [{ amountMinor: 360000 }, {}, { status: 'paid', amountMinor: 1000 }, { amountMinor: 5 }]);
      const response = await go(editor, created.id, 'cancelled', { reason: REASON });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(await statusOf(created.id)).toBe('cancelled');
      const milestones = await milestonesOf(created.id);
      expect(milestones.map((milestone) => [milestone.status, milestone.version, milestone.updated_by])).toEqual([
        ['cancelled', 2, editor.userId],
        ['cancelled', 2, editor.userId],
        ['paid', 1, null],
        ['cancelled', 2, editor.userId],
      ]);

      const { rows: events } = await sql<{
        action: string;
        object_id: string;
        actor_user_id: string;
        session_id: string;
        trace_id: string;
        amount_before_minor: string | null;
        amount_after_minor: string | null;
        currency: string | null;
      }>`select action, object_id, actor_user_id, session_id, trace_id, amount_before_minor, amount_after_minor, currency
         from audit.events where object_id in (${created.id}, ${created.milestoneIds[0]}, ${created.milestoneIds[1]}, ${created.milestoneIds[2]},
           ${created.milestoneIds[3]}) order by occurred_at, id`.execute(admin());
      const command = events.find((event) => event.action === 'work_order.cancelled');
      const effects = events.filter((event) => event.action === 'payment_milestone.cancelled');
      expect(effects.map((event) => [event.object_id, event.amount_after_minor, event.currency])).toEqual([
        [created.milestoneIds[0], '360000', 'PLN'],
        [created.milestoneIds[1], null, null],
        [created.milestoneIds[3], '5', 'PLN'],
      ]);
      for (const effect of effects) {
        expect(effect).toMatchObject({ actor_user_id: editor.userId, session_id: editor.sessionId, trace_id: command?.trace_id });
      }
      expect(JSON.stringify(events)).not.toContain(REASON);
    },
  );

  it('EVM-053 AC6 SR-API-06 a participant that fails after payments rolls the whole command back: the order, the milestones and the audit trail are unchanged', async () => {
    const editor = await signIn();
    const created = await order('in_progress', [{}, {}, {}]);
    failApply = true;
    const response = await go(editor, created.id, 'cancelled', { reason: REASON });
    expect(response.status).toBe(500);
    expect(await statusOf(created.id)).toBe('in_progress');
    expect((await milestonesOf(created.id)).map((milestone) => [milestone.status, milestone.version])).toEqual([
      ['planned', 1],
      ['planned', 1],
      ['planned', 1],
    ]);
    const { rows } = await sql<{ n: string }>`
      select count(*)::text as n from audit.events
      where object_id in (${created.id}, ${created.milestoneIds[0]}, ${created.milestoneIds[1]}, ${created.milestoneIds[2]})`.execute(
      admin(),
    );
    expect(rows[0]?.n).toBe('0');
  });
});

async function holdOrder(orderId: string) {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked: () => void = () => undefined;
  const isLocked = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const holder = admin()
    .transaction()
    .execute(async (tx) => {
      await sql`select id from work_orders.work_orders where id = ${orderId} for no key update`.execute(tx);
      locked();
      await released;
    });
  await isLocked;
  return { release, holder };
}
/** Polls PostgreSQL (a query per round, no timer) until `count` sessions wait for a lock; fails after a bounded number of rounds. */
async function waitForWaiters(count: number): Promise<void> {
  for (let round = 0; round < 2000; round += 1) {
    const { rows } = await sql<{ n: string }>`
      select count(*)::text as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`.execute(admin());
    if (Number(rows[0]?.n) >= count) return;
  }
  throw new Error(`fewer than ${String(count)} sessions waited for the lock`);
}

/**
 * Deterministic concurrency (no sleep): a third session holds the lock of the order row; the two commands are sent one after the other
 * and each is let go only once PostgreSQL shows it WAITING for that lock; then the lock is released and the queue of the lock (first in,
 * first out) decides who goes first. Both orders of arrival are tested; neither may end with a settled order and a planned milestone.
 */
describe('a milestone added while the order is being settled (EVM-053 AC6; SR-API-07, ASVS V2.3.3)', () => {
  it('EVM-053 AC6 the settlement first: it is 200 and the addition that waited is 409 work_order_closed — no planned milestone in a settled order', async () => {
    const editor = await signIn();
    const completed = await order('completed', [{ status: 'paid' }]);
    const { release, holder } = await holdOrder(completed.id);
    const settling = go(editor, completed.id, 'settled').then((response) => response);
    await waitForWaiters(1);
    const adding = addMilestone(editor, completed.id).then((response) => response);
    await waitForWaiters(2);
    release();
    await holder;
    const [settled, added] = await Promise.all([settling, adding]);
    expect(settled.status).toBe(200);
    expect(added.status).toBe(409);
    expect((added.body as { code: string }).code).toBe('work_order_closed');
    expect(await statusOf(completed.id)).toBe('settled');
    expect((await milestonesOf(completed.id)).map((milestone) => milestone.status)).toEqual(['paid']);
  });

  it('EVM-053 AC6 the addition first: it is 201 and the settlement that waited sees the new milestone — 422 unpaid_milestones, the order stays completed', async () => {
    const editor = await signIn();
    const completed = await order('completed', [{ status: 'paid' }]);
    const { release, holder } = await holdOrder(completed.id);
    const adding = addMilestone(editor, completed.id).then((response) => response);
    await waitForWaiters(1);
    const settling = go(editor, completed.id, 'settled').then((response) => response);
    await waitForWaiters(2);
    release();
    await holder;
    const [added, settled] = await Promise.all([adding, settling]);
    expect(added.status).toBe(201);
    expect(settled.status).toBe(422);
    expect(settled.body).toMatchObject({ errors: [{ pointer: '/to', code: 'unpaid_milestones' }] });
    expect(await statusOf(completed.id)).toBe('completed');
    expect((await milestonesOf(completed.id)).map((milestone) => milestone.status)).toEqual(['paid', 'planned']);
  });
});

const invoice = (browser: Browser, orderId: string, milestoneId: string) =>
  browser.panel.post(
    `${BASE}/${orderId}/payment-milestones/${milestoneId}/transitions`,
    { to: 'invoiced', amount: { amountMinor: 123000, currency: 'PLN' }, invoiceNumber: 'FV/TEST/0021/2026', dueDate: '2026-12-31' },
    { 'If-Match': '"1"', 'Idempotency-Key': uuidv7() },
  );
/** The invariant of AC6 over the WHOLE database: no closed order holds a live invoiced milestone. */
const closedWithInvoice = async (): Promise<number> =>
  Number(
    (
      await sql<{ n: string }>`
        select count(*)::text as n from work_orders.work_orders o
        join payments.payment_milestones m on m.work_order_id = o.id and m.deleted_at is null
        where o.status in ('cancelled', 'settled') and m.status = 'invoiced'`.execute(admin())
    ).rows[0]?.n,
  );

describe('the cancellation of an order with an invoiced milestone (EVM-054 AC6; SR-AUTHZ-10, SR-API-06)', () => {
  it.each([
    ['in_progress', 'editor'],
    ['in_progress', 'administrator'],
    ['on_hold', 'editor'],
    ['on_hold', 'administrator'],
  ] as const)(
    'EVM-054 AC6 an order "%s" with an invoiced and a planned milestone cancelled by the %s is 422 transition_condition_not_met (/to, invoiced_milestones): the order and both milestones stay, no audit event, no journal entry',
    async (from, role) => {
      const browser = await signIn(role);
      const created = await order(from, [{ status: 'invoiced' }, { amountMinor: 5 }]);
      const response = await go(browser, created.id, 'cancelled', { reason: REASON });
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({
        code: 'transition_condition_not_met',
        errors: [{ pointer: '/to', code: 'invoiced_milestones' }],
      });
      expect(await statusOf(created.id)).toBe(from);
      expect((await milestonesOf(created.id)).map((milestone) => [milestone.status, milestone.version])).toEqual([
        ['invoiced', 1],
        ['planned', 1],
      ]);
      const ids = [created.id, ...created.milestoneIds];
      const { rows: audit } = await sql<{ n: string }>`
        select count(*)::text as n from audit.events where object_id in (${ids[0]}, ${ids[1]}, ${ids[2]})`.execute(admin());
      expect(audit[0]?.n).toBe('0');
      const { rows: journal } = await sql<{ n: string }>`
        select count(*)::text as n from timeline.timeline_entries where work_order_id = ${created.id}`.execute(admin());
      expect(journal[0]?.n).toBe('0');
    },
  );

  it('EVM-054 AC6 after the payment the same order is cancelled: the planned milestone is cancelled with its journal entry, the paid one stays', async () => {
    const editor = await signIn();
    const created = await order('in_progress', [{ status: 'paid' }, {}]);
    expect((await go(editor, created.id, 'cancelled', { reason: REASON })).status).toBe(200);
    expect((await milestonesOf(created.id)).map((milestone) => milestone.status)).toEqual(['paid', 'cancelled']);
    const { rows } = await sql<{ event_code: string; event_payload: Record<string, unknown> }>`
      select event_code, event_payload from timeline.timeline_entries
      where work_order_id = ${created.id} and event_code = 'payment_milestone_status_changed'`.execute(admin());
    expect(rows).toEqual([
      {
        event_code: 'payment_milestone_status_changed',
        event_payload: { objectType: 'payment_milestone', objectId: created.milestoneIds[1], fromStatus: 'planned', toStatus: 'cancelled' },
      },
    ]);
    const { rows: audit } = await sql<{ from_code: string; to_code: string }>`
      select from_code, to_code from audit.events where object_id = ${created.milestoneIds[1]}`.execute(admin());
    expect(audit).toEqual([{ from_code: 'planned', to_code: 'cancelled' }]);
  });
});

/**
 * The conditions do not depend on a limit of rows (SR-AUTHZ-10, CWE-841): today the CHECK `position between 1 and 20` and the partial
 * unique index of the position keep an order at 20 live milestones, but the condition of a transition must not lean on that — a
 * restore (EVM-057), a defect or a migration may loosen it. The test drops that CHECK for its duration (the precedent of
 * `payments-composition.test.ts`), writes 21 live milestones straight into the database with the blocking one at the LAST position,
 * and restores the CHECK in `finally`.
 */
describe('the conditions of a transition read every live milestone, beyond the limit of 20 (EVM-054 AC6; SR-AUTHZ-10, CWE-841)', () => {
  const OVER_LIMIT = 21;
  const paidThen = (last: MilestoneSpec): MilestoneSpec[] => [
    ...Array.from({ length: OVER_LIMIT - 1 }, (): MilestoneSpec => ({ status: 'paid' })),
    last,
  ];
  async function withoutPositionCheck(body: () => Promise<void>): Promise<void> {
    await sql`alter table payments.payment_milestones drop constraint payment_milestones_position_check`.execute(admin());
    try {
      await body();
    } finally {
      await sql`delete from payments.payment_milestones where position > 20`.execute(admin());
      await sql`alter table payments.payment_milestones add constraint payment_milestones_position_check
        check (position between 1 and 20)`.execute(admin());
    }
  }

  it('EVM-054 AC6 an order with 21 live milestones and the invoiced one at the last position is 422 invoiced_milestones on a cancellation; nothing changes', async () => {
    const editor = await signIn();
    await withoutPositionCheck(async () => {
      const created = await order('in_progress', paidThen({ status: 'invoiced' }));
      const response = await go(editor, created.id, 'cancelled', { reason: REASON });
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({
        code: 'transition_condition_not_met',
        errors: [{ pointer: '/to', code: 'invoiced_milestones' }],
      });
      expect(await statusOf(created.id)).toBe('in_progress');
      expect((await milestonesOf(created.id)).at(-1)?.status).toBe('invoiced');
      expect(await closedWithInvoice()).toBe(0);
    });
  });

  it('EVM-054 AC6 an order with 21 live milestones and the planned one at the last position is 422 unpaid_milestones on a settlement; nothing changes', async () => {
    const editor = await signIn();
    await withoutPositionCheck(async () => {
      const completed = await order('completed', paidThen({}));
      const response = await go(editor, completed.id, 'settled');
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({
        code: 'transition_condition_not_met',
        errors: [{ pointer: '/to', code: 'unpaid_milestones' }],
      });
      expect(await statusOf(completed.id)).toBe('completed');
      expect((await milestonesOf(completed.id)).at(-1)?.status).toBe('planned');
    });
  });
});

/**
 * Deterministic concurrency of AC6 (no sleep; the barrier of EVM-053): a third session holds the lock of the order; the invoice of a
 * milestone and the cancellation of the order are sent one after the other and each is let go only once PostgreSQL shows it WAITING
 * for that lock; the queue of the lock decides who goes first. Both orders of arrival; after each the invariant of the whole database.
 */
describe('an invoice issued while the order is being cancelled (EVM-054 AC6; CWE-362, ASVS V2.3.3)', () => {
  it('EVM-054 AC6 the invoice first: it is 200 and the cancellation that waited sees the invoiced milestone — 422 invoiced_milestones, the order stays', async () => {
    const editor = await signIn();
    const created = await order('in_progress', [{ amountMinor: 1 }]);
    const milestoneId = created.milestoneIds[0] ?? '';
    const { release, holder } = await holdOrder(created.id);
    const invoicing = invoice(editor, created.id, milestoneId).then((response) => response);
    await waitForWaiters(1);
    const cancelling = go(editor, created.id, 'cancelled', { reason: REASON }).then((response) => response);
    await waitForWaiters(2);
    release();
    await holder;
    const [invoiced, cancelled] = await Promise.all([invoicing, cancelling]);
    expect(invoiced.status, JSON.stringify(invoiced.body)).toBe(200);
    expect(cancelled.status).toBe(422);
    expect(cancelled.body).toMatchObject({ errors: [{ pointer: '/to', code: 'invoiced_milestones' }] });
    expect(await statusOf(created.id)).toBe('in_progress');
    expect((await milestonesOf(created.id)).map((milestone) => milestone.status)).toEqual(['invoiced']);
    expect(await closedWithInvoice()).toBe(0);
  });

  it('EVM-054 AC6 the cancellation first: it is 200 (the planned milestone is cancelled) and the invoice that waited is 409 work_order_closed — never "Wystawiona" in "Anulowane"', async () => {
    const editor = await signIn();
    const created = await order('in_progress', [{ amountMinor: 1 }]);
    const milestoneId = created.milestoneIds[0] ?? '';
    const { release, holder } = await holdOrder(created.id);
    const cancelling = go(editor, created.id, 'cancelled', { reason: REASON }).then((response) => response);
    await waitForWaiters(1);
    const invoicing = invoice(editor, created.id, milestoneId).then((response) => response);
    await waitForWaiters(2);
    release();
    await holder;
    const [cancelled, invoiced] = await Promise.all([cancelling, invoicing]);
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(invoiced.status).toBe(409);
    expect((invoiced.body as { code: string }).code).toBe('work_order_closed');
    expect(await statusOf(created.id)).toBe('cancelled');
    expect((await milestonesOf(created.id)).map((milestone) => milestone.status)).toEqual(['cancelled']);
    expect(await closedWithInvoice()).toBe(0);
  });
});

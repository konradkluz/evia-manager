import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { BASE, useDeletionApp, type Browser } from '../support/deletion-harness.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';
import { SiteSurveyReminderJob } from '../../src/modules/work-orders/index.ts';
import type { WorkOrderStatus } from '../../src/modules/work-orders/domain/work-order-status.ts';

/**
 * The rejection and the restoration of a site survey (EVM-136 AC5; ADR-0024 pt 9; decision 11): the Editor or the Administrator cancels an open survey with a
 * fixed code of the reason, the deadline becomes the smaller of (the current one, now + 14 days); only the Administrator with a step-up restores it, and the
 * deadline becomes the greater of (creation + 90 days x (1 + extensions), now + 14 days). The clock is frozen per test, so every deadline is an exact instant.
 * Synthetic data: the street, the city, the postal code and the phone of the requester carry sentinels that must stay out of every trail.
 */
const harness = useDeletionApp();
const { app, admin } = harness;
const DAY = 86_400_000;
const STREET = 'ul. Znacznik-odrzucenia-synt';
const CITY = 'Odrzucenowo-synt';
const POSTAL = '99-937';
const PHONE = '+48600937001';
let numbering = 0;

const nowMs = (): number => app().clock.now().getTime();
const inDays = (days: number): Date => new Date(nowMs() + days * DAY);

interface SurveySpec {
  readonly status?: WorkOrderStatus;
  /** the survey was created this many days ago */
  readonly createdDaysAgo?: number;
  /** the deadline is this many days from now (negative: it has passed) */
  readonly expiresInDays?: number;
  readonly extensions?: number;
}

async function survey(spec: SurveySpec = {}): Promise<string> {
  numbering += 1;
  const ids = await insertWorkOrders(admin(), [
    {
      number: `ZL-9${String(numbering).padStart(3, '0')}-0136`,
      createdAt: inDays(-(spec.createdDaysAgo ?? 20)),
      siteSurveyExpiresAt: inDays(spec.expiresInDays ?? 70),
      siteId: await insertSite(admin(), { street: STREET, city: CITY, postalCode: POSTAL }),
      status: spec.status ?? 'quoting',
      ...(spec.status === 'cancelled' ? { closedAt: inDays(-1) } : {}),
    },
  ]);
  const id = [...ids.values()][0] ?? '';
  await sql`
    update work_orders.work_orders set requester_phone = ${PHONE}, site_survey_extensions = ${spec.extensions ?? 0} where id = ${id}`.execute(
    admin(),
  );
  return id;
}

interface Row {
  status: string;
  version: number;
  customer_id: string | null;
  status_reason: string | null;
  resume_status: string | null;
  closed_at: Date | null;
  site_survey_expires_at: Date | null;
}
const rowOf = async (id: string): Promise<Row> =>
  (
    await sql<Row>`
      select status, version, customer_id, status_reason, resume_status, closed_at, site_survey_expires_at
      from work_orders.work_orders where id = ${id}`.execute(admin())
  ).rows[0] as Row;
const move = (browser: Browser, id: string, body: unknown, version: number) =>
  browser.panel.post(`${BASE}/${id}/transitions`, body, { 'If-Match': `"${String(version)}"` });
const reject = (browser: Browser, id: string, reasonCode = 'offer_rejected', version = 1) =>
  move(browser, id, { to: 'cancelled', reasonCode }, version);
const codeOf = (body: unknown) => (body as { code?: string }).code;
const errorsOf = (body: unknown) => (body as { errors?: unknown }).errors;
const expiresMs = async (id: string): Promise<number | undefined> => (await rowOf(id)).site_survey_expires_at?.getTime();

describe('the rejection of a site survey (EVM-136 AC5)', () => {
  for (const [role, code] of [
    ['editor', 'offer_rejected'],
    ['administrator', 'customer_withdrew'],
  ] as const) {
    it(`EVM-136 AC5 the ${role} rejects an open survey with ${code}: "Anulowane", the deadline is the smaller of (the current one, now + 14 days), the reason is the code, the audit trail is without content`, async () => {
      const browser = await harness.signIn(role);
      const id = await survey({ expiresInDays: 60 });
      const response = await reject(browser, id, code);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body).toMatchObject({ status: 'cancelled', version: 2 });
      const row = await rowOf(id);
      expect(row).toMatchObject({ status: 'cancelled', status_reason: code, resume_status: 'quoting', customer_id: null });
      expect(row.closed_at).not.toBeNull();
      expect(await expiresMs(id)).toBe(inDays(14).getTime());
      const audit = await sql<{ action: string; reason_code: string | null; actor_user_id: string | null }>`
        select action, reason_code, actor_user_id from audit.events where object_id = ${id} order by occurred_at, id`.execute(admin());
      expect(audit.rows).toEqual([{ action: 'work_order.cancelled', reason_code: null, actor_user_id: browser.userId }]);
      expect(JSON.stringify(audit.rows)).not.toContain(code);
    });
  }

  it('EVM-136 AC5 a deadline nearer than 14 days stays, and one that has passed already stays in the past (P4: the smaller of the two, literally)', async () => {
    const editor = await harness.signIn('editor');
    const near = await survey({ expiresInDays: 3 });
    const past = await survey({ expiresInDays: -2 });
    expect((await reject(editor, near)).status).toBe(200);
    expect((await reject(editor, past)).status).toBe(200);
    expect(await expiresMs(near)).toBe(inDays(3).getTime());
    expect(await expiresMs(past)).toBe(inDays(-2).getTime());
  });

  it('EVM-136 AC5 a survey on hold is rejected too; the free reason of the HOLD is unchanged (a text, 1-500 characters)', async () => {
    const editor = await harness.signIn('editor');
    const id = await survey();
    expect((await move(editor, id, { to: 'on_hold', reason: 'czekamy na decyzję' }, 1)).status).toBe(200);
    expect((await rowOf(id)).status_reason).toBe('czekamy na decyzję');
    expect((await reject(editor, id, 'customer_withdrew', 2)).status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ status: 'cancelled', status_reason: 'customer_withdrew' });
  });

  it('EVM-136 AC5 the rejection without a code is 400 /reasonCode required, the free text is 400 /reason not_allowed, an unknown code is 400 - no value is echoed and nothing changes', async () => {
    const editor = await harness.signIn('editor');
    const id = await survey();
    const missing = await move(editor, id, { to: 'cancelled' }, 1);
    expect([missing.status, errorsOf(missing.body)]).toEqual([400, [{ pointer: '/reasonCode', code: 'required' }]]);
    const text = await move(editor, id, { to: 'cancelled', reasonCode: 'offer_rejected', reason: 'Jan Przykładowy zrezygnował' }, 1);
    expect([text.status, errorsOf(text.body)]).toEqual([400, [{ pointer: '/reason', code: 'not_allowed' }]]);
    expect(JSON.stringify(text.body)).not.toContain('Przykładowy');
    const unknown = await move(editor, id, { to: 'cancelled', reasonCode: 'Oferta odrzucona' }, 1);
    expect(unknown.status).toBe(400);
    expect(JSON.stringify(unknown.body)).not.toContain('Oferta');
    expect(await rowOf(id)).toMatchObject({ status: 'quoting', version: 1, status_reason: null });
  });

  it('EVM-136 AC5 Tylko odczyt cannot reject (403) and an anonymous caller gets 401; the survey stays', async () => {
    const id = await survey();
    const viewer = await harness.signIn('read_only');
    expect((await reject(viewer, id)).status).toBe(403);
    const anonymous = new PanelClient(app().app.getHttpServer(), PANEL_ORIGIN);
    expect(
      (await anonymous.post(`${BASE}/${id}/transitions`, { to: 'cancelled', reasonCode: 'offer_rejected' }, { 'If-Match': '"1"' })).status,
    ).toBe(401);
    expect(await rowOf(id)).toMatchObject({ status: 'quoting', version: 1 });
  });

  it('EVM-136 AC5 an ordinary order is cancelled as before - the free reason, no deadline - and the code is refused there with 400 /reasonCode not_allowed', async () => {
    const editor = await harness.signIn('editor');
    const ordinary = await harness.order([], { status: 'new' });
    const refused = await move(editor, ordinary.id, { to: 'cancelled', reason: 'Zlecenie z błędu', reasonCode: 'offer_rejected' }, 1);
    expect([refused.status, errorsOf(refused.body)]).toEqual([400, [{ pointer: '/reasonCode', code: 'not_allowed' }]]);
    const withoutReason = await move(editor, ordinary.id, { to: 'cancelled', reasonCode: 'offer_rejected' }, 1);
    expect(errorsOf(withoutReason.body)).toEqual([
      { pointer: '/reason', code: 'required' },
      { pointer: '/reasonCode', code: 'not_allowed' },
    ]);
    const cancelled = await move(editor, ordinary.id, { to: 'cancelled', reason: 'Zlecenie z błędu' }, 1);
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(await rowOf(ordinary.id)).toMatchObject({
      status: 'cancelled',
      status_reason: 'Zlecenie z błędu',
      site_survey_expires_at: null,
    });
  });
});

describe('the restoration of a rejected site survey (EVM-136 AC5)', () => {
  const restore = (browser: Browser, id: string, version = 2) => move(browser, id, { to: 'on_hold' }, version);

  it('EVM-136 AC5 the Editor cannot restore (403 forbidden) and an Administrator without a fresh step-up cannot either (403 step_up_required); the survey stays rejected', async () => {
    const id = await survey({ status: 'cancelled', expiresInDays: 5 });
    const editor = await harness.signIn('editor');
    const forbidden = await restore(editor, id, 1);
    expect([forbidden.status, codeOf(forbidden.body)]).toEqual([403, 'forbidden']);
    const plain = await harness.signIn('administrator');
    const stepUp = await restore(plain, id, 1);
    expect([stepUp.status, codeOf(stepUp.body)]).toEqual([403, 'step_up_required']);
    expect(await rowOf(id)).toMatchObject({ status: 'cancelled', version: 1 });
    expect(await expiresMs(id)).toBe(inDays(5).getTime());
  });

  it('EVM-136 AC5 the Administrator with a step-up restores it to "Wstrzymane" and the deadline is the greater of (creation + 90 days x (1 + extensions), now + 14 days) - the three cases of the table', async () => {
    const administrator = await harness.administrator();
    const earned = await survey({ status: 'cancelled', createdDaysAgo: 20, expiresInDays: 5, extensions: 0 }); // creation + 90 d = now + 70 d
    const extended = await survey({ status: 'cancelled', createdDaysAgo: 200, expiresInDays: 5, extensions: 2 }); // creation + 270 d = now + 70 d
    const late = await survey({ status: 'cancelled', createdDaysAgo: 200, expiresInDays: -50, extensions: 0 }); // creation + 90 d has passed: now + 14 d
    for (const id of [earned, extended, late]) {
      const response = await restore(administrator, id, 1);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(await rowOf(id)).toMatchObject({ status: 'on_hold', closed_at: null });
    }
    expect(await expiresMs(earned)).toBe(inDays(70).getTime());
    expect(await expiresMs(extended)).toBe(inDays(70).getTime());
    expect(await expiresMs(late)).toBe(inDays(14).getTime());
    const audit = await sql<{
      action: string;
    }>`select action from audit.events where object_id = ${earned} order by occurred_at, id`.execute(admin());
    expect(audit.rows.map((row) => row.action)).toEqual(['work_order.restored']);
  });

  it('EVM-136 AC5 the whole cycle: rejected, restored, resumed to "Wycena", and the customer can be assigned - the survey is an open survey again, with the deadline it had earned', async () => {
    const editor = await harness.signIn('editor');
    const administrator = await harness.administrator();
    const id = await survey({ createdDaysAgo: 20, expiresInDays: 70 });
    expect((await reject(editor, id)).status).toBe(200);
    expect(await expiresMs(id)).toBe(inDays(14).getTime());
    expect((await restore(administrator, id)).status).toBe(200);
    expect(await expiresMs(id)).toBe(inDays(70).getTime());
    expect((await move(editor, id, { to: 'quoting' }, 3)).status).toBe(200);
    const customerId = await insertCustomer(admin());
    const assigned = await editor.panel.put(`${BASE}/${id}/customer`, { customerId, version: 4 });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    expect(await rowOf(id)).toMatchObject({ status: 'quoting', customer_id: customerId, site_survey_expires_at: null });
  });

  const reminders = async (id: string): Promise<number> =>
    Number(
      (
        await sql<{ n: string }>`
          select count(*)::text as n from platform.email_outbox where kind = 'site_survey_expiring' and subject_id = ${id}`.execute(admin())
      ).rows[0]?.n,
    );
  const remind = () => app().app.get(SiteSurveyReminderJob, { strict: false }).run();

  it('EVM-140 AC1 a survey reminded, rejected and restored with a later deadline gets exactly ONE new reminder as the new deadline comes near (the move of the deadline clears the mark)', async () => {
    const editor = await harness.signIn('editor');
    const administrator = await harness.administrator();
    const id = await survey({ createdDaysAgo: 20, expiresInDays: 10 });
    await remind();
    const first = await reminders(id);
    expect(first).toBeGreaterThan(0);

    // the rejection leaves the nearer deadline as it is: the mark stays, so the same date is not announced twice
    expect((await reject(editor, id)).status).toBe(200);
    expect(await expiresMs(id)).toBe(inDays(10).getTime());
    expect(await reminders(id)).toBe(first);
    expect((await restore(administrator, id)).status).toBe(200);
    expect(await expiresMs(id)).toBe(inDays(70).getTime());
    await remind();
    expect(await reminders(id)).toBe(first);

    app().clock.set(inDays(56));
    await remind();
    expect(await reminders(id)).toBe(first * 2);
    await remind();
    expect(await reminders(id)).toBe(first * 2);
  });

  it('EVM-140 AC1 a rejection that SHORTENS the deadline of a reminded survey clears the mark: the reminder of the nearer date can go out', async () => {
    const editor = await harness.signIn('editor');
    await harness.administrator();
    const id = await survey({ createdDaysAgo: 20, expiresInDays: 12 });
    await sql`update work_orders.work_orders set site_survey_expires_at = ${inDays(60)}, site_survey_reminded_at = ${inDays(-1)} where id = ${id}`.execute(
      admin(),
    );
    expect((await reject(editor, id)).status).toBe(200);
    expect(await expiresMs(id)).toBe(inDays(14).getTime());
    const marks = await sql<{ r: Date | null }>`select site_survey_reminded_at as r from work_orders.work_orders where id = ${id}`.execute(
      admin(),
    );
    expect(marks.rows[0]?.r).toBeNull();
  });

  it('EVM-136 AC5 an ordinary order is restored as before and gets no deadline', async () => {
    const administrator = await harness.administrator();
    const ordinary = await harness.order([], { status: 'cancelled' });
    const response = await restore(administrator, ordinary.id, 1);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(await rowOf(ordinary.id)).toMatchObject({ status: 'on_hold', site_survey_expires_at: null });
  });
});

describe('the rejection against the assignment of a customer (EVM-136 AC5) and what stays out of the trails (W5)', () => {
  it('EVM-136 AC5 a rejection and an assignment on the same version race: one wins, the other is refused consistently - never a rejected survey with a customer', async () => {
    const editor = await harness.signIn('editor');
    const administrator = await harness.signIn('administrator');
    const id = await survey();
    const customerId = await insertCustomer(admin());
    const [rejected, assigned] = await Promise.all([
      reject(editor, id),
      administrator.panel.put(`${BASE}/${id}/customer`, { customerId, version: 1 }),
    ]);
    const row = await rowOf(id);
    if (rejected.status === 200) {
      expect([assigned.status, codeOf(assigned.body)]).toEqual([409, 'invalid_state_transition']);
      expect(row).toMatchObject({ status: 'cancelled', customer_id: null });
      expect(await expiresMs(id)).toBe(inDays(14).getTime());
    } else {
      expect(assigned.status).toBe(200);
      expect([rejected.status, codeOf(rejected.body)]).toEqual([412, 'version_conflict']);
      expect(row).toMatchObject({ status: 'quoting', customer_id: customerId, site_survey_expires_at: null });
    }
    expect(row.version).toBe(2);
  });

  it('EVM-136 AC5 W5 neither the audit trail, the journal, the log, the change log nor the queue of e-mails holds the street, the city, the postal code, the phone of the requester or the code of the reason - after the rejection and the restoration', async () => {
    const editor = await harness.signIn('editor');
    const administrator = await harness.administrator();
    const id = await survey();
    expect((await reject(editor, id)).status).toBe(200);
    expect((await move(administrator, id, { to: 'on_hold' }, 2)).status).toBe(200);
    const text = async (query: ReturnType<typeof sql>) => JSON.stringify((await query.execute(admin())).rows);
    const haystacks = [
      await text(sql`select to_jsonb(t) as r from audit.events t`),
      await text(sql`select to_jsonb(t) as r from timeline.timeline_entries t where work_order_id = ${id}`),
      await text(sql`select to_jsonb(t) as r from sync.change_log t`),
      await text(sql`select to_jsonb(t) as r from platform.email_outbox t`),
      app().logs.text,
    ];
    for (const secret of [STREET, CITY, POSTAL, PHONE, '600937001', 'offer_rejected']) {
      for (const haystack of haystacks) expect(haystack, secret).not.toContain(secret);
    }
  });
});

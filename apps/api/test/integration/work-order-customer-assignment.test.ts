import { sql } from 'kysely';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { BASE, useDeletionApp, type Browser } from '../support/deletion-harness.ts';
import { insertMedia } from '../support/media-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { insertEntries } from '../support/timeline-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';
import type { WorkOrderStatus } from '../../src/modules/work-orders/domain/work-order-status.ts';

/**
 * The assignment of a customer to a site survey (EVM-136 AC1-AC3; ADR-0024 pt 3; W2, W3, W5). Everything is synthetic: the street, the city, the postal code and
 * the phone of the requester carry sentinels that must be in no audit record, no log line, no journal entry, no change log row and no queued e-mail.
 */
const harness = useDeletionApp();
const { app, admin } = harness;

const STREET = 'ul. Znacznik-wizji-synt';
const CITY = 'Znacznikowo-synt';
const POSTAL = '99-936';
const PHONE = '+48600936001';
const DEADLINE = new Date('2027-02-14T08:00:00.000Z');

const customerUrl = (id: string) => `${BASE}/${id}/customer`;
const codeOf = (body: unknown) => (body as { code?: string }).code;
let numbering = 0;

interface Survey {
  readonly id: string;
  readonly number: string;
  readonly siteId: string;
}

/** An open survey: no customer, the deadline set, one extension, a reminder and a requester phone (all of which the assignment clears). */
async function survey(status: WorkOrderStatus = 'quoting', deletedAt?: Date): Promise<Survey> {
  numbering += 1;
  const number = `ZL-7${String(numbering).padStart(3, '0')}-0136`;
  const siteId = await insertSite(admin(), { street: STREET, city: CITY, postalCode: POSTAL });
  const ids = await insertWorkOrders(admin(), [
    {
      number,
      siteSurveyExpiresAt: DEADLINE,
      siteId,
      status,
      ...(deletedAt === undefined ? {} : { deletedAt }),
      ...(status === 'cancelled' ? { closedAt: new Date('2026-10-02T08:00:00Z') } : {}),
    },
  ]);
  const id = [...ids.values()][0] ?? '';
  await sql`
    update work_orders.work_orders
    set requester_phone = ${PHONE}, site_survey_extensions = 1, site_survey_reminded_at = ${new Date('2027-01-30T08:00:00.000Z')}
    where id = ${id}`.execute(admin());
  return { id, number, siteId };
}

const assign = (browser: Browser, id: string, customerId: string, version: number, headers: Record<string, string> = {}) =>
  browser.panel.put(customerUrl(id), { customerId, version }, headers);

interface OrderRow {
  customer_id: string | null;
  site_survey_expires_at: Date | null;
  site_survey_extensions: number;
  site_survey_reminded_at: Date | null;
  requester_phone: string | null;
  version: number;
  status: string;
  number: string;
  site_id: string | null;
  title: string;
  created_at: Date;
  created_by: string | null;
}
const rowOf = async (id: string): Promise<OrderRow> =>
  (
    await sql<OrderRow>`
      select customer_id, site_survey_expires_at, site_survey_extensions, site_survey_reminded_at, requester_phone, version, status, number, site_id, title,
             created_at, created_by
      from work_orders.work_orders where id = ${id}`.execute(admin())
  ).rows[0] as OrderRow;

const auditActions = async (
  id: string,
): Promise<Array<{ action: string; actor_user_id: string | null; reason_code: string | null; object_type: string }>> =>
  (
    await sql<{ action: string; actor_user_id: string | null; reason_code: string | null; object_type: string }>`
      select action, actor_user_id, reason_code, object_type from audit.events
      where object_id = ${id} and action = 'work_order.customer_assigned' order by occurred_at, id`.execute(admin())
  ).rows;
const journalOf = async (id: string) =>
  (
    await sql<{ event_code: string; event_payload: Record<string, unknown> }>`
      select event_code, event_payload from timeline.timeline_entries
      where work_order_id = ${id} and kind = 'event' and event_code = 'work_order_customer_assigned'`.execute(admin())
  ).rows;
const entryIds = async (id: string): Promise<string[]> =>
  (
    await sql<{ id: string }>`select id from timeline.timeline_entries where work_order_id = ${id} and kind = 'note' order by id`.execute(
      admin(),
    )
  ).rows.map((row) => row.id);
const mediaIds = async (id: string): Promise<string[]> =>
  (await sql<{ id: string }>`select id from media.media_assets where work_order_id = ${id} order by id`.execute(admin())).rows.map(
    (row) => row.id,
  );

describe('the assignment of a customer to a site survey (EVM-136 AC1; ADR-0024 pt 3)', () => {
  for (const role of ['editor', 'administrator'] as const) {
    it(`EVM-136 AC1 an ${role} assigns a customer to an open survey: 200, ONE update sets the customer and clears the deadline, the counter, the reminder and the phone; number, site, status, media and entries stay; audit and journal hold identifiers only`, async () => {
      const browser = await harness.signIn(role);
      const target = await survey();
      const customerId = await insertCustomer(admin(), { email: 'klient-wl@example.invalid' });
      await insertEntries(admin(), target.id, browser.userId, [{ body: 'Wpis przed przypisaniem' }]);
      await insertMedia(admin(), { workOrderId: target.id, createdBy: browser.userId });
      const before = await rowOf(target.id);
      const entries = await entryIds(target.id);
      const media = await mediaIds(target.id);
      expect(before).toMatchObject({ customer_id: null, requester_phone: PHONE, site_survey_extensions: 1, version: 1 });

      const response = await assign(browser, target.id, customerId, before.version);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.headers['etag']).toBe('"2"');
      expect(response.body).toMatchObject({ id: target.id, number: target.number, status: 'quoting', version: 2, siteSurvey: null });
      expect((response.body as { customer: unknown }).customer).not.toBeNull();
      expect(JSON.stringify(response.body)).not.toContain(PHONE);

      const after = await rowOf(target.id);
      expect(after).toMatchObject({
        customer_id: customerId,
        site_survey_expires_at: null,
        site_survey_extensions: 0,
        site_survey_reminded_at: null,
        requester_phone: null,
        version: 2,
        status: 'quoting',
        number: target.number,
        site_id: target.siteId,
        title: before.title,
        created_by: before.created_by,
      });
      expect(after.created_at).toEqual(before.created_at);
      expect(await entryIds(target.id)).toEqual(entries);
      expect(await mediaIds(target.id)).toEqual(media);

      expect(await auditActions(target.id)).toEqual([
        { action: 'work_order.customer_assigned', actor_user_id: browser.userId, reason_code: null, object_type: 'work_order' },
      ]);
      expect(await journalOf(target.id)).toEqual([
        { event_code: 'work_order_customer_assigned', event_payload: { objectType: 'work_order', objectId: target.id, customerId } },
      ]);
    });
  }

  it('EVM-136 AC1 the survey becomes an ordinary order: the card of the customer answers, the projection holds the customer and no deadline, the PATCH of customerId is still read_only_field', async () => {
    const editor = await harness.signIn('editor');
    const target = await survey();
    const customerId = await insertCustomer(admin());
    expect((await assign(editor, target.id, customerId, 1)).status).toBe(200);

    expect((await editor.panel.get(customerUrl(target.id))).status).toBe(200);
    const summary = (
      await sql<{ customer_id: string | null; site_survey_expires_at: Date | null }>`
        select customer_id, site_survey_expires_at from overview.work_order_summaries where work_order_id = ${target.id}`.execute(admin())
    ).rows[0];
    expect(summary).toEqual({ customer_id: customerId, site_survey_expires_at: null });

    const other = await insertCustomer(admin());
    const patched = await editor.panel.patch(`${BASE}/${target.id}`, { customerId: other }, { 'If-Match': '"2"' });
    expect(patched.status).toBe(400);
    expect((patched.body as { errors: unknown }).errors).toEqual([{ pointer: '/customerId', code: 'read_only_field' }]);
    expect((await rowOf(target.id)).customer_id).toBe(customerId);
  });

  it('EVM-136 AC1 a survey on hold gets its customer too and stays on hold', async () => {
    const editor = await harness.signIn('editor');
    const target = await survey('on_hold');
    const customerId = await insertCustomer(admin());
    const response = await assign(editor, target.id, customerId, 1);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(await rowOf(target.id)).toMatchObject({ customer_id: customerId, status: 'on_hold', site_survey_expires_at: null });
  });
});

describe('repeats, conflicts and parallel assignments (EVM-136 AC2)', () => {
  it('EVM-136 AC2 the same customer again is 200 without a change - also with the stale version of before the first call - and writes no second audit record or journal entry', async () => {
    const editor = await harness.signIn('editor');
    const target = await survey();
    const customerId = await insertCustomer(admin());
    expect((await assign(editor, target.id, customerId, 1)).status).toBe(200);
    const again = await assign(editor, target.id, customerId, 1);
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.headers['etag']).toBe('"2"');
    expect((await rowOf(target.id)).version).toBe(2);
    expect(await auditActions(target.id)).toHaveLength(1);
    expect(await journalOf(target.id)).toHaveLength(1);
  });

  it('EVM-136 AC2 the same Idempotency-Key and body replays the answer (Idempotent-Replayed), and the same key on another survey is 422 idempotency_mismatch', async () => {
    const editor = await harness.signIn('editor');
    const target = await survey();
    const second = await survey();
    const customerId = await insertCustomer(admin());
    const key = uuidv7();
    const first = await assign(editor, target.id, customerId, 1, { 'Idempotency-Key': key });
    expect(first.status).toBe(200);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    const replay = await assign(editor, target.id, customerId, 1, { 'Idempotency-Key': key });
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    const mismatch = await assign(editor, second.id, customerId, 1, { 'Idempotency-Key': key });
    expect(mismatch.status).toBe(422);
    expect(codeOf(mismatch.body)).toBe('idempotency_mismatch');
    expect((await rowOf(second.id)).customer_id).toBeNull();
    expect(await auditActions(target.id)).toHaveLength(1);
  });

  it('EVM-136 AC2 another customer is 409 customer_already_set and nothing changes; so is an ordinary order with a different customer (no survey)', async () => {
    const editor = await harness.signIn('editor');
    const target = await survey();
    const first = await insertCustomer(admin());
    const other = await insertCustomer(admin());
    expect((await assign(editor, target.id, first, 1)).status).toBe(200);
    const refused = await assign(editor, target.id, other, 2);
    expect(refused.status).toBe(409);
    expect(codeOf(refused.body)).toBe('customer_already_set');
    expect(await rowOf(target.id)).toMatchObject({ customer_id: first, version: 2 });

    const ordinary = await harness.order([]);
    const ordinaryRefused = await assign(editor, ordinary.id, other, 1);
    expect(ordinaryRefused.status).toBe(409);
    expect(codeOf(ordinaryRefused.body)).toBe('customer_already_set');
    expect((await rowOf(ordinary.id)).customer_id).toBe(ordinary.customerId);
    // the same customer of an ordinary order is the idempotent 200 (the customer is set already)
    expect((await assign(editor, ordinary.id, ordinary.customerId, 1)).status).toBe(200);
    expect(await auditActions(ordinary.id)).toEqual([]);
  });

  it('EVM-136 AC2 a cancelled survey is 409 invalid_state_transition: the Editor cannot use the assignment to leave "Anulowane" - the Administrator restores first', async () => {
    const editor = await harness.signIn('editor');
    const target = await survey('cancelled');
    const customerId = await insertCustomer(admin());
    const refused = await assign(editor, target.id, customerId, 1);
    expect(refused.status).toBe(409);
    expect(codeOf(refused.body)).toBe('invalid_state_transition');
    expect(await rowOf(target.id)).toMatchObject({ customer_id: null, status: 'cancelled', version: 1 });
    expect(await auditActions(target.id)).toEqual([]);
  });

  it('EVM-136 AC2 a stale version is 412 version_conflict (the one code of the API for it) and nothing changes', async () => {
    const editor = await harness.signIn('editor');
    const target = await survey();
    const customerId = await insertCustomer(admin());
    const stale = await assign(editor, target.id, customerId, 7);
    expect(stale.status).toBe(412);
    expect(codeOf(stale.body)).toBe('version_conflict');
    expect(await rowOf(target.id)).toMatchObject({ customer_id: null, version: 1, requester_phone: PHONE });
    expect(await auditActions(target.id)).toEqual([]);
    expect(await journalOf(target.id)).toEqual([]);
  });

  it('EVM-136 AC2 two parallel assignments of DIFFERENT customers: exactly one 200 and one 409 customer_already_set, one winner, one audit record', async () => {
    const editor = await harness.signIn('editor');
    const administrator = await harness.signIn('administrator');
    const target = await survey();
    const [a, b] = [await insertCustomer(admin()), await insertCustomer(admin())];
    const answers = await Promise.all([assign(editor, target.id, a, 1), assign(administrator, target.id, b, 1)]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    const loser = answers.find((answer) => answer.status === 409);
    expect(codeOf(loser?.body)).toBe('customer_already_set');
    const winner = answers[0].status === 200 ? a : b;
    expect(await rowOf(target.id)).toMatchObject({ customer_id: winner, version: 2 });
    expect(await auditActions(target.id)).toHaveLength(1);
    expect(await journalOf(target.id)).toHaveLength(1);
  });

  it('EVM-136 AC2 two parallel assignments of the SAME customer: both 200, one write', async () => {
    const editor = await harness.signIn('editor');
    const administrator = await harness.signIn('administrator');
    const target = await survey();
    const customerId = await insertCustomer(admin());
    const answers = await Promise.all([assign(editor, target.id, customerId, 1), assign(administrator, target.id, customerId, 1)]);
    expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
    expect(await rowOf(target.id)).toMatchObject({ customer_id: customerId, version: 2 });
    expect(await auditActions(target.id)).toHaveLength(1);
  });

  it('EVM-136 AC2 the body is strict: a missing field, a bad id, a version below 1, a field of the server and an unknown field are 400 with a pointer and no value; nothing changes', async () => {
    const editor = await harness.signIn('editor');
    const target = await survey();
    const customerId = await insertCustomer(admin());
    const bodies: Array<[unknown, string]> = [
      [{ version: 1 }, '/customerId'],
      [{ customerId: 'not-a-uuid', version: 1 }, '/customerId'],
      [{ customerId, version: 0 }, '/version'],
      [{ customerId }, '/version'],
      [{ customerId, version: 1, status: 'accepted' }, '/status'],
      [{ customerId, version: 1, surprise: 1 }, '/surprise'],
    ];
    for (const [body, pointer] of bodies) {
      const response = await editor.panel.put(customerUrl(target.id), body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(JSON.stringify(response.body)).not.toContain('not-a-uuid');
      expect((response.body as { errors: Array<{ pointer: string }> }).errors.map((error) => error.pointer)).toContain(pointer);
    }
    expect(await rowOf(target.id)).toMatchObject({ customer_id: null, version: 1 });
  });
});

describe('authorisation of both objects (EVM-136 AC3; W2, W3)', () => {
  it('EVM-136 AC3 Tylko odczyt is 403, an anonymous caller 401, a session of the mobile channel is refused - and none of them changes the survey', async () => {
    const target = await survey();
    const customerId = await insertCustomer(admin());
    const viewer = await harness.signIn('read_only');
    const denied = await assign(viewer, target.id, customerId, 1);
    expect(denied.status).toBe(403);
    expect(codeOf(denied.body)).toBe('forbidden');

    const anonymous = new PanelClient(app().app.getHttpServer(), PANEL_ORIGIN);
    const unauthenticated = await anonymous.put(customerUrl(target.id), { customerId, version: 1 });
    expect(unauthenticated.status).toBe(401);
    expect(codeOf(unauthenticated.body)).toBe('unauthenticated');

    for (const role of ['editor', 'administrator'] as const) {
      const phone = await harness.signIn(role, { channel: 'mobile' });
      const refused = await assign(phone, target.id, customerId, 1);
      expect([refused.status, codeOf(refused.body)], role).toEqual([403, 'forbidden']);
    }
    // a Bearer token of the phone is not read by an operation of the web: no credential at all
    const bearer = await request(app().app.getHttpServer())
      .put(customerUrl(target.id))
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ customerId, version: 1 });
    expect(bearer.status).toBe(401);
    expect(await rowOf(target.id)).toMatchObject({ customer_id: null, version: 1 });
    expect(await auditActions(target.id)).toEqual([]);
  });

  it('EVM-136 AC3 a missing order and a soft-deleted order are ONE 404 for Administrator and Editor: the same status and the same body but the trace; nothing is written', async () => {
    const deleted = await survey('quoting', new Date('2026-10-02T08:00:00Z'));
    const customerId = await insertCustomer(admin());
    for (const role of ['editor', 'administrator'] as const) {
      const browser = await harness.signIn(role);
      const missing = await assign(browser, uuidv7(), customerId, 1);
      const gone = await assign(browser, deleted.id, customerId, 1);
      expect([missing.status, gone.status], role).toEqual([404, 404]);
      const shape = (body: unknown) => ({ ...(body as object), traceId: undefined, instance: undefined });
      expect(shape(gone.body), role).toEqual(shape(missing.body));
      expect(codeOf(gone.body)).toBe('not_found');
    }
    expect((await rowOf(deleted.id)).customer_id).toBeNull();
    // the order comes before the body: a malformed request to an order that is not there tells nothing
    const editor = await harness.signIn('editor');
    expect((await editor.panel.put(customerUrl(deleted.id), { nonsense: true })).status).toBe(404);
  });

  it('EVM-136 AC3 a customer that is missing, soft deleted, anonymized or invisible is 422 customer_unavailable - one answer - and the survey keeps everything', async () => {
    const editor = await harness.signIn('editor');
    const target = await survey();
    const deleted = await insertCustomer(admin(), { deletedAt: '2026-10-08T08:00:00Z' });
    const anonymized = await insertCustomer(admin(), { firstName: 'Klient', lastName: 'zanonimizowany', phone: '+48000000000' });
    await sql`update customers.customers set anonymized_at = ${new Date('2026-10-09T08:00:00Z')}, anonymized_by = ${editor.userId} where id = ${anonymized}`.execute(
      admin(),
    );
    const answers = [];
    for (const customerId of [uuidv7(), deleted, anonymized]) {
      const response = await assign(editor, target.id, customerId, 1);
      answers.push(response);
      expect([response.status, codeOf(response.body)]).toEqual([422, 'customer_unavailable']);
    }
    const shape = (body: unknown) => ({ ...(body as object), traceId: undefined, instance: undefined });
    expect(shape(answers[1]?.body)).toEqual(shape(answers[0]?.body));
    expect(shape(answers[2]?.body)).toEqual(shape(answers[0]?.body));
    expect(await rowOf(target.id)).toMatchObject({
      customer_id: null,
      version: 1,
      requester_phone: PHONE,
      site_survey_extensions: 1,
    });
    expect(await auditActions(target.id)).toEqual([]);
    expect(await journalOf(target.id)).toEqual([]);
  });

  it('EVM-136 AC3 the customer is locked FOR KEY SHARE after the order: a deletion of the customer that holds its lock makes the assignment wait, and one that commits first makes it 422', async () => {
    const editor = await harness.signIn('editor');
    const target = await survey();
    const customerId = await insertCustomer(admin());
    let pending: Promise<{ status: number; body: unknown }> | undefined;
    await admin()
      .transaction()
      .execute(async (trx) => {
        await sql`select id from customers.customers where id = ${customerId} for update`.execute(trx);
        pending = Promise.resolve(assign(editor, target.id, customerId, 1)).then((response): { status: number; body: unknown } => ({
          status: response.status,
          body: response.body as unknown,
        }));
        const deadline = Date.now() + 10_000;
        let waiting = 0;
        while (waiting === 0 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          waiting = Number(
            (
              await sql<{ n: string }>`
                select count(*) as n from pg_locks l join pg_stat_activity a on a.pid = l.pid
                where not l.granted and a.datname = current_database() and a.pid <> pg_backend_pid()`.execute(trx)
            ).rows[0]?.n ?? 0,
          );
        }
        expect(waiting, 'the assignment waits for the lock of the customer').toBeGreaterThan(0);
        await sql`update customers.customers set deleted_at = ${new Date('2026-10-10T08:00:00Z')} where id = ${customerId}`.execute(trx);
      });
    const answer = await pending;
    expect([answer?.status, codeOf(answer?.body)]).toEqual([422, 'customer_unavailable']);
    expect(await rowOf(target.id)).toMatchObject({ customer_id: null, version: 1 });
  });

  it('EVM-136 AC3 the database is the second line: an order with a customer and a deadline, and an accepted order without a customer, are refused by the CHECKs (23514)', async () => {
    const target = await survey();
    const customerId = await insertCustomer(admin());
    await expect(
      sql`update work_orders.work_orders set customer_id = ${customerId} where id = ${target.id}`.execute(admin()),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      sql`update work_orders.work_orders set status = 'accepted' where id = ${target.id}`.execute(admin()),
    ).rejects.toMatchObject({
      code: '23514',
    });
    expect(await rowOf(target.id)).toMatchObject({ customer_id: null, status: 'quoting', version: 1 });
  });
});

describe('what stays out of the trails (EVM-136 AC3; W5; DO-K)', () => {
  it('EVM-136 AC3 W5 neither the audit trail, the log, the journal, the change log, the queue of e-mails nor the problems hold the street, the city, the postal code or the phone of the requester - after the assignment and after the refusals', async () => {
    const editor = await harness.signIn('editor');
    const target = await survey();
    const customerId = await insertCustomer(admin());
    const other = await insertCustomer(admin());
    const bodies = [
      (await assign(editor, target.id, customerId, 5)).body,
      (await assign(editor, target.id, uuidv7(), 1)).body,
      (await assign(editor, target.id, customerId, 1)).body,
      (await assign(editor, target.id, other, 2)).body,
    ];
    const text = async (query: ReturnType<typeof sql>) => JSON.stringify((await query.execute(admin())).rows);
    const haystacks = [
      await text(sql`select to_jsonb(t) as r from audit.events t`),
      await text(sql`select to_jsonb(t) as r from timeline.timeline_entries t where work_order_id = ${target.id}`),
      await text(sql`select to_jsonb(t) as r from sync.change_log t`),
      await text(sql`select to_jsonb(t) as r from platform.email_outbox t`),
      app().logs.text,
      JSON.stringify(bodies.slice(0, 2)),
      JSON.stringify(bodies.slice(3)),
    ];
    for (const secret of [STREET, CITY, POSTAL, PHONE, '600936001']) {
      for (const haystack of haystacks) expect(haystack).not.toContain(secret);
    }
    expect(await rowOf(target.id)).toMatchObject({ customer_id: customerId });
  });
});

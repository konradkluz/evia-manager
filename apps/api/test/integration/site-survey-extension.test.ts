import { sql } from 'kysely';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { BASE, useDeletionApp, type Browser } from '../support/deletion-harness.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';
import type { WorkOrderStatus } from '../../src/modules/work-orders/domain/work-order-status.ts';

/**
 * The extension of a site survey (EVM-140 AC2, AC3, AC5; ADR-0024 pt 9; W1, W5). Everything is synthetic: the street, the city, the postal code and the phone of
 * the requester carry sentinels that must be in no audit record, no log line, no journal entry, no change log row and no queued e-mail.
 */
const harness = useDeletionApp();
const { app, admin } = harness;

const STREET = 'ul. Znacznik-przedluzenia-synt';
const CITY = 'Przedluzenowo-synt';
const POSTAL = '99-140';
const PHONE = '+48600140001';
const DEADLINE = new Date('2027-02-14T08:00:00.000Z');
const EXTENDED = new Date('2027-05-15T08:00:00.000Z');
const REMINDED = new Date('2027-01-30T08:00:00.000Z');

const extensionsUrl = (id: string) => `${BASE}/${id}/site-survey/extensions`;
const codeOf = (body: unknown) => (body as { code?: string }).code;
let numbering = 0;

interface Survey {
  readonly id: string;
  readonly number: string;
}

/** An open survey: no customer, the deadline set, a reminder sent and a requester phone. */
async function survey(extensions = 0, status: WorkOrderStatus = 'quoting', deletedAt?: Date): Promise<Survey> {
  numbering += 1;
  const number = `ZL-8${String(numbering).padStart(3, '0')}-0140`;
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
    set requester_phone = ${PHONE}, site_survey_extensions = ${extensions}, site_survey_reminded_at = ${REMINDED}
    where id = ${id}`.execute(admin());
  return { id, number };
}

const extend = (browser: Browser, id: string, reason: string, version: number, headers: Record<string, string> = {}) =>
  browser.panel.post(extensionsUrl(id), { reason, version }, headers);

interface OrderRow {
  site_survey_expires_at: Date | null;
  site_survey_extensions: number;
  site_survey_reminded_at: Date | null;
  requester_phone: string | null;
  version: number;
  status: string;
  customer_id: string | null;
}
const rowOf = async (id: string): Promise<OrderRow> =>
  (
    await sql<OrderRow>`
      select site_survey_expires_at, site_survey_extensions, site_survey_reminded_at, requester_phone, version, status, customer_id
      from work_orders.work_orders where id = ${id}`.execute(admin())
  ).rows[0] as OrderRow;
const auditOf = async (id: string) =>
  (
    await sql<{ action: string; actor_user_id: string | null; reason_code: string | null; object_type: string }>`
      select action, actor_user_id, reason_code, object_type from audit.events
      where object_id = ${id} and action = 'work_order.site_survey_extended' order by occurred_at, id`.execute(admin())
  ).rows;
const journalOf = async (id: string) =>
  (
    await sql<{ event_code: string; event_payload: Record<string, unknown> }>`
      select event_code, event_payload from timeline.timeline_entries
      where work_order_id = ${id} and kind = 'event' and event_code = 'work_order_site_survey_extended'`.execute(admin())
  ).rows;

describe('the extension of a site survey (EVM-140 AC2)', () => {
  for (const role of ['editor', 'administrator'] as const) {
    for (const reason of ['awaiting_client_decision', 'awaiting_community_decision', 'second_visit_needed']) {
      it(`EVM-140 AC2 an ${role} extends an open survey (${reason}): 200, +90 days, the counter 1, the reminder cleared, version 2; audit with the code, a journal entry`, async () => {
        const browser = await harness.signIn(role);
        const target = await survey();
        const response = await extend(browser, target.id, reason, 1);
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(response.headers['etag']).toBe('"2"');
        expect(response.body).toMatchObject({
          id: target.id,
          version: 2,
          siteSurvey: { expiresAt: EXTENDED.toISOString(), extensionCount: 1 },
        });
        expect(await rowOf(target.id)).toMatchObject({
          site_survey_expires_at: EXTENDED,
          site_survey_extensions: 1,
          site_survey_reminded_at: null,
          requester_phone: PHONE,
          version: 2,
          status: 'quoting',
          customer_id: null,
        });
        expect(await auditOf(target.id)).toEqual([
          { action: 'work_order.site_survey_extended', actor_user_id: browser.userId, reason_code: reason, object_type: 'work_order' },
        ]);
        expect(await journalOf(target.id)).toEqual([
          { event_code: 'work_order_site_survey_extended', event_payload: { objectType: 'work_order', objectId: target.id } },
        ]);
      });
    }
  }

  it('EVM-140 AC2 the second extension counts from the new deadline (270 days in all); a survey on hold may be extended too', async () => {
    const editor = await harness.signIn('editor');
    const target = await survey(1, 'on_hold');
    const response = await extend(editor, target.id, 'second_visit_needed', 1);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(await rowOf(target.id)).toMatchObject({
      site_survey_expires_at: EXTENDED,
      site_survey_extensions: 2,
      status: 'on_hold',
    });
  });

  it('EVM-140 AC2 an unknown reason is 400 with a pointer and no value; the other bodies of the contract are refused; nothing changes', async () => {
    const editor = await harness.signIn('editor');
    const target = await survey();
    const bodies: Array<[unknown, string]> = [
      [{ reason: 'because I say so', version: 1 }, '/reason'],
      [{ reason: '', version: 1 }, '/reason'],
      [{ version: 1 }, '/reason'],
      [{ reason: 'second_visit_needed' }, '/version'],
      [{ reason: 'second_visit_needed', version: 0 }, '/version'],
      [{ reason: 'second_visit_needed', version: 1, status: 'cancelled' }, '/status'],
      [{ reason: 'second_visit_needed', version: 1, surprise: 1 }, '/surprise'],
    ];
    for (const [body, pointer] of bodies) {
      const response = await editor.panel.post(extensionsUrl(target.id), body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(JSON.stringify(response.body)).not.toContain('because I say so');
      expect((response.body as { errors: Array<{ pointer: string }> }).errors.map((error) => error.pointer)).toContain(pointer);
    }
    expect(await rowOf(target.id)).toMatchObject({ site_survey_extensions: 0, version: 1, site_survey_expires_at: DEADLINE });
    expect(await auditOf(target.id)).toEqual([]);
  });

  it('EVM-140 AC2 the same Idempotency-Key and body replays the answer (Idempotent-Replayed) with ONE extension; the same key on another survey is 422 idempotency_mismatch', async () => {
    const editor = await harness.signIn('editor');
    const target = await survey();
    const second = await survey();
    const key = uuidv7();
    const first = await extend(editor, target.id, 'awaiting_client_decision', 1, { 'Idempotency-Key': key });
    expect(first.status).toBe(200);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    const replay = await extend(editor, target.id, 'awaiting_client_decision', 1, { 'Idempotency-Key': key });
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(await rowOf(target.id)).toMatchObject({ site_survey_extensions: 1, version: 2 });
    const mismatch = await extend(editor, second.id, 'awaiting_client_decision', 1, { 'Idempotency-Key': key });
    expect([mismatch.status, codeOf(mismatch.body)]).toEqual([422, 'idempotency_mismatch']);
    expect((await rowOf(second.id)).site_survey_extensions).toBe(0);
    expect(await auditOf(target.id)).toHaveLength(1);
  });

  it('EVM-140 AC2 a stale version is 412 version_conflict and nothing changes; two parallel extensions on the same version give one 200 and one 412', async () => {
    const editor = await harness.signIn('editor');
    const administrator = await harness.signIn('administrator');
    const stale = await survey();
    const refused = await extend(editor, stale.id, 'second_visit_needed', 7);
    expect([refused.status, codeOf(refused.body)]).toEqual([412, 'version_conflict']);
    expect(await rowOf(stale.id)).toMatchObject({ site_survey_extensions: 0, version: 1, site_survey_reminded_at: REMINDED });
    expect(await auditOf(stale.id)).toEqual([]);
    expect(await journalOf(stale.id)).toEqual([]);

    const target = await survey();
    const answers = await Promise.all([
      extend(editor, target.id, 'second_visit_needed', 1),
      extend(administrator, target.id, 'awaiting_client_decision', 1),
    ]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 412]);
    expect(await rowOf(target.id)).toMatchObject({ site_survey_extensions: 1, version: 2 });
    expect(await auditOf(target.id)).toHaveLength(1);
  });
});

describe('the limit of two extensions and the conditions (EVM-140 AC3)', () => {
  it('EVM-140 AC3 the third extension is 409 extension_limit_reached (270 days at most) and nothing changes', async () => {
    const editor = await harness.signIn('editor');
    const target = await survey(2);
    const refused = await extend(editor, target.id, 'second_visit_needed', 1);
    expect([refused.status, codeOf(refused.body)]).toEqual([409, 'extension_limit_reached']);
    expect(await rowOf(target.id)).toMatchObject({ site_survey_extensions: 2, version: 1, site_survey_expires_at: DEADLINE });
    expect(await auditOf(target.id)).toEqual([]);
  });

  it('EVM-140 AC3 two extensions one after the other, the third is refused', async () => {
    const editor = await harness.signIn('editor');
    const target = await survey();
    expect((await extend(editor, target.id, 'awaiting_client_decision', 1)).status).toBe(200);
    expect((await extend(editor, target.id, 'awaiting_community_decision', 2)).status).toBe(200);
    const third = await extend(editor, target.id, 'second_visit_needed', 3);
    expect([third.status, codeOf(third.body)]).toEqual([409, 'extension_limit_reached']);
    expect(await rowOf(target.id)).toMatchObject({
      site_survey_extensions: 2,
      site_survey_expires_at: new Date('2027-08-13T08:00:00.000Z'),
      version: 3,
    });
  });

  it('EVM-140 AC3 a cancelled survey and an ordinary order are 409 invalid_state_transition - the restoration of the Administrator comes first', async () => {
    const editor = await harness.signIn('editor');
    const cancelled = await survey(0, 'cancelled');
    const refused = await extend(editor, cancelled.id, 'second_visit_needed', 1);
    expect([refused.status, codeOf(refused.body)]).toEqual([409, 'invalid_state_transition']);
    expect(await rowOf(cancelled.id)).toMatchObject({ status: 'cancelled', site_survey_extensions: 0, version: 1 });

    const ordinary = await harness.order([]);
    const ordinaryRefused = await extend(editor, ordinary.id, 'second_visit_needed', 1);
    expect([ordinaryRefused.status, codeOf(ordinaryRefused.body)]).toEqual([409, 'invalid_state_transition']);
    expect(await auditOf(cancelled.id)).toEqual([]);
    expect(await auditOf(ordinary.id)).toEqual([]);
  });

  it('EVM-140 AC3 Tylko odczyt is 403, an anonymous caller 401, a session or a token of the phone is refused - and none of them changes the survey', async () => {
    const target = await survey();
    const viewer = await harness.signIn('read_only');
    const denied = await extend(viewer, target.id, 'second_visit_needed', 1);
    expect([denied.status, codeOf(denied.body)]).toEqual([403, 'forbidden']);

    const anonymous = new PanelClient(app().app.getHttpServer(), PANEL_ORIGIN);
    const unauthenticated = await anonymous.post(extensionsUrl(target.id), { reason: 'second_visit_needed', version: 1 });
    expect([unauthenticated.status, codeOf(unauthenticated.body)]).toEqual([401, 'unauthenticated']);

    for (const role of ['editor', 'administrator'] as const) {
      const phone = await harness.signIn(role, { channel: 'mobile' });
      const refused = await extend(phone, target.id, 'second_visit_needed', 1);
      expect([refused.status, codeOf(refused.body)], role).toEqual([403, 'forbidden']);
    }
    const bearer = await request(app().app.getHttpServer())
      .post(extensionsUrl(target.id))
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ reason: 'second_visit_needed', version: 1 });
    expect(bearer.status).toBe(401);
    expect(await rowOf(target.id)).toMatchObject({ site_survey_extensions: 0, version: 1 });
    expect(await auditOf(target.id)).toEqual([]);
  });

  it('EVM-140 AC3 a missing order and a soft-deleted order are ONE 404 for Administrator and Editor (before the body); nothing is written', async () => {
    const deleted = await survey(0, 'quoting', new Date('2026-10-02T08:00:00Z'));
    for (const role of ['editor', 'administrator'] as const) {
      const browser = await harness.signIn(role);
      const missing = await extend(browser, uuidv7(), 'second_visit_needed', 1);
      const gone = await extend(browser, deleted.id, 'second_visit_needed', 1);
      expect([missing.status, gone.status], role).toEqual([404, 404]);
      const shape = (body: unknown) => ({ ...(body as object), traceId: undefined, instance: undefined });
      expect(shape(gone.body), role).toEqual(shape(missing.body));
      expect(codeOf(gone.body)).toBe('not_found');
    }
    const editor = await harness.signIn('editor');
    expect((await editor.panel.post(extensionsUrl(deleted.id), { nonsense: true })).status).toBe(404);
    expect(await rowOf(deleted.id)).toMatchObject({ site_survey_extensions: 0, version: 1 });
  });

  it('EVM-140 AC3 the database is the second line: a third extension is refused by the CHECK (23514)', async () => {
    const target = await survey(2);
    await expect(
      sql`update work_orders.work_orders set site_survey_extensions = 3 where id = ${target.id}`.execute(admin()),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('what stays out of the trails (EVM-140 AC5; W5; DO-K)', () => {
  it('EVM-140 AC5 neither the audit trail, the log, the journal, the change log, the queue of e-mails nor the problems hold the street, the city, the postal code or the phone of the requester', async () => {
    const editor = await harness.signIn('editor');
    const target = await survey();
    const bodies = [
      (await extend(editor, target.id, 'second_visit_needed', 5)).body,
      (await extend(editor, target.id, 'nonsense', 1)).body,
      (await extend(editor, target.id, 'second_visit_needed', 1)).body,
    ];
    const text = async (query: ReturnType<typeof sql>) => JSON.stringify((await query.execute(admin())).rows);
    const haystacks = [
      await text(sql`select to_jsonb(t) as r from audit.events t`),
      await text(sql`select to_jsonb(t) as r from timeline.timeline_entries t where work_order_id = ${target.id}`),
      await text(sql`select to_jsonb(t) as r from sync.change_log t`),
      await text(sql`select to_jsonb(t) as r from platform.email_outbox t`),
      app().logs.text,
      JSON.stringify([bodies[0], bodies[1]]),
    ];
    for (const secret of [STREET, CITY, POSTAL, PHONE, '600140001']) {
      for (const haystack of haystacks) expect(haystack).not.toContain(secret);
    }
    expect(await rowOf(target.id)).toMatchObject({ site_survey_extensions: 1 });
  });
});

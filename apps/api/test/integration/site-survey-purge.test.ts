/**
 * The automatic purge of site surveys (EVM-139 AC1-AC6; ADR-0024 pt 9; SR-PRIV-11, SR-PRIV-04, SR-FILE-11, SR-LOG-03; DO-K) against the real worker job over PostgreSQL, with
 * the in-memory register of deletions, the in-memory storage and a controlled clock. Everything is synthetic: the street, the city, the title, the phone, the free text of the
 * reason and the notes carry SENTINELS that must stay in no register object, no log line, no audit record, no `change_log` row and - after the purge - no row at all.
 */
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { SITE_SURVEY_PURGE_JOB } from '../../src/modules/work-orders/application/site-survey-purge.job.ts';
import { SITE_SURVEY_PURGE_FAILED } from '../../src/modules/work-orders/application/site-survey-purge.job.ts';
import { JobFailure } from '../../src/platform/jobs/index.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { insertDocumentRow } from '../support/document-fixtures.ts';
import { createUser } from '../support/identity-fixtures.ts';
import { insertEntries } from '../support/timeline-fixtures.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';
import {
  DAY,
  NOTE,
  STREET,
  addMedia,
  auditText,
  changeLogText,
  closeStarted,
  db,
  everything,
  expectNoSentinel,
  inDays,
  job,
  metric,
  nowOf,
  one,
  rowOf,
  start,
  survey,
} from '../support/site-survey-purge-harness.ts';

afterEach(closeStarted);
describe('EVM-139 AC1: the candidates and the mode report', () => {
  it('EVM-139 AC1 report is the default mode: only the three conditions select, nothing is erased, the count is in the log and the gauge', async () => {
    const { current, register } = await start(null);
    // the surveys were created 100 days ago: a deadline one day ahead is a survey at day 89 of 90, one day behind it - at day 91
    await survey(current, { deadline: inDays(current, 1) });
    await survey(current, { deadline: inDays(current, -1) });
    await survey(current, { deadline: inDays(current, -9) });
    await survey(current, { deadline: nowOf(current) });
    const withCustomer = await survey(current, { deadline: inDays(current, 5) });
    const customerId = await insertCustomer(current.database.admin, { firstName: 'Klient', lastName: 'Wizji', phone: '+48600139004' });
    await sql`update work_orders.work_orders set customer_id = ${customerId}, site_survey_expires_at = null, requester_phone = null where id = ${withCustomer.id}`.execute(
      db(current),
    );
    const before = await everything(current);

    const counts = await job(current).run();

    // a deadline ahead is no candidate, one that passed is (day 91), the deadline AT the instant is not (strict), a survey with a customer never is
    expect(counts).toEqual({ candidates: 2, purged: 0, failed: 0 });
    expect(await everything(current)).toBe(before);
    expect(register.calls).toHaveLength(0);
    expect(metric(current, 'site_survey_purge_candidates')).toBe(2);
    const line = current.logs.lines.find((entry) => entry.includes(SITE_SURVEY_PURGE_JOB));
    expect(line).toContain('"mode":"report"');
    expect(line).toContain('"candidates":2');
    expectNoSentinel(current.logs.text);
  });

  it('EVM-139 AC1 the gauge follows the clock: 89 days after the creation nothing, 91 days one candidate', async () => {
    const { current } = await start('report');
    const created = new Date(nowOf(current).getTime() - 100 * DAY);
    await survey(current, { deadline: new Date(created.getTime() + 90 * DAY) }); // 90 days after the creation: the deadline passed 10 days ago
    await sql`update work_orders.work_orders set site_survey_expires_at = ${new Date(nowOf(current).getTime() + DAY)}`.execute(db(current));
    expect(await job(current).run()).toMatchObject({ candidates: 0 });
    current.clock.advance(2 * DAY);
    expect(await job(current).run()).toMatchObject({ candidates: 1 });
  });
});

describe('EVM-139 AC2: enforce - the register first, then the erasure in one transaction', () => {
  it('EVM-139 AC2 an enforced purge writes the register BEFORE the first change and leaves an anonymous tombstone with its number', async () => {
    const { current, register } = await start('enforce');
    const order = await survey(current, { deadline: inDays(current, -9) });
    const keys = await addMedia(current, order);
    await insertEntries(db(current), order.id, order.creator, [{ body: NOTE }, { kind: 'event' }]);
    let seenBeforeTheFirstChange = '';
    register.onRecord = async () => {
      seenBeforeTheFirstChange = await everything(current);
    };
    const before = await everything(current);

    const result = await job(current).run();
    expect(result).toMatchObject({ candidates: 1, taken: 1, purged: 1, failed: 0, objectsPending: 0 });

    // the register was asked while the database was still untouched
    expect(seenBeforeTheFirstChange).toBe(before);
    expect(register.objects).toHaveLength(1);
    const entry = JSON.parse(register.objects[0]?.body ?? '{}') as Record<string, unknown>;
    expect(entry).toMatchObject({
      operationCode: 'site_survey_purged',
      subjectType: 'work_order',
      subjectId: order.id,
      workOrderId: order.id,
      siteId: order.siteId,
      actorUserId: '00000000-0000-7000-8000-000000000000',
    });
    expect((entry['mediaAssetIds'] as string[]).length).toBe(2);
    expectNoSentinel(register.objects[0]?.body ?? '');

    const row = await rowOf(current, order.id);
    expect(row).toMatchObject({ title: 'Wizja lokalna', description: null, requester_phone: null, status_reason: null });
    expect(row?.deleted_at).toEqual(nowOf(current));
    expect(row?.purged_at).toEqual(nowOf(current));
    expect((await one<{ number: string }>(current, sql`select number from work_orders.work_orders where id = ${order.id}`))?.number).toBe(
      order.number,
    );

    const site = await one<{ street: string; city: string; notes: string | null; anonymized_at: Date | null; deleted_at: Date | null }>(
      current,
      sql`select street, city, notes, anonymized_at, deleted_at from sites.sites where id = ${order.siteId}`,
    );
    expect(site).toMatchObject({ street: 'Adres usunięty', city: 'Adres usunięty', notes: null });
    expect(site?.anonymized_at).toEqual(nowOf(current));
    expect(site?.deleted_at).toEqual(nowOf(current));

    const files = (
      await sql<{ erased_at: Date | null; objects_erased_at: Date | null; original_filename: string | null }>`
        select f.erased_at, f.objects_erased_at, f.original_filename from media.stored_files f
        join media.media_assets a on a.id = f.media_asset_id where a.work_order_id = ${order.id}`.execute(db(current))
    ).rows;
    expect(files).toHaveLength(2);
    expect(files.every((file) => file.erased_at !== null && file.objects_erased_at !== null && file.original_filename === null)).toBe(true);
    const assets = (
      await sql<{
        file_purged_at: Date | null;
        deleted_at: Date | null;
      }>`select file_purged_at, deleted_at from media.media_assets where work_order_id = ${order.id}`.execute(db(current))
    ).rows;
    expect(assets.every((asset) => asset.file_purged_at !== null && asset.deleted_at !== null)).toBe(true);
    for (const key of keys) expect(current.storage.currentKeys()).not.toContain(key);
    const sessions = (
      await sql<{ state: string }>`select s.state from media.upload_sessions s join media.stored_files f on f.id = s.stored_file_id
      join media.media_assets a on a.id = f.media_asset_id where a.work_order_id = ${order.id}`.execute(db(current))
    ).rows;
    expect(sessions.every((session) => session.state === 'aborted')).toBe(true);

    const entries = (
      await sql<{
        kind: string;
        body: string | null;
        redacted_at: Date | null;
      }>`select kind, body, redacted_at from timeline.timeline_entries where work_order_id = ${order.id}`.execute(db(current))
    ).rows;
    expect(
      entries.filter((e) => e.kind !== 'event').every((e) => e.redacted_at !== null && (e.body ?? '').startsWith('Treść usunięta')),
    ).toBe(true);
    expect(entries.some((e) => e.kind === 'event')).toBe(true);

    // nothing of the sentinels in any row of the tables of the story, the audit trail, the change log or the log
    expectNoSentinel(await everything(current));
    expectNoSentinel(await auditText(current));
    expectNoSentinel(await changeLogText(current));
    expectNoSentinel(current.logs.text);

    const audit = await one<{ actor_type: string; outcome: string; action: string; object_id: string }>(
      current,
      sql`select actor_type, outcome, action, object_id from audit.events where action = 'work_order.site_survey_purged'`,
    );
    expect(audit).toMatchObject({ actor_type: 'system', outcome: 'success', object_id: order.id });
  });

  it('EVM-139 AC2 a location that was not made for the survey, is held by another order or a document, or is older than the window stays as it is', async () => {
    const { current, register } = await start('enforce');
    const admin = db(current);
    // (a) the location is older than the window; (b) another live order points at it; (c) a document points at it; (d) made by somebody else
    const old = await survey(current, { deadline: inDays(current, -9), siteCreatedHoursBefore: 48 });
    const shared = await survey(current, { deadline: inDays(current, -9) });
    await insertWorkOrders(admin, [{ number: 'ZL-2092-9001', siteId: shared.siteId }]);
    const withDocument = await survey(current, { deadline: inDays(current, -9) });
    await insertDocumentRow(admin, { siteId: withDocument.siteId, createdBy: withDocument.creator });
    const stranger = await survey(current, { deadline: inDays(current, -9) });
    await sql`update sites.sites set created_by = ${(await createUser(admin, current.clock, { role: 'editor' })).id} where id = ${stranger.siteId}`.execute(
      admin,
    );

    expect(await job(current).run()).toMatchObject({ purged: 4, failed: 0 });
    for (const order of [old, shared, stranger]) {
      const site = await one<{ anonymized_at: Date | null; street: string }>(
        current,
        sql`select anonymized_at, street from sites.sites where id = ${order.siteId}`,
      );
      expect(site?.anonymized_at, order.number).toBeNull();
      expect(site?.street).toBe(STREET);
    }
    // the register of a survey whose location stays does not name the location
    for (const object of register.objects) {
      const body = JSON.parse(object.body) as Record<string, unknown>;
      if (body['subjectId'] === old.id || body['subjectId'] === shared.id || body['subjectId'] === stranger.id)
        expect(body).not.toHaveProperty('siteId');
    }
  });

  it('EVM-139 AC2 when the register does not take the record the survey is NOT touched, the failure is audited and alerted, and the job ends as a failure', async () => {
    const { current, register } = await start('enforce');
    const order = await survey(current, { deadline: inDays(current, -9) });
    await addMedia(current, order, 1);
    register.failAll();
    const before = await everything(current);

    await expect(job(current).run()).rejects.toMatchObject({ code: SITE_SURVEY_PURGE_FAILED });
    await expect(job(current).run()).rejects.toBeInstanceOf(JobFailure);

    expect(await everything(current)).toBe(before);
    expect(current.storage.currentKeys()).toHaveLength(1);
    const alerts = await sql<{
      alert_code: string;
    }>`select alert_code from platform.security_alert_outbox where alert_code = 'site_survey_purge_failed'`.execute(db(current));
    expect(alerts.rows.length).toBeGreaterThanOrEqual(1);
    const failed = await sql<{
      n: string;
    }>`select count(*)::text as n from audit.events where action = 'work_order.site_survey_purge_failed' and outcome = 'failed' and object_id = ${order.id}`.execute(
      db(current),
    );
    expect(Number(failed.rows[0]?.n)).toBeGreaterThanOrEqual(1);
    expectNoSentinel(current.logs.text);

    register.recover();
    expect(await job(current).run()).toMatchObject({ purged: 1, failed: 0 });
  });
});

/**
 * Edge cases added by the independent verification of EVM-139 and EVM-140 (the strict dispatch of a phone mutation to a purged survey, the ordinary order next to the
 * limit of surveys, the date of the reminder around the midnight of the business zone). Synthetic data only.
 */
import { sql, type Kysely } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { SiteSurveyReminderComposer, SiteSurveyReminderJob } from '../../src/modules/work-orders/index.ts';
import type { Database } from '../../src/platform/database/database.ts';
import { EmailTransientError } from '../../src/platform/email/email-errors.ts';
import { InMemoryEmailSender } from '../../src/platform/email/in-memory-email-sender.ts';
import { SendEmailJob } from '../../src/platform/email/send-email.job.ts';
import { JobFailure } from '../../src/platform/jobs/index.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { DATABASE } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { createSession, createUser } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { formatDeletionDate } from '../../src/modules/work-orders/domain/site-survey-reminder.ts';
import { bootSync, editor } from '../support/sync-harness.ts';
import { uuidv7 } from '../support/uuid.ts';
import { addMedia, closeStarted, open, db, inDays, job, one, rowOf, start, survey } from '../support/site-survey-purge-harness.ts';

afterEach(closeStarted);

const PATH = '/api/v1/sync/mutations';
const note = (workOrderId: string) => ({
  mutationId: uuidv7(),
  type: 'CreateNote',
  commandVersion: 1,
  payload: { id: uuidv7(), workOrderId, noteCategory: 'site_visit', body: 'Notatka z terenu.', capturedAt: '2027-04-30T08:00:00.000Z' },
});

describe('EVM-139 AC4 strict: the queue of the creator after the purge', () => {
  it('EVM-139 AC4 a note of the creator to a purged survey is `rejected target_unavailable` - exactly that code, never applied, never `forbidden`; the same mutation again is the same answer; nothing is written', async () => {
    const { current } = await start('enforce');
    const { account, phone } = await editor(current);
    const order = await survey(current, { deadline: inDays(current, -9), creator: account.user.id });
    await addMedia(current, order, 1);
    expect(await job(current).run()).toMatchObject({ purged: 1 });
    expect((await rowOf(current, order.id))?.purged_at).not.toBeNull();

    const entries = async () =>
      Number((await one<{ n: string }>(current, sql`select count(*)::text as n from timeline.timeline_entries where kind <> 'event'`))?.n);
    const before = await entries();
    const mutation = note(order.id);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await phone.post(PATH, { mutations: [mutation] }, phone.authorised());
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const results = (response.body as { results: Array<Record<string, unknown>> }).results;
      expect(results).toEqual([{ mutationId: mutation.mutationId, outcome: 'rejected', code: 'target_unavailable' }]);
    }
    expect(await entries()).toBe(before);

    // the pull still answers and reveals no address
    const pulled = await phone.get('/api/v1/sync/changes', phone.authorised());
    expect(pulled.status).toBe(200);
    expect(JSON.stringify(pulled.body)).not.toContain('Znacznik-usuwania-synt');
  });
});

describe('EVM-139 AC1 AC3: the clock around the deadline', () => {
  it('EVM-139 AC3 a survey is purged only when the deadline is STRICTLY behind the clock: at the instant nothing, 1 ms later it goes', async () => {
    const { current } = await start('enforce');
    const order = await survey(current, { deadline: inDays(current, 0) });
    expect(await job(current).run()).toMatchObject({ candidates: 0, purged: 0 });
    expect((await rowOf(current, order.id))?.purged_at).toBeNull();
    current.clock.advance(1);
    expect(await job(current).run()).toMatchObject({ candidates: 1, purged: 1 });
  });

  it('EVM-139 AC1 with no mode configured the default is report: a deadline long past is a candidate and stays', async () => {
    const { current } = await start(null);
    const order = await survey(current, { deadline: inDays(current, -40) });
    expect(await job(current).run()).toMatchObject({ candidates: 1, purged: 0 });
    expect(await rowOf(current, order.id)).toMatchObject({ deleted_at: null, purged_at: null });
  });
});

describe('EVM-140 AC4: an ordinary order is not limited by the surveys (through the API, not only a seed)', () => {
  it('EVM-140 AC4 with 20 open surveys of the creator an ordinary order of the same person is created (201), and the 21st survey is still refused', async () => {
    const { app: current } = await bootSync({ SITE_SURVEYS_ENABLED: 'true' });
    open.push(current);
    const user = await createUser(db(current), current.clock, { role: 'editor' });
    const session = await createSession(db(current), current.clock, user, { channel: 'web' });
    const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    panel.cookie = session.cookie;
    panel.csrfToken = session.csrfToken;
    for (let index = 0; index < 20; index += 1) await survey(current, { deadline: inDays(current, 30), creator: user.id });

    const siteId = await insertSite(db(current), {});
    const customer = { id: uuidv7(), kind: 'person', firstName: 'Klient', lastName: 'Limitowy', phone: '600 000 140' };
    expect((await panel.post('/api/v1/customers', customer)).status).toBe(201);
    const template = (await sql<{ id: string }>`select id from catalog.work_order_templates limit 1`.execute(db(current))).rows[0]?.id;
    const ordinary = await panel.post('/api/v1/work-orders', { id: uuidv7(), customerId: customer.id, siteId, templateId: template });
    expect(ordinary.status, JSON.stringify(ordinary.body)).toBe(201);

    const refused = await panel.post('/api/v1/site-surveys', { id: uuidv7(), siteId });
    expect([refused.status, (refused.body as { code?: string }).code]).toEqual([409, 'site_survey_limit_exceeded']);
  });
});

describe('EVM-140 AC1: the date of the deletion in the business zone', () => {
  it('EVM-140 AC1 the date is the day in Europe/Warsaw: 23:30 UTC the evening before is already the next day, also over the change to summer time', () => {
    expect(formatDeletionDate(new Date('2027-02-14T22:59:59.000Z'))).toBe('14.02.2027');
    expect(formatDeletionDate(new Date('2027-02-14T23:00:00.000Z'))).toBe('15.02.2027');
    // 2027-03-28 is the change to summer time (02:00 -> 03:00): 22:00 UTC on the 27th is 23:00 CET, 22:00 UTC on the 28th is 00:00 CEST of the 29th
    expect(formatDeletionDate(new Date('2027-03-27T22:59:59.000Z'))).toBe('27.03.2027');
    expect(formatDeletionDate(new Date('2027-03-27T23:00:00.000Z'))).toBe('28.03.2027');
    expect(formatDeletionDate(new Date('2027-03-28T21:59:59.000Z'))).toBe('28.03.2027');
    expect(formatDeletionDate(new Date('2027-03-28T22:00:00.000Z'))).toBe('29.03.2027');
  });
});

describe('EVM-140 AC5: a failure of the delivery of one message does not stop the others', () => {
  it('EVM-140 AC5 one transient refusal of the sender leaves that one row pending for the retry of the queue, the other messages are sent, and the retry sends the rest - no second copy', async () => {
    const { current } = await start('report');
    const creator = (await createUser(db(current), current.clock, { role: 'editor' })).id;
    await createUser(db(current), current.clock, { role: 'administrator' });
    await survey(current, { deadline: inDays(current, 5), creator });
    expect(await current.app.get(SiteSurveyReminderJob, { strict: false }).run()).toMatchObject({ messages: 2, failed: 0 });

    const sender = new InMemoryEmailSender();
    const send = new SendEmailJob({
      db: current.app.get<Kysely<Database>>(DATABASE, { strict: false }),
      clock: current.clock,
      logger: createLogger({ level: 'fatal' }),
      sender,
      composers: [current.app.get(SiteSurveyReminderComposer, { strict: false })],
    });
    const ids = (
      await sql<{ id: string }>`select id from platform.email_outbox where kind = 'site_survey_expiring' order by id`.execute(db(current))
    ).rows.map((row) => row.id);
    expect(ids).toHaveLength(2);
    sender.failNext(new EmailTransientError('connection_failed'));
    const failure = await send.run({ ids }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(JobFailure);
    expect(sender.sent).toHaveLength(1);
    const states = async () =>
      (
        await sql<{ state: string }>`select state from platform.email_outbox where kind = 'site_survey_expiring' order by state`.execute(
          db(current),
        )
      ).rows.map((row) => row.state);
    expect(await states()).toEqual(['pending', 'sent']);

    expect(await send.run({ ids })).toMatchObject({ sent: 1 });
    expect(sender.sent).toHaveLength(2);
    expect(new Set(sender.sent.map((mail) => mail.to)).size).toBe(2);
    expect(await states()).toEqual(['sent', 'sent']);
  });
});

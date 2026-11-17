/**
 * The reminder of a site survey that is about to be deleted (EVM-140 AC1, AC5; ADR-0024 pt 9; SR-DATA-01, SR-LOG-03; DO-K) against the real worker job, the outbox and
 * the composer over PostgreSQL. A due survey (15 days or less to the deadline, never reminded, open) gets ONE message for its creator and for every active
 * Administrator; the mark `site_survey_reminded_at` makes a second run write nothing; the text holds the number, the date and the link - never the address or the phone.
 * Everything is synthetic: the street, the city, the postal code, the title and the phone carry sentinels that must be in no outbox row, no log line, no audit record
 * and no message.
 */
import { sql, type Kysely } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SITE_SURVEY_REMINDER_FAILED } from '../../src/modules/work-orders/application/site-survey-reminder.job.ts';
import { SiteSurveyReminderComposer, SiteSurveyReminderJob } from '../../src/modules/work-orders/index.ts';
import type { Database } from '../../src/platform/database/database.ts';
import { InMemoryEmailSender } from '../../src/platform/email/in-memory-email-sender.ts';
import { SendEmailJob } from '../../src/platform/email/send-email.job.ts';
import { JobFailure } from '../../src/platform/jobs/index.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { DATABASE } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createUser, type Role } from '../support/identity-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';

const NOW = '2027-01-30T08:00:00.000Z';
const DAY = 86_400_000;
const STREET = 'ul. Znacznik-przypomnienia-synt';
const CITY = 'Przypominanowo-synt';
const POSTAL = '99-141';
const TITLE = 'Tytul-wizji-synt';
const PHONE = '+48600140003';
const REFUSED_TITLE = 'Odmowa-synt';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp({ now: NOW });
});
afterEach(async () => {
  await current.close();
});
const admin = () => current.database.admin;
const job = () => current.app.get(SiteSurveyReminderJob, { strict: false });
const now = () => current.clock.now();
const inDays = (days: number, extraMs = 0) => new Date(now().getTime() + days * DAY + extraMs);
let numbering = 0;

async function user(role: Role, status: 'active' | 'deactivated' = 'active'): Promise<string> {
  return (await createUser(admin(), current.clock, { role, status })).id;
}

interface SurveyOptions {
  readonly expiresAt?: Date;
  readonly creator?: string | null;
  readonly status?: 'cancelled';
  readonly deletedAt?: Date;
  readonly remindedAt?: Date;
  readonly title?: string;
}
/** An open survey of a creator, with the deadline of the options (default: in 10 days). */
async function survey(options: SurveyOptions = {}): Promise<{ id: string; number: string }> {
  numbering += 1;
  const number = `ZL-2091-${String(numbering).padStart(4, '0')}`;
  const siteId = await insertSite(admin(), { street: STREET, city: CITY, postalCode: POSTAL });
  const ids = await insertWorkOrders(admin(), [
    {
      number,
      title: options.title ?? TITLE,
      siteId,
      siteSurveyExpiresAt: options.expiresAt ?? inDays(10),
      ...(options.status === undefined ? {} : { status: options.status, closedAt: new Date('2026-12-01T08:00:00Z') }),
      ...(options.deletedAt === undefined ? {} : { deletedAt: options.deletedAt }),
    },
  ]);
  const id = [...ids.values()][0] ?? '';
  await sql`update work_orders.work_orders set created_by = ${options.creator ?? null}, requester_phone = ${PHONE},
    site_survey_reminded_at = ${options.remindedAt ?? null} where id = ${id}`.execute(admin());
  return { id, number };
}

interface OutboxRow {
  kind: string;
  variant: string | null;
  recipient_user_id: string;
  subject_id: string | null;
  state: string;
}
const outbox = async (): Promise<OutboxRow[]> =>
  (
    await sql<OutboxRow>`
      select kind, variant, recipient_user_id, subject_id, state from platform.email_outbox
      where kind = 'site_survey_expiring' order by recipient_user_id, subject_id`.execute(admin())
  ).rows;
const remindedAt = async (id: string): Promise<Date | null> =>
  (await sql<{ r: Date | null }>`select site_survey_reminded_at as r from work_orders.work_orders where id = ${id}`.execute(admin()))
    .rows[0]?.r ?? null;

function sendingJob(sender = new InMemoryEmailSender()) {
  const db = current.app.get<Kysely<Database>>(DATABASE, { strict: false });
  const composer = current.app.get(SiteSurveyReminderComposer, { strict: false });
  return {
    sender,
    send: new SendEmailJob({ db, clock: current.clock, logger: createLogger({ level: 'fatal' }), sender, composers: [composer] }),
  };
}
const outboxIds = async (): Promise<string[]> =>
  (
    await sql<{ id: string }>`select id from platform.email_outbox where kind = 'site_survey_expiring' order by id`.execute(admin())
  ).rows.map((row) => row.id);

describe('the daily reminder: who gets it and when (EVM-140 AC1)', () => {
  it('EVM-140 AC1 a due survey gets ONE message for its creator and ONE for each active Administrator, the mark is set, and a second run writes nothing', async () => {
    const creator = await user('editor');
    const [first, second] = [await user('administrator'), await user('administrator')];
    await user('administrator', 'deactivated');
    await user('editor');
    const due = await survey({ creator });

    expect(await job().run()).toEqual({ due: 1, surveys: 1, messages: 3, failed: 0 });
    const rows = await outbox();
    expect(rows.map((row) => row.recipient_user_id).sort()).toEqual([creator, first, second].sort());
    expect(rows.every((row) => row.subject_id === due.id && row.variant === null && row.state === 'pending')).toBe(true);
    expect(await remindedAt(due.id)).toEqual(now());

    expect(await job().run()).toEqual({ due: 0, surveys: 0, messages: 0, failed: 0 });
    expect(await outbox()).toHaveLength(3);
  });

  it('EVM-140 AC1 a creator who is an Administrator gets one message, not two; a survey with no creator is for the Administrators only', async () => {
    const both = await user('administrator');
    const other = await user('administrator');
    const mine = await survey({ creator: both });
    const nobodys = await survey({ creator: null });
    expect(await job().run()).toMatchObject({ due: 2, surveys: 2, messages: 4 });
    const rows = await outbox();
    expect(
      rows
        .filter((row) => row.subject_id === mine.id)
        .map((row) => row.recipient_user_id)
        .sort(),
    ).toEqual([both, other].sort());
    expect(rows.filter((row) => row.subject_id === nobodys.id)).toHaveLength(2);
  });

  it('EVM-140 AC1 the boundary: 15 days to the deadline is due, one millisecond more is not; an overdue survey that is not purged is due', async () => {
    await user('administrator');
    const exactly = await survey({ expiresAt: inDays(15) });
    const later = await survey({ expiresAt: inDays(15, 1) });
    const overdue = await survey({ expiresAt: inDays(-3) });
    expect(await job().run()).toMatchObject({ due: 2, surveys: 2 });
    expect(await remindedAt(exactly.id)).not.toBeNull();
    expect(await remindedAt(overdue.id)).not.toBeNull();
    expect(await remindedAt(later.id)).toBeNull();
    // the day comes: the clock moves, the survey that was 1 ms too far is due now
    current.clock.set(new Date(now().getTime() + 1));
    expect(await job().run()).toMatchObject({ due: 1, surveys: 1 });
    expect(await remindedAt(later.id)).not.toBeNull();
  });

  it('EVM-140 AC1 a survey that was already reminded, a cancelled one, a deleted one, one with a customer and an ordinary order get nothing', async () => {
    await user('administrator');
    const reminded = await survey({ remindedAt: inDays(-1) });
    const cancelled = await survey({ status: 'cancelled' });
    const deleted = await survey({ deletedAt: new Date('2027-01-20T08:00:00Z') });
    await insertWorkOrders(admin(), [{ number: 'ZL-2091-9990' }]);
    expect(await job().run()).toEqual({ due: 0, surveys: 0, messages: 0, failed: 0 });
    expect(await outbox()).toEqual([]);
    expect(await remindedAt(reminded.id)).toEqual(inDays(-1));
    expect(await remindedAt(cancelled.id)).toBeNull();
    expect(await remindedAt(deleted.id)).toBeNull();
  });

  it('EVM-140 AC1 an extension clears the mark: the next reminder comes 15 days before the NEW deadline, and not before', async () => {
    const creator = await user('editor');
    const target = await survey({ creator, expiresAt: inDays(10) });
    await job().run();
    expect(await outbox()).toHaveLength(1);
    // what the extension writes: the deadline + 90 days, the mark cleared
    await sql`update work_orders.work_orders set site_survey_expires_at = ${inDays(100)}, site_survey_extensions = 1, site_survey_reminded_at = null
      where id = ${target.id}`.execute(admin());
    expect(await job().run()).toMatchObject({ due: 0, messages: 0 });
    current.clock.set(inDays(85));
    expect(await job().run()).toMatchObject({ due: 1, surveys: 1, messages: 1 });
    expect((await outbox()).filter((row) => row.recipient_user_id === creator)).toHaveLength(2);
  });
});

describe('the message (EVM-140 AC1, AC5)', () => {
  it('EVM-140 AC1 AC5 the text is the number, the date of the deletion and the link to the order - and no address, no phone, no title; it goes to the creator and to the Administrators', async () => {
    const creator = await user('editor');
    const administrator = await user('administrator');
    const due = await survey({ creator, expiresAt: new Date('2027-02-14T08:00:00.000Z') });
    await job().run();
    const { sender, send } = sendingJob();
    expect(await send.run({ ids: await outboxIds() })).toMatchObject({ sent: 2 });

    expect(sender.sent).toHaveLength(2);
    const addresses = (
      await sql<{ email: string }>`select email from identity.users where id in (${creator}, ${administrator}) order by email`.execute(
        admin(),
      )
    ).rows.map((row) => row.email);
    expect(sender.sent.map((mail) => mail.to).sort()).toEqual(addresses);
    for (const mail of sender.sent) {
      expect(mail.subject).toBe(`EVia Manager: wizja lokalna ${due.number} zostanie usunięta`);
      expect(mail.text).toContain(`wizja lokalna ${due.number} zostanie usunięta dnia 14.02.2027.`);
      expect(mail.text).toContain('Przypisz klienta, przedłuż albo odrzuć.');
      expect(mail.text).toContain('Wizję możesz przedłużyć najwyżej dwa razy, za każdym');
      expect(mail.text).toContain(`${PANEL_ORIGIN}/work-orders/${due.id}`);
      for (const secret of [STREET, CITY, POSTAL, TITLE, PHONE, '600140003']) {
        expect(mail.text).not.toContain(secret);
        expect(mail.subject).not.toContain(secret);
      }
    }
  });

  it('EVM-140 AC1 a message is obsolete when the survey is assigned a customer, rejected or deleted after it was queued - nothing is sent and the rows are superseded', async () => {
    await user('administrator');
    const assigned = await survey();
    const rejected = await survey();
    const deleted = await survey();
    await job().run();
    expect(await outbox()).toHaveLength(3);
    const customerId = await insertCustomer(admin());
    await sql`update work_orders.work_orders set customer_id = ${customerId}, site_survey_expires_at = null, requester_phone = null,
      site_survey_reminded_at = null where id = ${assigned.id}`.execute(admin());
    await sql`update work_orders.work_orders set status = 'cancelled', closed_at = ${now()} where id = ${rejected.id}`.execute(admin());
    await sql`update work_orders.work_orders set deleted_at = ${now()} where id = ${deleted.id}`.execute(admin());
    const { sender, send } = sendingJob();
    await send.run({ ids: await outboxIds() });
    expect(sender.sent).toEqual([]);
    expect((await outbox()).map((row) => row.state)).toEqual(['superseded', 'superseded', 'superseded']);
  });
  it('EVM-140 AC1 a recipient who lost the right to the survey, or the account, gets nothing: Tylko odczyt, an Editor who is not the creator, a deactivated account', async () => {
    const creator = await user('editor');
    const demoted = await user('editor');
    const deactivated = await user('administrator');
    const due = await survey({ creator });
    await sql`insert into platform.email_outbox (kind, variant, recipient_user_id, subject_id, created_at) values
      ('site_survey_expiring', null, ${demoted}, ${due.id}, ${now()}), ('site_survey_expiring', null, ${deactivated}, ${due.id}, ${now()}),
      ('site_survey_expiring', null, ${creator}, ${due.id}, ${now()})`.execute(admin());
    await sql`update identity.users set role = 'read_only' where id = ${demoted}`.execute(admin());
    await sql`update identity.users set status = 'deactivated', deactivated_at = ${now()} where id = ${deactivated}`.execute(admin());
    const { sender, send } = sendingJob();
    await send.run({ ids: await outboxIds() });
    expect(sender.sent).toHaveLength(1);
    const states = (await sql<{ state: string }>`select state from platform.email_outbox order by state`.execute(admin())).rows.map(
      (row) => row.state,
    );
    expect(states.sort()).toEqual(['sent', 'superseded', 'superseded']);
  });

  it('EVM-140 AC1 a message whose subject is no identifier is a permanent error: nothing is sent and no link is made of it', async () => {
    const administrator = await user('administrator');
    await sql`insert into platform.email_outbox (kind, variant, recipient_user_id, created_at) values ('site_survey_expiring', null, ${administrator}, ${now()})`.execute(
      admin(),
    );
    const { sender, send } = sendingJob();
    await send.run({ ids: await outboxIds() });
    expect(sender.sent).toEqual([]);
    const row = (await sql<{ state: string }>`select state from platform.email_outbox where kind = 'site_survey_expiring'`.execute(admin()))
      .rows[0];
    expect(row?.state).toBe('failed');
  });
});

describe('what stays out of the trails, and a failure of one survey (EVM-140 AC5)', () => {
  it('EVM-140 AC5 one survey that fails does not stop the others: the others are reminded, the failed one keeps no mark and is done by the next run; the log holds counts only', async () => {
    const administrator = await user('administrator');
    const bad = await survey({ expiresAt: inDays(1), title: REFUSED_TITLE });
    const good = await survey({ expiresAt: inDays(2) });
    const alsoGood = await survey({ expiresAt: inDays(3) });
    await sql`
      create function platform.refuse_one_reminder() returns trigger language plpgsql as $$
      begin
        if exists (select 1 from work_orders.work_orders where id = new.subject_id and title = 'Odmowa-synt') then raise exception 'refused for the test' using errcode = 'XX001'; end if;
        return new;
      end $$`.execute(admin());
    await sql`create trigger refuse_one_reminder before insert on platform.email_outbox for each row execute function platform.refuse_one_reminder()`.execute(
      admin(),
    );

    const failure = await job()
      .run()
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(JobFailure);
    expect((failure as JobFailure).message).toBe(SITE_SURVEY_REMINDER_FAILED);
    expect(await remindedAt(good.id)).not.toBeNull();
    expect(await remindedAt(alsoGood.id)).not.toBeNull();
    expect(await remindedAt(bad.id)).toBeNull();
    expect((await outbox()).map((row) => row.subject_id).sort()).toEqual([good.id, alsoGood.id].sort());

    await sql`drop trigger refuse_one_reminder on platform.email_outbox`.execute(admin());
    expect(await job().run()).toEqual({ due: 1, surveys: 1, messages: 1, failed: 0 });
    expect((await outbox()).map((row) => row.recipient_user_id)).toEqual([administrator, administrator, administrator]);
    for (const id of [bad.id, good.id, alsoGood.id]) expect(current.logs.text).not.toContain(id);
  });

  it('EVM-140 AC5 neither the outbox, the audit trail, the change log, the log of the job nor the messages hold the street, the city, the postal code, the title or the phone', async () => {
    const creator = await user('editor');
    await user('administrator');
    await survey({ creator });
    await job().run();
    const { sender, send } = sendingJob();
    await send.run({ ids: await outboxIds() });
    const text = async (query: ReturnType<typeof sql>) => JSON.stringify((await query.execute(admin())).rows);
    const haystacks = [
      await text(sql`select to_jsonb(t) as r from platform.email_outbox t`),
      await text(sql`select to_jsonb(t) as r from audit.events t`),
      await text(sql`select to_jsonb(t) as r from sync.change_log t`),
      current.logs.text,
      JSON.stringify(sender.sent),
    ];
    for (const secret of [STREET, CITY, POSTAL, TITLE, PHONE, '600140003']) {
      for (const haystack of haystacks) expect(haystack).not.toContain(secret);
    }
    expect(current.logs.text).toContain('site survey reminder: done');
  });
});

describe('the two variants of the text (EVM-140 AC1; docs/ux/flows/e-maile.md section 10)', () => {
  it('EVM-140 AC1 a survey extended twice gets the variant without the extension, with the date of the new deadline; the link is the same', async () => {
    const creator = await user('editor');
    const due = await survey({ creator, expiresAt: new Date('2027-08-13T08:00:00.000Z') });
    await sql`update work_orders.work_orders set site_survey_extensions = 2 where id = ${due.id}`.execute(admin());
    current.clock.set(new Date('2027-08-01T08:00:00.000Z'));
    await job().run();
    const { sender, send } = sendingJob();
    await send.run({ ids: await outboxIds() });
    const mail = sender.sent.find((candidate) => candidate.text.includes(due.number));
    expect(mail?.text).toContain(`wizja lokalna ${due.number} zostanie usunięta dnia 13.08.2027.`);
    expect(mail?.text).toContain('Przypisz klienta albo odrzuć.');
    expect(mail?.text).not.toContain('przedłuż albo odrzuć');
    expect(mail?.text).toContain('Ta wizja była już dwukrotnie przedłużona i nie można jej przedłużyć');
    expect(mail?.text).toContain(`${PANEL_ORIGIN}/work-orders/${due.id}`);
  });
});

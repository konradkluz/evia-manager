import { sql, type Kysely } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EmailComposer } from '../../src/platform/email/email-composer.ts';
import { InvitationEmailComposer } from '../../src/modules/identity/index.ts';
import { latestEmailStatus, STATUS_BATCH_LIMIT } from '../../src/platform/email/email-outbox.ts';
import { EmailRelay } from '../../src/platform/email/email-relay.ts';
import { InMemoryEmailSender } from '../../src/platform/email/in-memory-email-sender.ts';
import { SendEmailJob } from '../../src/platform/email/send-email.job.ts';
import { scopeOf, type CursorCodec } from '../../src/platform/crypto/opaque-cursor.ts';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import type { JobQueue } from '../../src/platform/jobs/index.ts';
import { InMemoryJobQueue } from '../../src/platform/jobs/index.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { CURSOR_CODEC, DATABASE } from '../../src/platform/tokens.ts';
import { LogCapture } from '../support/app.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createUser } from '../support/identity-fixtures.ts';
import { USERS, browserOf, emailHarness, invite, inviteBody, linksOf, outboxRows } from '../support/invitation-fixtures.ts';
import { startSmtpTestServer } from '../support/smtp-test-server.ts';
import { startWorker, until } from '../support/worker-harness.ts';
import { uuidv7 } from '../support/uuid.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const db = () => current.app.get<Kysely<Database>>(DATABASE, { strict: false });

describe('the job of the outbox in its edge cases (EVM-024 AC1, AC5; SR-API-06, SR-LOG-02)', () => {
  it('EVM-024 AC1 an account of the command of the first Administrator whose address is not one this system sends to: the invitation is refused BEFORE any token is made, the row is failed with a fixed code', async () => {
    const admin = await browserOf(current);
    const loose = await createUser(current.database.admin, current.clock, {
      role: 'administrator',
      status: 'invited',
      email: 'zażółć@firma.pl',
    });
    expect((await admin.panel.post(`${USERS}/${loose.id}/invitations`)).status).toBe(200);
    const { job, sender } = emailHarness(current);
    const [row] = await outboxRows(current, { recipient: loose.id, kind: 'user_invitation' });

    expect(await job.run({ ids: [row?.id ?? ''] })).toMatchObject({ failed: 1, sent: 0 });

    expect(sender.sent).toEqual([]);
    expect(await linksOf(current, loose.id)).toEqual([]); // the resend ended the old ones; no new token was made
    expect((await outboxRows(current, { recipient: loose.id, kind: 'user_invitation' }))[0]).toMatchObject({
      state: 'failed',
      attempts: 0,
    });
  });

  it('EVM-024 AC1 an alert whose variant is unknown, or whose recipient has an address outside the rules, is failed with a fixed code and nothing is sent', async () => {
    const admin = await createUser(current.database.admin, current.clock, { role: 'administrator' });
    const loose = await createUser(current.database.admin, current.clock, { role: 'administrator', email: 'żółć@firma.pl' });
    const insert = async (recipient: string, variant: string) =>
      (
        await sql<{ id: string }>`
          insert into platform.email_outbox (kind, variant, recipient_user_id, created_at)
          values ('administrator_alert', ${variant}, ${recipient}, ${current.clock.now()}) returning id`.execute(current.database.admin)
      ).rows[0]?.id ?? '';
    const { job, sender } = emailHarness(current);
    expect(await job.run({ ids: [await insert(admin.id, 'something_new')] })).toMatchObject({ failed: 1 });
    expect(await job.run({ ids: [await insert(loose.id, 'administrator_invitation')] })).toMatchObject({ failed: 1 });
    expect(sender.sent).toEqual([]);
    expect((await outboxRows(current, { kind: 'administrator_alert' })).map((row) => row.state)).toEqual(['failed', 'failed']);
  });

  it('EVM-024 AC1 a row that does not exist is skipped; a kind with no composer is an error of the job (the row stays pending, nothing is lost); a row replaced between the first read and the lock is skipped', async () => {
    const { job } = emailHarness(current);
    expect(await job.run({ ids: [uuidv7()] })).toMatchObject({ skipped: 1 });

    const waiting = await createUser(current.database.admin, current.clock, { role: 'editor', status: 'invited' });
    const { rows } = await sql<{ id: string }>`
      insert into platform.email_outbox (kind, recipient_user_id, created_at) values ('user_invitation', ${waiting.id}, ${current.clock.now()}) returning id`.execute(
      current.database.admin,
    );
    const id = rows[0]?.id ?? '';
    const bare = new SendEmailJob({
      db: db(),
      clock: current.clock,
      logger: createLogger({ level: 'fatal' }),
      sender: new InMemoryEmailSender(),
      composers: [],
    });
    await expect(bare.run({ ids: [id] })).rejects.toThrow('no composer');
    expect((await outboxRows(current, { recipient: waiting.id }))[0]).toMatchObject({ state: 'pending', attempts: 0 });

    // a composer that lets the row be replaced while it takes the lock of the account: the job finds it superseded under its own lock
    const racing: EmailComposer = {
      kinds: ['user_invitation', 'administrator_alert'],
      lockRecipient: async (tx) => {
        await sql`update platform.email_outbox set state = 'superseded' where id = ${id}`.execute(tx);
      },
      compose: () => Promise.reject(new Error('must not be reached')),
    };
    const sender = new InMemoryEmailSender();
    const replaced = new SendEmailJob({
      db: db(),
      clock: current.clock,
      logger: createLogger({ level: 'fatal' }),
      sender,
      composers: [racing],
    });
    expect(await replaced.run({ ids: [id] })).toMatchObject({ skipped: 1 });
    expect(sender.sent).toEqual([]);
  });

  it('EVM-024 AC5 W3 a failure that is not one of the classes of the port (a defect of an adapter) is a transient "send_failed": no text of it reaches the log or the job', async () => {
    const admin = await browserOf(current);
    const body = inviteBody();
    expect((await invite(admin, body)).status).toBe(201);
    const logs = new LogCapture();
    const sender = new InMemoryEmailSender();
    const strange = { send: () => Promise.reject(Object.assign(new Error('boom: tajny.adres@example.com'), { response: '550 secret' })) };
    const job = new SendEmailJob({
      db: db(),
      clock: current.clock,
      logger: createLogger({ level: 'info', destination: logs }),
      sender: strange,
      composers: [current.app.get(InvitationEmailComposer, { strict: false })],
    });
    const [row] = await outboxRows(current, { recipient: body.id, kind: 'user_invitation' });
    const failure = await job.run({ ids: [row?.id ?? ''] }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'email_retry' });
    expect(logs.entries.find((entry) => entry['msg'] === 'email: attempt failed; will retry')).toMatchObject({
      code: 'send_failed',
      attempt: 1,
    });
    expect(JSON.stringify(logs.entries) + JSON.stringify(failure, Object.getOwnPropertyNames(failure))).not.toMatch(/tajny|boom|secret/);
    expect(sender.sent).toEqual([]);
  });
});

describe('the relay in its edge cases (EVM-024 AC1, AC5)', () => {
  it('EVM-024 AC5 the polling hands over rows by itself, never runs two rounds at once, survives a failing round with a warning and stops when told to', async () => {
    const logs = new LogCapture();
    const logger = createLogger({ level: 'info', destination: logs });
    const queue = new InMemoryJobQueue();
    const slow: JobQueue = {
      start: () => queue.start(),
      stop: () => queue.stop(),
      work: (name, handler, options) => queue.work(name, handler, options),
      schedule: (name, schedule) => queue.schedule(name, schedule),
      send: async (name, ids, options) => {
        await new Promise((resolve) => setTimeout(resolve, 120));
        await queue.send(name, ids, options);
      },
    };
    const owner = createDatabase({ url: current.database.appUrl, logger: createLogger({ level: 'fatal' }), pool: { max: 2 } });
    const waiting = await createUser(current.database.admin, current.clock, { role: 'editor', status: 'invited' });
    await sql`insert into platform.email_outbox (kind, recipient_user_id, created_at) values ('user_invitation', ${waiting.id}, ${current.clock.now()})`.execute(
      current.database.admin,
    );
    const stop = new EmailRelay(owner, slow, current.clock, logger).start(10);
    await until(() => (queue.pending.length > 0 ? true : undefined), 'the row is handed over by the polling', 5000);
    expect(queue.pending).toHaveLength(1); // the rounds during the slow send did not hand it over again
    stop();
    await owner.destroy();

    // a round that dies — here by a failure THROWN, not rejected — is a warning, not a crash; it names the kind of the failure only
    const failing = {
      transaction: () => {
        throw new TypeError('the database is down: postgres://secret');
      },
    } as unknown as Kysely<Database>;
    const stopFailing = new EmailRelay(failing, queue, current.clock, logger).start(10);
    await until(() => logs.entries.find((entry) => entry['msg'] === 'email relay failed; will retry'), 'the failing round is logged', 5000);
    stopFailing();
    expect(JSON.stringify(logs.entries)).not.toMatch(/postgres:\/\/|evia-it/);
  });

  it('EVM-024 AC5 a queue that rejects with something that is not an Error is logged as "unknown" and leaves the row for the next round', async () => {
    const logs = new LogCapture();
    const waiting = await createUser(current.database.admin, current.clock, { role: 'editor', status: 'invited' });
    await sql`insert into platform.email_outbox (kind, recipient_user_id, created_at) values ('user_invitation', ${waiting.id}, ${current.clock.now()})`.execute(
      current.database.admin,
    );
    const refusing = new InMemoryJobQueue();
    refusing.send = () => Promise.reject(Object.create(null) as Error);
    expect(await new EmailRelay(db(), refusing, current.clock, createLogger({ level: 'info', destination: logs })).relayPending()).toBe(0);
    expect(logs.entries.find((entry) => entry['msg'] === 'email relay: the queue refused a job')).toMatchObject({
      errorType: 'unknown',
      handedOver: 0,
    });
    expect((await outboxRows(current))[0]?.enqueued_at).toBeNull();
  });
});

describe('the statuses of the outbox for a page (EVM-024 AC5; ADR-0001)', () => {
  it('EVM-024 AC5 an empty page asks nothing; more than a page of recipients is refused; the latest message that still counts wins', async () => {
    expect((await latestEmailStatus(db(), [], 'user_invitation')).size).toBe(0);
    await expect(
      latestEmailStatus(
        db(),
        Array.from({ length: STATUS_BATCH_LIMIT + 1 }, () => uuidv7()),
        'user_invitation',
      ),
    ).rejects.toThrow(RangeError);
    const waiting = await createUser(current.database.admin, current.clock, { role: 'editor', status: 'invited' });
    const insert = (state: string, offsetMs: number, sentAt: string | null) =>
      sql`insert into platform.email_outbox (kind, recipient_user_id, state, sent_at, created_at)
          values ('user_invitation', ${waiting.id}, ${state}, ${sentAt}, ${new Date(current.clock.now().getTime() + offsetMs)})`.execute(
        current.database.admin,
      );
    await insert('sent', 0, '2026-10-01T08:00:00Z');
    await insert('failed', 1000, null);
    await insert('superseded', 2000, null); // newer, but it does not count
    expect((await latestEmailStatus(db(), [waiting.id], 'user_invitation')).get(waiting.id)).toEqual({ state: 'failed', sentAt: null });
  });
});

describe('the invitation in its edge cases (EVM-024 AC1, AC5, AC7)', () => {
  it('EVM-024 AC7 a repeat of an invitation whose account was deleted in the meantime is 404, not a representation of a deleted account', async () => {
    const admin = await browserOf(current);
    const body = inviteBody();
    const key = uuidv7();
    expect((await invite(admin, body, key)).status).toBe(201);
    await sql`update identity.users set deleted_at = ${current.clock.now()} where id = ${body.id}`.execute(current.database.admin);
    const replay = await invite(admin, body, key);
    expect(replay.status).toBe(404);
    expect(replay.body).toMatchObject({ code: 'not_found' });
  });

  it('EVM-024 AC5 a cursor that this server sealed for an account that is gone for good is 400 invalid_cursor', async () => {
    const admin = await browserOf(current);
    const codec = current.app.get<CursorCodec>(CURSOR_CODEC, { strict: false });
    const forged = codec.seal('listUsers', { position: [uuidv7()], scope: scopeOf([]), userId: admin.user.id });
    const response = await admin.panel.get(`${USERS}?cursor=${forged}`);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'invalid_cursor' });
    // the same position under the cursor of another operation never opens (the operation is part of what is sealed)
    const other = codec.seal('listCustomers', { position: [admin.user.id], scope: scopeOf([]), userId: admin.user.id });
    expect((await admin.panel.get(`${USERS}?cursor=${other}`)).status).toBe(400);
  });
});

describe('the worker with a sender chosen by the wiring (EVM-024 AC6)', () => {
  it('EVM-024 AC6 the wiring may hand the worker another sender (the tests do; the configuration never chooses a fake): the message goes to it, and the worker stops without closing what is not an SMTP transport', async () => {
    const memory = new InMemoryEmailSender();
    const admin = await browserOf(current);
    const body = inviteBody();
    expect((await invite(admin, body)).status).toBe(201);
    const smtp = await startSmtpTestServer(); // the configuration names it, the wiring replaces the transport
    const worker = startWorker(
      {
        DATABASE_URL: current.database.appUrl,
        EMAIL_TRANSPORT: 'smtp',
        EMAIL_SMTP_HOST: '127.0.0.1',
        EMAIL_SMTP_PORT: String(smtp.port),
        EMAIL_FROM: 'noreply@evia.localhost',
      },
      { createEmailSender: () => memory },
    );
    try {
      await until(() => (memory.sent.length > 0 ? memory.sent : undefined), 'the message goes to the sender of the wiring');
      expect(memory.sent[0]?.to).toBe('anna.testowa@example.com');
      expect(smtp.messages).toEqual([]);
    } finally {
      expect(await worker.stop()).toBe(0);
      await smtp.close();
    }
  });
});

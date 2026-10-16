import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isWorkerHealthy } from '../../src/worker/worker-health.ts';
import { PATHS } from '../support/flows.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import {
  USERS,
  auditActions,
  browserOf,
  everythingAsText,
  invite,
  inviteBody,
  linkIn,
  linksOf,
  outboxRows,
} from '../support/invitation-fixtures.ts';
import { startSmtpTestServer, type SmtpTestServer } from '../support/smtp-test-server.ts';
import { startWorker, until, type StartedWorker } from '../support/worker-harness.ts';
import { migratedDatabase } from './database.ts';

let app: IdentityApp;
let smtp: SmtpTestServer;
let worker: StartedWorker | undefined;

beforeEach(async () => {
  smtp = await startSmtpTestServer();
  const database = await migratedDatabase();
  app = await createIdentityApp({ database, now: new Date().toISOString() });
});
afterEach(async () => {
  await worker?.stop().catch(() => undefined);
  worker = undefined;
  await app.close();
  await smtp.close();
});

const env = (overrides: Record<string, string | undefined> = {}) => ({
  DATABASE_URL: app.database.appUrl,
  EMAIL_TRANSPORT: 'smtp',
  EMAIL_SMTP_HOST: '127.0.0.1',
  EMAIL_SMTP_PORT: String(smtp.port),
  EMAIL_FROM: 'noreply@evia.localhost',
  ...overrides,
});
const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();
const jobs = async () =>
  (
    await sql<{ id: string; state: string; data: unknown; output: unknown; retry_count: number }>`
      select id, state, data, output, retry_count from pgboss.job where name = 'email.send' order by created_on, id`.execute(
      app.database.admin,
    )
  ).rows;

describe('the worker sends the invitation through the outbox and the queue (EVM-024 AC1, AC3, AC5, AC6; ADR-0010)', () => {
  it('EVM-024 AC1 AC6 a message written BEFORE the worker started is sent when it starts (nothing is lost): the mail arrives at the SMTP server with the link in the fragment, the database holds the hash, and the job carries the id of the row only', async () => {
    const admin = await browserOf(app);
    const body = inviteBody({ email: 'anna.testowa@example.com' });
    expect((await invite(admin, body)).status).toBe(201);
    expect(await jobs()).toEqual([]); // the API does not run the queue: only the row is there

    worker = startWorker(env());
    const [message] = await until(() => (smtp.messages.length > 0 ? smtp.messages : undefined), 'the mail arrives');

    expect(message?.recipients).toEqual(['anna.testowa@example.com']);
    expect(message?.mailFrom).toBe('noreply@evia.localhost');
    expect(message?.subject).toBe('EVia Manager: zaproszenie do panelu');
    expect(message?.headers.get('content-type')).toMatch(/^text\/plain; charset=utf-8/i);
    const { token, path } = linkIn(message?.text ?? '');
    expect(path).toBe('/activate');

    const [link] = await linksOf(app, body.id);
    expect(link?.token_hash.equals(sha256(token))).toBe(true);
    expect(await everythingAsText(app)).not.toContain(token);
    const row = await until(async () => {
      const [found] = await outboxRows(app, { recipient: body.id });
      return found?.state === 'sent' ? found : undefined;
    }, 'the row is sent');
    expect(row).toMatchObject({ attempts: 1, kind: 'user_invitation' });
    expect(row.enqueued_at).not.toBeNull();

    // the job of the queue: the id of the row as its id and as its payload — and a result of numbers only
    const [job] = await until(async () => {
      const found = await jobs();
      return found[0]?.state === 'completed' ? found : undefined;
    }, 'the job completes');
    expect(job).toMatchObject({ id: row.id, data: { ids: [row.id] }, output: { sent: 1, failed: 0, retry: 0, superseded: 0, skipped: 0 } });
    expect(JSON.stringify(await sql`select * from pgboss.job`.execute(app.database.admin).then((result) => result.rows))).not.toMatch(
      /anna|example\.com|activate|zaproszono/i,
    );

    // the audit subscriber works in the process of the worker: the event of the link is in the trail (written in the transaction of the job)
    expect(await auditActions(app)).toContainEqual(
      expect.objectContaining({ action: 'activation_link.issued', actor_type: 'system', object_id: body.id }),
    );

    // the link works for the person: the check does not consume it
    for (let time = 0; time < 2; time += 1) {
      const check = await app.panel().post(PATHS.check, { token });
      expect(check.status).toBe(200);
      expect(check.body).toEqual({ email: 'anna.testowa@example.com', role: 'editor' });
    }

    // nothing of the message or the token in the log of the worker
    expect(worker.text()).not.toMatch(/anna|example\.com|activate#|zaproszono/);
    expect(worker.text()).not.toContain(token);
    expect(await isWorkerHealthy(worker.healthFile, new Date())).toBe(true);
  });

  it('EVM-024 AC5 an SMTP server that is down is retried with the job: five attempts, then the row is failed and the job completes WITHOUT an error; the invitation can be sent again, and nothing of the message is in the stored job, the log or the errors (W3)', async () => {
    const admin = await browserOf(app);
    const body = inviteBody({ email: 'tajny.adres@example.com' });
    expect((await invite(admin, body)).status).toBe(201);
    const closed = smtp.port;
    await smtp.close(); // the port is closed: a refused connection
    smtp = await startSmtpTestServer();
    worker = startWorker(env({ EMAIL_SMTP_PORT: String(closed) }));

    const failed = await until(async () => {
      const [row] = await outboxRows(app, { recipient: body.id });
      return row?.state === 'failed' ? row : undefined;
    }, 'the row fails after the retries');
    expect(failed).toMatchObject({ attempts: 5, sent_at: null });
    const [job] = await jobs();
    expect(job).toMatchObject({ state: 'completed', retry_count: 4 });
    expect(smtp.messages).toEqual([]);

    const list = await admin.panel.get(USERS);
    expect(
      (list.body as { items: Array<{ id: string; invitation: unknown }> }).items.find((item) => item.id === body.id)?.invitation,
    ).toEqual({
      state: 'failed',
      sentAt: null,
      expiresAt: null,
    });
    const stored = JSON.stringify(await sql`select * from pgboss.job`.execute(app.database.admin).then((result) => result.rows));
    const everything = `${stored}${worker.text()}${await everythingAsText(app).then((text) =>
      text
        .split(String.fromCharCode(10))
        .filter((line) => !line.startsWith('identity.users') && !line.startsWith('identity.one_time_links'))
        .join(String.fromCharCode(10)),
    )}`;
    expect(everything).not.toMatch(/tajny\.adres|zaproszono|activate#|ECONNREFUSED|127\.0\.0\.1/);
    const logged = worker.lines().find((line) => line['msg'] === 'email: not sent');
    expect(logged).toMatchObject({ outboxId: failed.id, kind: 'user_invitation', code: 'connection_failed' });

    // "Wyślij ponownie" with the service back: the new message goes out through the same worker
    const second = await startSmtpTestServer();
    await worker.stop();
    worker = startWorker(env({ EMAIL_SMTP_PORT: String(second.port) }));
    expect((await admin.panel.post(`${USERS}/${body.id}/invitations`)).status).toBe(200);
    await until(() => (second.messages.length > 0 ? second.messages : undefined), 'the resent mail arrives');
    expect(second.messages[0]?.recipients).toEqual(['tajny.adres@example.com']);
    await second.close();
  });

  it('EVM-024 AC5 a recipient that the server refuses (a permanent failure) is failed after ONE attempt — no retry — and the address is not in the log or the job', async () => {
    smtp.behaviour = 'refuse_recipient';
    const admin = await browserOf(app);
    const body = inviteBody({ email: 'odrzucony@example.com' });
    expect((await invite(admin, body)).status).toBe(201);
    worker = startWorker(env());
    const failed = await until(async () => {
      const [row] = await outboxRows(app, { recipient: body.id });
      return row?.state === 'failed' ? row : undefined;
    }, 'the row fails at once');
    expect(failed.attempts).toBe(1);
    expect((await jobs())[0]).toMatchObject({ state: 'completed', retry_count: 0 });
    expect(worker.lines().find((line) => line['msg'] === 'email: not sent')).toMatchObject({ code: 'recipient_rejected' });
    expect(worker.text() + JSON.stringify(await jobs())).not.toMatch(/odrzucony|no such recipient/);
  });

  it('EVM-024 AC6 with the transport none the worker registers neither the job nor the relay: the rows stay pending in the outbox, the queue holds no job of e-mail, the log says so and the health check is red', async () => {
    const admin = await browserOf(app);
    const body = inviteBody();
    expect((await invite(admin, body)).status).toBe(201);
    worker = startWorker(env({ EMAIL_TRANSPORT: 'none', EMAIL_SMTP_HOST: undefined, EMAIL_SMTP_PORT: undefined, EMAIL_FROM: undefined }));
    await until(() => worker?.lines().find((line) => line['msg'] === 'worker: ready'), 'the worker is ready');
    await new Promise((resolve) => setTimeout(resolve, 1500)); // many rounds of a relay that is not there

    expect(await jobs()).toEqual([]);
    expect((await outboxRows(app, { recipient: body.id }))[0]).toMatchObject({ state: 'pending', attempts: 0, enqueued_at: null });
    expect(smtp.messages).toEqual([]);
    expect(
      worker.lines().find((line) => line['msg'] === 'worker: the e-mail transport is none; e-mails are not sent and wait in the outbox'),
    ).toMatchObject({
      level: 'error',
      transport: 'none',
    });
    const { rows } = await sql<{ name: string }>`select name from pgboss.queue where name like 'email.%'`.execute(app.database.admin);
    expect(rows).toEqual([]);
    expect(await isWorkerHealthy(worker.healthFile, new Date())).toBe(false);
  });

  it('EVM-024 AC6 a worker without a transport in its configuration does not start (a ConfigError that names the key), and smtp in production is refused', async () => {
    await expect(Promise.resolve().then(() => startWorker(env({ EMAIL_TRANSPORT: undefined })).exit)).rejects.toMatchObject({
      keys: ['EMAIL_TRANSPORT'],
    });
    await expect(
      Promise.resolve().then(
        () =>
          startWorker(
            env({
              NODE_ENV: 'production',
              CURSOR_KEY: randomBytes(32).toString('base64url'), // generated per run, never committed
              PANEL_ORIGIN: 'https://panel.evia.pl',
              WEBAUTHN_RP_ID: 'panel.evia.pl',
            }),
          ).exit,
      ),
    ).rejects.toMatchObject({ keys: expect.arrayContaining(['EMAIL_TRANSPORT']) as unknown });
  });
});

describe('the health of the worker (EVM-024 AC6; SR-API-12)', () => {
  it('EVM-024 AC6 the health file holds the time and the kind of the transport and nothing else; it is stale after two minutes', async () => {
    worker = startWorker(env());
    await until(() => worker?.lines().find((line) => line['msg'] === 'worker: ready'), 'the worker is ready');
    const { readFileSync } = await import('node:fs');
    const content = JSON.parse(readFileSync(worker.healthFile, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(content).sort()).toEqual(['at', 'transport']);
    expect(content['transport']).toBe('smtp');
    expect(await isWorkerHealthy(worker.healthFile, new Date())).toBe(true);
    expect(await isWorkerHealthy(worker.healthFile, new Date(Date.now() + 3 * 60_000))).toBe(false);
  });
});

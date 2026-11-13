import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, type Kysely } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/platform/database/database.ts';
import { expireStalePending } from '../../src/platform/email/email-outbox.ts';
import { createTemEmailSenderForTest } from '../../src/platform/email/tem-email-sender.ts';
import { DATABASE } from '../../src/platform/tokens.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { browserOf, emailHarness, invite, inviteBody, linksOf, outboxRows } from '../support/invitation-fixtures.ts';
import { startWorker, until } from '../support/worker-harness.ts';

const KEY = '00000000-0000-4000-8000-000000000001';
const PROJECT = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const DAY_MS = 86_400_000;

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const db = () => current.app.get<Kysely<Database>>(DATABASE, { strict: false });

/** Moves the creation of the rows of a recipient to `ageMs` ago (the real clock of the worker is the reference). */
async function ageRows(recipient: string, ageMs: number): Promise<void> {
  const created = new Date(Date.now() - ageMs);
  await sql`update platform.email_outbox set created_at = ${created} where recipient_user_id = ${recipient}::uuid`.execute(
    current.database.admin,
  );
}

describe('the expiry of stale pending e-mails (EVM-089 D; TM-80)', () => {
  it('EVM-089 AC4 D pending rows older than the limit become failed, newer ones and the final ones stay; only the number is returned', async () => {
    const admin = await browserOf(current);
    const old = inviteBody({ email: 'stara@biuro-firma.pl' });
    const fresh = inviteBody({ email: 'swieza@biuro-firma.pl' });
    expect((await invite(admin, old)).status).toBe(201);
    expect((await invite(admin, fresh)).status).toBe(201);
    await ageRows(old.id, 3 * DAY_MS);
    await ageRows(fresh.id, 2 * 3_600_000);

    const expired = await expireStalePending(db(), new Date(Date.now() - DAY_MS));

    // the rows of the administrators who invited are pending too (alerts of the identity module) — only the old invitation is counted here
    expect(expired).toBeGreaterThanOrEqual(1);
    expect((await outboxRows(current, { recipient: old.id }))[0]).toMatchObject({ state: 'failed' });
    expect((await outboxRows(current, { recipient: fresh.id }))[0]).toMatchObject({ state: 'pending' });
    expect(await expireStalePending(db(), new Date(Date.now() - DAY_MS))).toBe(0);
  });

  it('EVM-089 AC4 D a job already in the queue for an expired row sends no mail and makes no token', async () => {
    const admin = await browserOf(current);
    const old = inviteBody({ email: 'stara@biuro-firma.pl' });
    expect((await invite(admin, old)).status).toBe(201);
    await ageRows(old.id, 3 * DAY_MS);
    await expireStalePending(db(), new Date(Date.now() - DAY_MS));
    const { job, sender } = emailHarness(current);
    const [row] = await outboxRows(current, { recipient: old.id, kind: 'user_invitation' });

    expect(await job.run({ ids: [row?.id ?? ''] })).toMatchObject({ skipped: 1, sent: 0 });

    expect(sender.sent).toEqual([]);
    expect(await linksOf(current, old.id)).toEqual([]);
  });
});

describe('the worker with the transport tem (EVM-089 AC1, AC2, AC4)', () => {
  it('EVM-089 AC2 AC4 D the worker expires the stale rows first, sends a fresh message through TEM in the mode otwarty and intercepts an address on example.com — no request, no address in the log', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'evm-089-'));
    const file = (name: string, content: string): string => {
      const path = join(directory, name);
      writeFileSync(path, content);
      return path;
    };
    const admin = await browserOf(current);
    const stale = inviteBody({ email: 'stara@biuro-firma.pl' });
    const real = inviteBody({ email: 'nowa@biuro-firma.pl' });
    const synthetic = inviteBody({ email: 'anna.testowa@example.com' });
    for (const body of [stale, real, synthetic]) expect((await invite(admin, body)).status).toBe(201);
    await ageRows(stale.id, 3 * DAY_MS);
    await ageRows(real.id, 1000);
    await ageRows(synthetic.id, 1000);

    const requests: { to: string }[] = [];
    const worker = startWorker(
      {
        DATABASE_URL: current.database.appUrl,
        EMAIL_TRANSPORT: 'tem',
        EMAIL_FROM: 'powiadomienia@panel.eviacharge.pl',
        EMAIL_TEM_API_KEY_FILE: file('tem-api-key', `${KEY}\n`),
        EMAIL_TEM_PROJECT_ID_FILE: file('tem-project-id', PROJECT),
        EMAIL_RECIPIENT_MODE_FILE: file('email-recipient-mode', 'otwarty\n'),
        EMAIL_ALLOWED_RECIPIENTS_FILE: file('email-allowed-recipients', ''),
      },
      {
        createEmailSender: (config) =>
          createTemEmailSenderForTest(
            { from: config.from, apiKey: KEY, projectId: PROJECT, policy: { mode: 'otwarty', allowed: new Set() } },
            (_url, init) => {
              const body = JSON.parse(init.body as string) as { to: { email: string }[] };
              requests.push({ to: body.to[0]?.email ?? '' });
              return Promise.resolve(new Response('{}', { status: 200 }));
            },
          ),
      },
    );
    try {
      await until(async () => {
        const rows = [await outboxRows(current, { recipient: real.id }), await outboxRows(current, { recipient: synthetic.id })];
        return rows.every((list) => list.some((row) => row.kind === 'user_invitation' && row.state === 'sent')) ? true : undefined;
      }, 'both fresh invitations are final');
      expect(requests).toEqual([{ to: 'nowa@biuro-firma.pl' }]); // example.com never reached the provider
      expect((await outboxRows(current, { recipient: stale.id }))[0]).toMatchObject({ state: 'failed', attempts: 0 });
      expect(await linksOf(current, stale.id)).toEqual([]); // the stale invitation got no token
      expect((await linksOf(current, real.id)).length).toBe(1);
      expect(await linksOf(current, synthetic.id)).toHaveLength(1); // the link exists (the row is `sent`), but no message left
      const lines = worker.lines();
      expect(lines.some((line) => line['msg'] === 'email: intercepted' && line['reason'] === 'reserved_domain')).toBe(true);
      expect(lines.some((line) => line['msg'] === 'worker: stale pending e-mails expired')).toBe(true);
      expect(worker.text()).not.toMatch(/biuro-firma|example\.com|3f1c2b0a/);
    } finally {
      expect(await worker.stop()).toBe(0);
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

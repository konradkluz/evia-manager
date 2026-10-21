import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PURGE_LOGIN_SECURITY_FAILED, PurgeLoginSecurityJob } from '../../src/modules/identity/application/purge-login-security.job.ts';
import { JobFailure } from '../../src/platform/jobs/index.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createUser } from '../support/identity-fixtures.ts';
import { emailHarness, outboxRows } from '../support/invitation-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

type Kind = 'account_locked' | 'new_browser';

async function queue(kind: Kind, variant: string | null, recipient: string): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    insert into platform.email_outbox (kind, variant, recipient_user_id, created_at)
    values (${kind}, ${variant}, ${recipient}, ${current.clock.now()}) returning id`.execute(current.database.admin);
  return rows[0]?.id ?? '';
}

describe('the worker and the messages about the security of the sign-in (EVM-026 AC4, AC5; SR-AUTH-15)', () => {
  it('EVM-026 AC4 a message for an account that is missing, deleted, deactivated or not yet active is obsolete: nothing is sent', async () => {
    const db = current.database.admin;
    const deleted = await createUser(db, current.clock, { role: 'editor', status: 'active', email: 'usuniety@example.com' });
    await sql`update identity.users set deleted_at = ${current.clock.now()} where id = ${deleted.id}`.execute(db);
    const off = await createUser(db, current.clock, { role: 'editor', status: 'deactivated', email: 'wylaczony@example.com' });
    const invited = await createUser(db, current.clock, { role: 'editor', status: 'invited', email: 'zaproszony@example.com' });
    const harness = emailHarness(current);
    for (const [kind, variant] of [
      ['account_locked', 'password'],
      ['new_browser', null],
    ] as const)
      for (const recipient of [uuidv7(), deleted.id, off.id, invited.id]) {
        const id = await queue(kind, variant, recipient);
        await harness.job.run({ ids: [id] });
        expect((await outboxRows(current)).find((row) => row.id === id)?.state, `${kind} ${recipient}`).toBe('superseded');
      }
    expect(harness.sender.sent).toEqual([]);
  });

  it('EVM-026 AC4 a lock with a variant that is not a cause is a permanent failure: nothing is sent, nothing is guessed', async () => {
    const account = await createUser(current.database.admin, current.clock, {
      role: 'editor',
      status: 'active',
      email: 'ewa.aktywna@example.com',
    });
    const harness = emailHarness(current);
    const ids = [await queue('account_locked', null, account.id), await queue('account_locked', 'both', account.id)];
    await harness.job.run({ ids });
    expect((await outboxRows(current, { recipient: account.id })).map((row) => row.state)).toEqual(['failed', 'failed']);
    expect(harness.sender.sent).toEqual([]);
  });

  it('EVM-026 AC4 an account whose address is not an address gets a permanent refusal: the row is failed and nothing is sent', async () => {
    const account = await createUser(current.database.admin, current.clock, {
      role: 'editor',
      status: 'active',
      email: 'ewa.aktywna@example.com',
    });
    await sql`update identity.users set email = 'not an address' where id = ${account.id}`.execute(current.database.admin);
    const harness = emailHarness(current);
    const ids = [await queue('account_locked', 'password', account.id), await queue('new_browser', null, account.id)];
    await harness.job.run({ ids });
    expect((await outboxRows(current, { recipient: account.id })).map((row) => row.state)).toEqual(['failed', 'failed']);
    expect(harness.sender.sent).toEqual([]);
  });

  it('EVM-026 AC5 the recipient is the address of the account row: the message of a new browser goes to that address alone', async () => {
    const account = await createUser(current.database.admin, current.clock, {
      role: 'editor',
      status: 'active',
      email: 'ewa.aktywna@example.com',
    });
    const harness = emailHarness(current);
    await harness.job.run({ ids: [await queue('new_browser', null, account.id)] });
    expect(harness.sender.sent).toHaveLength(1);
    expect(harness.sender.sent[0]?.to).toBe('ewa.aktywna@example.com');
  });
});

describe('the job of retention fails closed (EVM-026 M6)', () => {
  it('EVM-026 M6 a failing purge leaves as a JobFailure with a fixed code — nothing of the database error reaches the queue or the log', async () => {
    await sql`revoke delete on identity.login_throttle from evia_app`.execute(current.database.admin);
    const job = current.app.get(PurgeLoginSecurityJob, { strict: false });
    const failure = await job.run().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(JobFailure);
    expect((failure as JobFailure).code).toBe(PURGE_LOGIN_SECURITY_FAILED);
    expect((failure as JobFailure).message).toBe(PURGE_LOGIN_SECURITY_FAILED);
    expect(current.logs.text).toContain('login security purge: failed');
    expect(current.logs.text).not.toMatch(/login_throttle|permission denied/i);
  });
});

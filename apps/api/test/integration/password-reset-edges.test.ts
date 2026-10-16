import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUser } from '../support/identity-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { auditActions, emailHarness, outboxRows } from '../support/invitation-fixtures.ts';
import { enrolledAccount } from '../support/login-flows.ts';
import { deliverReset, NEW_PASSWORD, RESET } from '../support/password-reset-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

type Kind = 'password_reset' | 'password_changed';
const KINDS: readonly Kind[] = ['password_reset', 'password_changed'];

async function queue(kind: Kind, recipient: string): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    insert into platform.email_outbox (kind, recipient_user_id, created_at) values (${kind}, ${recipient}, ${current.clock.now()}) returning id`.execute(
    current.database.admin,
  );
  return rows[0]?.id ?? '';
}

describe('the worker and the password messages (EVM-025 AC1, AC5; SR-AUTH-12 by analogy)', () => {
  it('EVM-025 AC1 a message for an account that is missing, deleted or deactivated is obsolete: nothing is sent and no token is made', async () => {
    const db = current.database.admin;
    const deleted = await createUser(db, current.clock, { role: 'editor', status: 'active', email: 'usuniety@example.com' });
    await sql`update identity.users set deleted_at = ${current.clock.now()} where id = ${deleted.id}`.execute(db);
    const off = await createUser(db, current.clock, { role: 'editor', status: 'deactivated', email: 'wylaczony@example.com' });
    const harness = emailHarness(current);
    for (const kind of KINDS) {
      for (const recipient of [uuidv7(), deleted.id, off.id]) {
        const id = await queue(kind, recipient);
        await harness.job.run({ ids: [id] });
        expect((await outboxRows(current)).find((row) => row.id === id)?.state, `${kind} ${recipient}`).toBe('superseded');
      }
    }
    expect(harness.sender.sent).toEqual([]);
    const { rows } = await sql`select 1 from identity.one_time_links where purpose = 'password_reset'`.execute(db);
    expect(rows).toEqual([]);
  });

  it('EVM-025 AC1 an account whose address is not an address gets a permanent refusal before any token exists: the row is failed and nothing is sent', async () => {
    const account = await enrolledAccount(current, { role: 'editor', email: 'ewa.aktywna@example.com' });
    await sql`update identity.users set email = 'not an address' where id = ${account.user.id}`.execute(current.database.admin);
    const harness = emailHarness(current);
    const ids = [await queue('password_reset', account.user.id), await queue('password_changed', account.user.id)];
    await harness.job.run({ ids });
    const rows = await outboxRows(current, { recipient: account.user.id });
    expect(rows.map((row) => row.state)).toEqual(['failed', 'failed']);
    expect(harness.sender.sent).toEqual([]);
    const { rows: links } = await sql`select 1 from identity.one_time_links where purpose = 'password_reset'`.execute(
      current.database.admin,
    );
    expect(links).toEqual([]);
  });
});

describe('two completions at once (EVM-025 AC2; SR-AUTH-11)', () => {
  it('EVM-025 AC2 the same link used twice at the same moment works once: one new password, one notice, one event of the reset, one refusal', async () => {
    const account = await enrolledAccount(current, { role: 'editor', email: 'ewa.aktywna@example.com' });
    const { token } = await deliverReset(current, account);
    const [first, second] = await Promise.all([
      current.panel().post(RESET.complete, { token, password: NEW_PASSWORD }),
      current.panel().post(RESET.complete, { token, password: `${NEW_PASSWORD} again` }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 400]);
    const refused = first.status === 400 ? first : second;
    expect(refused.body).toMatchObject({ code: 'password_reset_link_invalid' });
    expect(await outboxRows(current, { recipient: account.user.id, kind: 'password_changed' })).toHaveLength(1);
    expect((await auditActions(current)).filter((event) => event.action === 'password.reset')).toHaveLength(1);
  });
});

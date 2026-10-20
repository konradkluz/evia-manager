import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

type Kind = 'mfa_changed' | 'recovery_code_used';

async function queue(kind: Kind, variant: string | null, recipient: string): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    insert into platform.email_outbox (kind, variant, recipient_user_id, created_at)
    values (${kind}, ${variant}, ${recipient}, ${current.clock.now()}) returning id`.execute(current.database.admin);
  return rows[0]?.id ?? '';
}

describe('the worker and the messages about the second step (EVM-023 AC5, AC6; SR-AUTH-10, SR-AUTH-15)', () => {
  it('EVM-023 AC6 a message for an account that is missing, deleted, deactivated or not yet active is obsolete: nothing is sent', async () => {
    const db = current.database.admin;
    const deleted = await createUser(db, current.clock, { role: 'editor', status: 'active', email: 'usuniety@example.com' });
    await sql`update identity.users set deleted_at = ${current.clock.now()} where id = ${deleted.id}`.execute(db);
    const off = await createUser(db, current.clock, { role: 'editor', status: 'deactivated', email: 'wylaczony@example.com' });
    const invited = await createUser(db, current.clock, { role: 'editor', status: 'invited', email: 'zaproszony@example.com' });
    const harness = emailHarness(current);
    for (const [kind, variant] of [
      ['mfa_changed', 'totp_enrolled'],
      ['recovery_code_used', null],
    ] as const)
      for (const recipient of [uuidv7(), deleted.id, off.id, invited.id]) {
        const id = await queue(kind, variant, recipient);
        await harness.job.run({ ids: [id] });
        expect((await outboxRows(current)).find((row) => row.id === id)?.state, `${kind} ${recipient}`).toBe('superseded');
      }
    expect(harness.sender.sent).toEqual([]);
  });

  it('EVM-023 AC6 a message with a variant that is not a known change is a permanent failure: nothing is sent, nothing is guessed', async () => {
    const account = await createUser(current.database.admin, current.clock, {
      role: 'editor',
      status: 'active',
      email: 'ewa.aktywna@example.com',
    });
    const harness = emailHarness(current);
    const ids = [await queue('mfa_changed', null, account.id), await queue('mfa_changed', 'passkey_removed', account.id)];
    await harness.job.run({ ids });
    expect((await outboxRows(current, { recipient: account.id })).map((row) => row.state)).toEqual(['failed', 'failed']);
    expect(harness.sender.sent).toEqual([]);
  });

  it('EVM-023 AC6 an account whose address is not an address gets a permanent refusal: the row is failed and nothing is sent', async () => {
    const account = await createUser(current.database.admin, current.clock, {
      role: 'editor',
      status: 'active',
      email: 'ewa.aktywna@example.com',
    });
    await sql`update identity.users set email = 'not an address' where id = ${account.id}`.execute(current.database.admin);
    const harness = emailHarness(current);
    const ids = [await queue('mfa_changed', 'totp_enrolled', account.id), await queue('recovery_code_used', null, account.id)];
    await harness.job.run({ ids });
    expect((await outboxRows(current, { recipient: account.id })).map((row) => row.state)).toEqual(['failed', 'failed']);
    expect(harness.sender.sent).toEqual([]);
  });

  it('EVM-023 AC6 the recipient is the address of the account row, whatever else a request said: the message goes to that address alone', async () => {
    const account = await createUser(current.database.admin, current.clock, {
      role: 'editor',
      status: 'active',
      email: 'ewa.aktywna@example.com',
    });
    const harness = emailHarness(current);
    await harness.job.run({ ids: [await queue('mfa_changed', 'recovery_codes_generated', account.id)] });
    expect(harness.sender.sent).toHaveLength(1);
    expect(harness.sender.sent[0]?.to).toBe('ewa.aktywna@example.com');
  });
});

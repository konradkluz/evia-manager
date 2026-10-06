import { randomBytes } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../src/platform/database/database.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
let db: Kysely<Database>;
beforeAll(async () => {
  database = await migratedDatabase();
  db = database.admin;
});
afterAll(async () => {
  await database.close();
});

const T0 = '2026-10-05T08:00:00Z';
const T1 = '2026-10-05T08:05:00Z';

async function user(): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    insert into identity.users (email, display_name, role, status, webauthn_user_handle, created_at, updated_at)
    values (${`u${randomBytes(4).toString('hex')}@evia.invalid`}, 'Synthetic', 'editor', 'active', ${randomBytes(32)}, ${T0}, ${T0})
    returning id`.execute(db);
  return rows[0]?.id ?? '';
}

async function attempt(userId: string): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    insert into identity.login_attempts (user_id, token_hash, created_at, expires_at)
    values (${userId}, ${randomBytes(32)}, ${T0}, ${T1}) returning id`.execute(db);
  return rows[0]?.id ?? '';
}

async function session(userId: string): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    insert into identity.sessions (user_id, channel, state, token_hash, created_at, last_seen_at, last_authenticated_at, idle_expires_at, absolute_expires_at)
    values (${userId}, 'web', 'active', ${randomBytes(32)}, ${T0}, ${T0}, ${T0}, ${T1}, ${T1}) returning id`.execute(db);
  return rows[0]?.id ?? '';
}

const challenge = (values: { userId: string; sessionId: string | null; attemptId: string | null; purpose: string }) =>
  sql`insert into identity.webauthn_challenges (user_id, session_id, login_attempt_id, purpose, challenge_hash, created_at, expires_at)
      values (${values.userId}, ${values.sessionId}, ${values.attemptId}, ${values.purpose}, ${randomBytes(32)}, ${T0}, ${T1})`.execute(db);

describe('migration 0006 — login attempts and expiry (EVM-067 AC1, AC4, AC5; RODO art. 5(1)(c))', () => {
  it('EVM-067 AC4 login_attempts holds a hash of the token and times — no address, no user agent, no e-mail (data minimisation)', async () => {
    const { rows } = await sql<{ column_name: string }>`
      select column_name from information_schema.columns where table_schema = 'identity' and table_name = 'login_attempts' order by ordinal_position`.execute(
      db,
    );
    expect(rows.map((row) => row.column_name)).toEqual([
      'id',
      'user_id',
      'token_hash',
      'created_at',
      'expires_at',
      'used_at',
      'failed_attempts',
    ]);
  });

  it('EVM-067 AC4 the token hash is 32 bytes and unique, the lifetime is positive and the failure counter is not negative', async () => {
    const owner = await user();
    const hash = randomBytes(32);
    const insert = (values: { hash: Buffer; expiresAt: string; failed?: number }) =>
      sql`insert into identity.login_attempts (user_id, token_hash, created_at, expires_at, failed_attempts)
          values (${owner}, ${values.hash}, ${T0}, ${values.expiresAt}, ${values.failed ?? 0})`.execute(db);
    await insert({ hash, expiresAt: T1 });
    await expect(insert({ hash, expiresAt: T1 })).rejects.toMatchObject({ code: '23505' });
    await expect(insert({ hash: randomBytes(16), expiresAt: T1 })).rejects.toMatchObject({ code: '23514' });
    await expect(insert({ hash: randomBytes(32), expiresAt: T0 })).rejects.toMatchObject({ code: '23514' });
    await expect(insert({ hash: randomBytes(32), expiresAt: T1, failed: -1 })).rejects.toMatchObject({ code: '23514' });
  });

  it('EVM-067 AC4 a challenge belongs to exactly one of a session (enrolment) and a login attempt (sign-in), with the matching purpose', async () => {
    const owner = await user();
    const attemptId = await attempt(owner);
    const sessionId = await session(owner);
    await challenge({ userId: owner, sessionId, attemptId: null, purpose: 'passkey_registration' });
    await challenge({ userId: owner, sessionId: null, attemptId, purpose: 'passkey_authentication' });
    for (const bad of [
      { sessionId, attemptId, purpose: 'passkey_registration' },
      { sessionId, attemptId, purpose: 'passkey_authentication' },
      { sessionId: null, attemptId: null, purpose: 'passkey_registration' },
      { sessionId, attemptId: null, purpose: 'passkey_authentication' },
      { sessionId: null, attemptId, purpose: 'passkey_registration' },
      { sessionId: null, attemptId, purpose: 'password_reset' },
    ]) {
      await expect(challenge({ userId: owner, ...bad }), JSON.stringify(bad)).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('EVM-067 AC4 deleting an attempt deletes its challenges (the retention clean-up leaves nothing behind)', async () => {
    const owner = await user();
    const attemptId = await attempt(owner);
    await challenge({ userId: owner, sessionId: null, attemptId, purpose: 'passkey_authentication' });
    await sql`delete from identity.login_attempts where id = ${attemptId}`.execute(db);
    const { rows } = await sql<{
      n: string;
    }>`select count(*)::text as n from identity.webauthn_challenges where login_attempt_id = ${attemptId}`.execute(db);
    expect(rows[0]?.n).toBe('0');
  });

  it('EVM-067 AC5 a session may be revoked as expired, and the old reasons still hold; an unknown reason and a half-revoked row do not', async () => {
    const owner = await user();
    const revoke = (reason: string | null, at: string | null) => async (id: string) =>
      sql`update identity.sessions set revoked_at = ${at}, revoke_reason = ${reason} where id = ${id}`.execute(db);
    for (const reason of ['expired', 'logout', 'rotated', 'emergency_reset', 'link_superseded']) {
      await revoke(reason, T1)(await session(owner));
    }
    await expect(revoke('idle', T1)(await session(owner))).rejects.toMatchObject({ code: '23514' });
    await expect(revoke('expired', null)(await session(owner))).rejects.toMatchObject({ code: '23514' });
  });

  it('EVM-067 AC4 the application role has the DML of the new table and nothing more (no TRUNCATE, no DDL)', async () => {
    const check = async (privilege: string) =>
      (
        await sql<{
          allowed: boolean;
        }>`select has_table_privilege('evia_it_app', 'identity.login_attempts', ${privilege}) as allowed`.execute(db)
      ).rows[0]?.allowed;
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) expect(await check(privilege), privilege).toBe(true);
    for (const privilege of ['TRUNCATE', 'REFERENCES', 'TRIGGER']) expect(await check(privilege), privilege).toBe(false);
  });
});

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
    values (${`u${randomBytes(4).toString('hex')}@evia.invalid`}, 'Synthetic', 'administrator', 'active', ${randomBytes(32)}, ${T0}, ${T0})
    returning id`.execute(db);
  return rows[0]?.id ?? '';
}

async function attempt(userId: string): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    insert into identity.login_attempts (user_id, token_hash, created_at, expires_at)
    values (${userId}, ${randomBytes(32)}, ${T0}, ${T1}) returning id`.execute(db);
  return rows[0]?.id ?? '';
}

/** The way the code of EVM-067 inserts a session: without the new column. */
async function legacySession(userId: string): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    insert into identity.sessions (user_id, channel, state, token_hash, created_at, last_seen_at, last_authenticated_at, idle_expires_at, absolute_expires_at)
    values (${userId}, 'web', 'active', ${randomBytes(32)}, ${T0}, ${T0}, ${T0}, ${T1}, ${T1}) returning id`.execute(db);
  return rows[0]?.id ?? '';
}

const challenge = (values: { userId: string; sessionId: string | null; attemptId: string | null; purpose: string }) =>
  sql`insert into identity.webauthn_challenges (user_id, session_id, login_attempt_id, purpose, challenge_hash, created_at, expires_at)
      values (${values.userId}, ${values.sessionId}, ${values.attemptId}, ${values.purpose}, ${randomBytes(32)}, ${T0}, ${T1})`.execute(db);

describe('migration 0009 — step-up (EVM-029 AC1, AC2, AC3; SR-SESS-08; backward compatible, expand only)', () => {
  it('EVM-029 AC2 a session inserted the old way has no passkey authentication (null: step-up required — fail closed), also an existing one', async () => {
    const owner = await user();
    const id = await legacySession(owner);
    const { rows } = await sql<{ passkey_authenticated_at: Date | null }>`
      select passkey_authenticated_at from identity.sessions where id = ${id}`.execute(db);
    expect(rows[0]?.passkey_authenticated_at).toBeNull();
    const column = await sql<{ is_nullable: string; data_type: string }>`
      select is_nullable, data_type from information_schema.columns
      where table_schema = 'identity' and table_name = 'sessions' and column_name = 'passkey_authenticated_at'`.execute(db);
    expect(column.rows).toEqual([{ is_nullable: 'YES', data_type: 'timestamp with time zone' }]);
  });

  it('EVM-029 AC3 a step-up challenge belongs to a session only; it can be neither a sign-in challenge nor tied to both owners', async () => {
    const owner = await user();
    const attemptId = await attempt(owner);
    const sessionId = await legacySession(owner);
    await challenge({ userId: owner, sessionId, attemptId: null, purpose: 'passkey_step_up' });
    // the two earlier purposes still hold
    await challenge({ userId: owner, sessionId, attemptId: null, purpose: 'passkey_registration' });
    await challenge({ userId: owner, sessionId: null, attemptId, purpose: 'passkey_authentication' });
    for (const bad of [
      { sessionId: null, attemptId, purpose: 'passkey_step_up' },
      { sessionId, attemptId, purpose: 'passkey_step_up' },
      { sessionId: null, attemptId: null, purpose: 'passkey_step_up' },
      { sessionId, attemptId: null, purpose: 'passkey_authentication' },
      { sessionId, attemptId: null, purpose: 'step_up' },
    ]) {
      await expect(challenge({ userId: owner, ...bad }), JSON.stringify(bad)).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('EVM-029 AC6 the indexes of the audit view exist and the append-only protection of 0003 is untouched (grants and triggers)', async () => {
    const indexes = await sql<{ indexname: string }>`
      select indexname from pg_indexes where schemaname = 'audit' and tablename = 'events' order by indexname`.execute(db);
    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining(['events_action_occurred_at_idx', 'events_actor_user_id_occurred_at_idx', 'events_occurred_at_id_idx']),
    );
    const check = async (privilege: string) =>
      (await sql<{ allowed: boolean }>`select has_table_privilege('evia_it_app', 'audit.events', ${privilege}) as allowed`.execute(db))
        .rows[0]?.allowed;
    for (const privilege of ['SELECT', 'INSERT']) expect(await check(privilege), privilege).toBe(true);
    for (const privilege of ['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'])
      expect(await check(privilege), privilege).toBe(false);
    const triggers = await sql<{ tgname: string }>`
      select tgname from pg_trigger where tgrelid = 'audit.events'::regclass and not tgisinternal order by tgname`.execute(db);
    expect(triggers.rows.map((row) => row.tgname)).toEqual(['events_reject_row_change', 'events_reject_truncate']);
  });

  it('EVM-029 AC6 even the owner cannot change or delete an audit event (EV001): the trail stays append-only', async () => {
    await sql`insert into audit.events (occurred_at, actor_type, origin, action, outcome, object_type, trace_id)
              values (${T0}, 'system', 'cli', 'audit.read', 'success', 'audit', ${'a'.repeat(32)})`.execute(db);
    await expect(sql`update audit.events set outcome = 'failed'`.execute(db)).rejects.toMatchObject({ code: 'EV001' });
    await expect(sql`delete from audit.events`.execute(db)).rejects.toMatchObject({ code: 'EV001' });
    await expect(sql`truncate audit.events`.execute(db)).rejects.toMatchObject({ code: 'EV001' });
  });
});

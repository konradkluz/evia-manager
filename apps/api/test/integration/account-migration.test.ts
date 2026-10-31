import { randomBytes } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/migrations/index.ts';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { migrateToLatest } from '../../src/platform/database/migrator.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { FixedClock } from '../support/clock.ts';
import { createUser, type UserFixture } from '../support/identity-fixtures.ts';
import { freshDatabaseUrl } from './database.ts';

/**
 * 0041 is applied on a database that already holds accounts, keys and sessions (EVM-028; expand only): the old rows are untouched and valid, the code that
 * is still running (it knows none of the new columns) still writes, and the new vocabularies and checks hold.
 */
const BEFORE = Object.fromEntries(Object.entries(MIGRATIONS).filter(([name]) => name < '0041')) as typeof MIGRATIONS;
const clock = new FixedClock('2026-10-20T08:00:00.000Z');

let db: Kysely<Database>;
let owner: UserFixture;
let oldSession = '';

beforeAll(async () => {
  db = createDatabase({ url: await freshDatabaseUrl(), logger: createLogger({ level: 'fatal' }), pool: { max: 2 } });
  await migrateToLatest(db, BEFORE);
  owner = await createUser(db, clock, { role: 'administrator' });
  await sql`insert into identity.passkeys (user_id, credential_id, public_key, counter, transports, device_type, backed_up, created_at)
            values (${owner.id}, ${randomBytes(16).toString('base64url')}, ${randomBytes(32)}, 0, '{}', 'multi_device', true, '2026-09-01T08:00:00Z')`.execute(
    db,
  );
  oldSession = (await session()).id;
  expect((await migrateToLatest(db, MIGRATIONS)).applied).toEqual([
    '0041_account',
    '0042_timeline_redaction',
    '0043_customer_anonymization',
    '0044_customer_deleted_index',
    '0045_media',
    '0046_media_quarantine',
    '0047_email_outbox_subject',
    '0048_media_alerts',
    '0050_mobile_devices',
    '0051_mobile_tokens',
    '0052_mobile_vocabularies',
    '0053_media_derivatives',
    '0057_media_video',
  ]);
});
afterAll(async () => {
  await db.destroy();
});

async function session(): Promise<{ id: string }> {
  const { rows } = await sql<{ id: string }>`
    insert into identity.sessions (user_id, channel, state, token_hash, created_at, last_seen_at, last_authenticated_at, idle_expires_at, absolute_expires_at)
    values (${owner.id}, 'web', 'active', ${randomBytes(32)}, '2026-10-20T08:00:00Z', '2026-10-20T08:00:00Z', '2026-10-20T08:00:00Z', '2026-10-20T09:00:00Z', '2026-10-20T20:00:00Z')
    returning id`.execute(db);
  return { id: rows[0]?.id ?? '' };
}

describe('migration 0041 — the account of the user (EVM-028; expand only)', () => {
  it('EVM-028 0041 the keys and sessions made before keep their data: no name on a key, no mark on a session', async () => {
    const key = await sql<{ name: string | null }>`select name from identity.passkeys where user_id = ${owner.id}`.execute(db);
    expect(key.rows).toEqual([{ name: null }]);
    const row = await sql<{ reauthenticated_at: Date | null; reauth_purpose: string | null }>`
      select reauthenticated_at, reauth_purpose from identity.sessions where id = ${oldSession}`.execute(db);
    expect(row.rows).toEqual([{ reauthenticated_at: null, reauth_purpose: null }]);
  });

  it('EVM-028 0041 the code that is still running writes without the new columns (a key without a name, a session without a mark)', async () => {
    await session();
    await sql`insert into identity.passkeys (user_id, credential_id, public_key, counter, transports, device_type, backed_up, created_at)
              values (${owner.id}, ${randomBytes(16).toString('base64url')}, ${randomBytes(32)}, 0, '{}', 'single_device', false, '2026-10-20T08:00:00Z')`.execute(
      db,
    );
  });

  it('EVM-028 0041 the name of a key is 1–60 characters or null', async () => {
    const insert = (name: string) =>
      sql`insert into identity.passkeys (user_id, credential_id, public_key, counter, transports, device_type, backed_up, created_at, name)
          values (${owner.id}, ${randomBytes(16).toString('base64url')}, ${randomBytes(32)}, 0, '{}', 'multi_device', true, '2026-10-20T08:00:00Z', ${name})`.execute(
        db,
      );
    await insert('k');
    await insert('k'.repeat(60));
    await expect(insert('')).rejects.toMatchObject({ code: '23514' });
    await expect(insert('k'.repeat(61))).rejects.toMatchObject({ code: '23514' });
  });

  it('EVM-028 0041 the mark is a pair: both columns or neither, and the purpose is one of the two', async () => {
    const mark = async (purpose: string | null, at: string | null) =>
      sql`update identity.sessions set reauth_purpose = ${purpose}, reauthenticated_at = ${at} where id = ${oldSession}`.execute(db);
    await mark('second_step_change', '2026-10-20T08:01:00Z');
    await mark('password_change', '2026-10-20T08:02:00Z');
    await expect(mark('second_step_change', null)).rejects.toMatchObject({ code: '23514' });
    await expect(mark(null, '2026-10-20T08:02:00Z')).rejects.toMatchObject({ code: '23514' });
    await expect(mark('anything', '2026-10-20T08:02:00Z')).rejects.toMatchObject({ code: '23514' });
    await mark(null, null);
  });

  it('EVM-028 0041 the vocabularies grew: a session may end by session_limit and ended_by_user, and e-mail 8 may be queued; an unknown value is still refused', async () => {
    for (const reason of ['session_limit', 'ended_by_user', 'logout', 'second_step_reset']) {
      const { id } = await session();
      await sql`update identity.sessions set revoked_at = '2026-10-20T08:30:00Z', revoke_reason = ${reason} where id = ${id}`.execute(db);
    }
    const { id } = await session();
    await expect(
      sql`update identity.sessions set revoked_at = now(), revoke_reason = 'made_up' where id = ${id}`.execute(db),
    ).rejects.toMatchObject({ code: '23514' });
    for (const kind of ['session_limit', 'account_locked', 'new_browser']) {
      await sql`insert into platform.email_outbox (kind, variant, recipient_user_id, created_at) values (${kind}, null, ${owner.id}, '2026-10-20T08:00:00Z')`.execute(
        db,
      );
    }
    await expect(
      sql`insert into platform.email_outbox (kind, variant, recipient_user_id, created_at) values ('made_up', null, ${owner.id}, '2026-10-20T08:00:00Z')`.execute(
        db,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('EVM-028 0041 the indexes of the limit and of the retention exist and the retention query can use them', async () => {
    const { rows } = await sql<{ indexname: string }>`
      select indexname from pg_indexes where schemaname = 'identity' and tablename = 'sessions' and indexname in ('sessions_user_id_created_at_idx', 'sessions_ended_at_idx')
      order by indexname`.execute(db);
    expect(rows.map((row) => row.indexname)).toEqual(['sessions_ended_at_idx', 'sessions_user_id_created_at_idx']);
  });
});

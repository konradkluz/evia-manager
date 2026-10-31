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
 * 0050–0052 are applied on a database that already holds accounts, sessions and first steps of the panel (EVM-094; expand only): the old rows are untouched and
 * valid, the code that is still running (it knows none of the new columns) still writes, and the new tables and vocabularies hold their checks.
 */
const BEFORE = Object.fromEntries(Object.entries(MIGRATIONS).filter(([name]) => name < '0050')) as typeof MIGRATIONS;
const clock = new FixedClock('2026-10-28T08:00:00.000Z');

let db: Kysely<Database>;
let owner: UserFixture;
let oldSession = '';
let oldAttempt = '';

beforeAll(async () => {
  db = createDatabase({ url: await freshDatabaseUrl(), logger: createLogger({ level: 'fatal' }), pool: { max: 2 } });
  await migrateToLatest(db, BEFORE);
  owner = await createUser(db, clock, { role: 'editor' });
  oldSession = (await session()).id;
  oldAttempt =
    (
      await sql<{ id: string }>`
      insert into identity.login_attempts (user_id, token_hash, created_at, expires_at)
      values (${owner.id}, ${randomBytes(32)}, '2026-10-28T08:00:00Z', '2026-10-28T08:05:00Z') returning id`.execute(db)
    ).rows[0]?.id ?? '';
  expect((await migrateToLatest(db, MIGRATIONS)).applied).toEqual([
    '0050_mobile_devices',
    '0051_mobile_tokens',
    '0052_mobile_vocabularies',
    '0053_media_derivatives',
    '0055_media_video',
  ]);
});
afterAll(async () => {
  await db.destroy();
});

async function session(): Promise<{ id: string }> {
  const { rows } = await sql<{ id: string }>`
    insert into identity.sessions (user_id, channel, state, token_hash, created_at, last_seen_at, last_authenticated_at, idle_expires_at, absolute_expires_at)
    values (${owner.id}, 'web', 'active', ${randomBytes(32)}, '2026-10-28T08:00:00Z', '2026-10-28T08:00:00Z', '2026-10-28T08:00:00Z', '2026-10-28T09:00:00Z', '2026-10-28T20:00:00Z')
    returning id`.execute(db);
  return { id: rows[0]?.id ?? '' };
}

interface DeviceValues {
  user_id: string;
  secret_hash: Buffer;
  model: string;
  os_version: string;
  security_patch: string;
  platform: string;
  app_version: string;
  last_contact_at: string;
  created_at: string;
  previous_secret_hash: Buffer | null;
  previous_valid_until: string | null;
  state: string;
  pending_items_reported: number;
}

const device = (overrides: Partial<DeviceValues> = {}) => {
  const values: DeviceValues = {
    user_id: owner.id,
    secret_hash: randomBytes(32),
    model: 'Pixel 8',
    os_version: '14',
    security_patch: '2026-09-05',
    platform: 'android',
    app_version: '1.2.0',
    last_contact_at: '2026-10-28T08:00:00Z',
    created_at: '2026-10-28T08:00:00Z',
    previous_secret_hash: null,
    previous_valid_until: null,
    state: 'active',
    pending_items_reported: 0,
    ...overrides,
  };
  return sql<{ id: string }>`
    insert into identity.devices (user_id, secret_hash, model, os_version, security_patch, platform, app_version, last_contact_at, created_at, previous_secret_hash, previous_valid_until, state, pending_items_reported)
    values (${values.user_id}, ${values.secret_hash}, ${values.model}, ${values.os_version}, ${values.security_patch}::date, ${values.platform}, ${values.app_version}, ${values.last_contact_at}, ${values.created_at}, ${values.previous_secret_hash}, ${values.previous_valid_until}, ${values.state}, ${values.pending_items_reported})
    returning id`.execute(db);
};

describe('migrations 0050–0052 — the mobile channel (EVM-094; expand only)', () => {
  it('EVM-094 0050 the sessions and first steps made before keep their data: no device on a session, the channel of a first step is the panel', async () => {
    const row = await sql<{ device_id: string | null }>`select device_id from identity.sessions where id = ${oldSession}`.execute(db);
    expect(row.rows).toEqual([{ device_id: null }]);
    const attempt = await sql<{ channel: string }>`select channel from identity.login_attempts where id = ${oldAttempt}`.execute(db);
    expect(attempt.rows).toEqual([{ channel: 'web' }]);
  });

  it('EVM-094 0050 the code that is still running writes without the new columns (a session of the panel, a first step)', async () => {
    await session();
    await sql`insert into identity.login_attempts (user_id, token_hash, created_at, expires_at) values (${owner.id}, ${randomBytes(32)}, now(), now() + interval '5 minutes')`.execute(
      db,
    );
  });

  it('EVM-094 0050 a device holds hashes of 32 bytes, a state of three, a date of the patch and a count of 0–10000; the previous secret is a pair with its time', async () => {
    expect((await device()).rows).toHaveLength(1);
    await expect(device({ secret_hash: randomBytes(16) })).rejects.toMatchObject({ code: '23514' });
    await expect(device({ state: 'removed' })).rejects.toMatchObject({ code: '23514' });
    await expect(device({ platform: 'windows' })).rejects.toMatchObject({ code: '23514' });
    await expect(device({ pending_items_reported: 10_001 })).rejects.toMatchObject({ code: '23514' });
    await expect(device({ model: '' })).rejects.toMatchObject({ code: '23514' });
    await expect(device({ security_patch: '2026-13-45' })).rejects.toMatchObject({ code: '22008' });
    await expect(device({ previous_secret_hash: randomBytes(32) })).rejects.toMatchObject({ code: '23514' });
    expect((await device({ previous_secret_hash: randomBytes(32), previous_valid_until: '2026-11-04T08:00:00Z' })).rows).toHaveLength(1);
    await expect(device({ user_id: '0193a000-0000-7000-8000-0000000000ff' })).rejects.toMatchObject({ code: '23503' });
  });

  it('EVM-094 0050 a mobile session names its device; an unknown device is refused', async () => {
    const id = (await device()).rows[0]?.id ?? '';
    await sql`insert into identity.sessions (user_id, channel, state, token_hash, created_at, last_seen_at, last_authenticated_at, idle_expires_at, absolute_expires_at, device_id)
              values (${owner.id}, 'mobile', 'active', ${randomBytes(32)}, now(), now(), now(), now() + interval '14 days', now() + interval '30 days', ${id})`.execute(
      db,
    );
    await expect(
      sql`insert into identity.sessions (user_id, channel, state, token_hash, created_at, last_seen_at, last_authenticated_at, idle_expires_at, absolute_expires_at, device_id)
          values (${owner.id}, 'mobile', 'active', ${randomBytes(32)}, now(), now(), now(), now() + interval '14 days', now() + interval '30 days', '0193a000-0000-7000-8000-0000000000ff')`.execute(
        db,
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('EVM-094 0051 the tokens are hashes of 32 bytes with unique values; a family goes with its session', async () => {
    const s = await session();
    const hash = randomBytes(32);
    await sql`insert into identity.refresh_tokens (session_id, token_hash, created_at, expires_at) values (${s.id}, ${hash}, now(), now() + interval '14 days')`.execute(
      db,
    );
    await expect(
      sql`insert into identity.refresh_tokens (session_id, token_hash, created_at, expires_at) values (${s.id}, ${hash}, now(), now())`.execute(
        db,
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      sql`insert into identity.refresh_tokens (session_id, token_hash, created_at, expires_at) values (${s.id}, ${randomBytes(8)}, now(), now())`.execute(
        db,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await sql`insert into identity.access_tokens (token_hash, session_id, created_at, expires_at) values (${randomBytes(32)}, ${s.id}, now(), now() + interval '15 minutes')`.execute(
      db,
    );
    await sql`delete from identity.sessions where id = ${s.id}`.execute(db);
    const left = await sql<{
      total: string;
    }>`select count(*)::text as total from identity.refresh_tokens where session_id = ${s.id}`.execute(db);
    expect(left.rows[0]?.total).toBe('0');
  });

  it('EVM-094 0052 the vocabularies grew: a session may end by the reasons of the phone, e-mail 7 for the phone may be queued; the earlier values hold and an unknown one is refused', async () => {
    for (const reason of [
      'refresh_reuse',
      'device_inactive',
      'device_wipe',
      'device_removed',
      'session_limit',
      'ended_by_user',
      'logout',
      'password_reset',
    ]) {
      const { id } = await session();
      await sql`update identity.sessions set revoked_at = '2026-10-28T08:30:00Z', revoke_reason = ${reason} where id = ${id}`.execute(db);
    }
    const { id } = await session();
    await expect(
      sql`update identity.sessions set revoked_at = now(), revoke_reason = 'made_up' where id = ${id}`.execute(db),
    ).rejects.toMatchObject({ code: '23514' });
    for (const kind of ['new_device', 'session_limit', 'account_locked', 'new_browser', 'administrator_alert']) {
      await sql`insert into platform.email_outbox (kind, variant, recipient_user_id, created_at) values (${kind}, null, ${owner.id}, '2026-10-28T08:00:00Z')`.execute(
        db,
      );
    }
    await expect(
      sql`insert into platform.email_outbox (kind, variant, recipient_user_id, created_at) values ('made_up', null, ${owner.id}, '2026-10-28T08:00:00Z')`.execute(
        db,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

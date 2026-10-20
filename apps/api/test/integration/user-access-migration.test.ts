import { randomBytes } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/migrations/index.ts';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { migrateToLatest } from '../../src/platform/database/migrator.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { FixedClock } from '../support/clock.ts';
import { createUser, type UserFixture } from '../support/identity-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { freshDatabaseUrl } from './database.ts';

/**
 * 0039 is applied on a database that already holds accounts: `activated_at` is filled from facts only (the earliest passkey, confirmation of a
 * TOTP factor or sign-in), an account with none stays null, and the vocabularies grow without touching a row.
 */
const BEFORE = Object.fromEntries(Object.entries(MIGRATIONS).filter(([name]) => name < '0039')) as typeof MIGRATIONS;

const clock = new FixedClock('2026-10-19T08:00:00.000Z');
const at = (iso: string): Date => new Date(iso);

let db: Kysely<Database>;
let withPasskey: UserFixture;
let withTotp: UserFixture;
let signedInOnly: UserFixture;
let deactivatedNever: UserFixture;
let invitedNever: UserFixture;
let emergencyReset: UserFixture;
let earliest: UserFixture;

beforeAll(async () => {
  db = createDatabase({ url: await freshDatabaseUrl(), logger: createLogger({ level: 'fatal' }), pool: { max: 2 } });
  await migrateToLatest(db, BEFORE);
  const make = (options: Parameters<typeof createUser>[2]) => createUser(db, clock, options);
  [withPasskey, withTotp, signedInOnly, deactivatedNever, invitedNever, emergencyReset, earliest] = [
    await make({ role: 'administrator' }),
    await make({ role: 'editor' }),
    await make({ role: 'editor' }),
    await make({ role: 'editor', status: 'deactivated' }),
    await make({ role: 'editor', status: 'invited' }),
    await make({ role: 'administrator', status: 'invited' }),
    await make({ role: 'administrator' }),
  ];
  const passkey = (user: UserFixture, createdAt: string) =>
    sql`insert into identity.passkeys (user_id, credential_id, public_key, counter, transports, device_type, backed_up, created_at)
        values (${user.id}, ${randomBytes(16).toString('base64url')}, ${randomBytes(32)}, 0, '{}', 'multi_device', true, ${createdAt})`.execute(
      db,
    );
  await passkey(withPasskey, '2026-09-01T08:00:00Z');
  await sql`insert into identity.totp_factors (user_id, secret_ciphertext, state, created_at, confirmed_at)
            values (${withTotp.id}, ${randomBytes(80)}, 'active', '2026-09-02T08:00:00Z', '2026-09-02T08:05:00Z')`.execute(db);
  await sql`update identity.users set last_login_at = '2026-09-03T08:00:00Z' where id in (${signedInOnly.id}, ${emergencyReset.id})`.execute(
    db,
  );
  await passkey(earliest, '2026-09-05T08:00:00Z');
  await sql`update identity.users set last_login_at = '2026-09-04T08:00:00Z' where id = ${earliest.id}`.execute(db);
  expect((await migrateToLatest(db, MIGRATIONS)).applied).toEqual(['0039_user_access_management']);
});
afterAll(async () => {
  await db.destroy();
});

const activatedAt = async (user: UserFixture): Promise<string | null> => {
  const { rows } = await sql<{ at: Date | null }>`select activated_at as at from identity.users where id = ${user.id}`.execute(db);
  return rows[0]?.at?.toISOString() ?? null;
};

describe('migration 0039 — roles, deactivation, sessions and reset of the second step (EVM-027; expand only)', () => {
  it('EVM-027 0039 activated_at is the earliest fact of an activation: the passkey, the confirmed TOTP factor or the sign-in', async () => {
    expect(await activatedAt(withPasskey)).toBe('2026-09-01T08:00:00.000Z');
    expect(await activatedAt(withTotp)).toBe('2026-09-02T08:05:00.000Z');
    expect(await activatedAt(signedInOnly)).toBe('2026-09-03T08:00:00.000Z');
    expect(await activatedAt(earliest)).toBe('2026-09-04T08:00:00.000Z');
  });

  it('EVM-027 0039 an account that was never activated, or waits for activation again, stays null (a deactivated one reactivates to invited)', async () => {
    expect(await activatedAt(deactivatedNever)).toBeNull();
    expect(await activatedAt(invitedNever)).toBeNull();
    expect(await activatedAt(emergencyReset)).toBeNull();
  });

  it('EVM-027 0039 the vocabularies grow: the window of a second step (mfa_setup, mfa_reset) and the reasons of a revocation', async () => {
    const link = (purpose: string, issuedBy: string) =>
      sql`insert into identity.one_time_links (user_id, purpose, token_hash, issued_by, issued_at, expires_at)
          values (${withPasskey.id}, ${purpose}, ${randomBytes(32)}, ${issuedBy}, ${clock.now()}, ${at('2026-10-20T08:00:00Z')})`.execute(
        db,
      );
    await link('mfa_setup', 'mfa_reset');
    await expect(link('mfa_setup', 'role_change')).rejects.toMatchObject({ code: '23514' });
    await expect(link('role_change', 'mfa_reset')).rejects.toMatchObject({ code: '23514' });
    await link('account_activation', 'cli');
    await link('password_reset', 'password_reset');

    for (const reason of [
      'role_changed',
      'account_deactivated',
      'sessions_ended',
      'second_step_reset',
      'password_reset',
      'step_up_failed',
    ]) {
      await sql`insert into identity.sessions (user_id, channel, state, token_hash, created_at, last_seen_at, last_authenticated_at,
                  idle_expires_at, absolute_expires_at, revoked_at, revoke_reason)
                values (${withPasskey.id}, 'web', 'active', ${randomBytes(32)}, ${clock.now()}, ${clock.now()}, ${clock.now()},
                  ${at('2026-10-19T09:00:00Z')}, ${at('2026-10-19T20:00:00Z')}, ${clock.now()}, ${reason})`.execute(db);
    }
    await expect(
      sql`insert into identity.sessions (user_id, channel, state, token_hash, created_at, last_seen_at, last_authenticated_at,
            idle_expires_at, absolute_expires_at, revoked_at, revoke_reason)
          values (${withPasskey.id}, 'web', 'active', ${randomBytes(32)}, ${clock.now()}, ${clock.now()}, ${clock.now()},
            ${at('2026-10-19T09:00:00Z')}, ${at('2026-10-19T20:00:00Z')}, ${clock.now()}, 'role_change')`.execute(db),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('EVM-027 0039 the new column is nullable with no default, so the code that is still running keeps inserting accounts without it', async () => {
    const { rows } = await sql<{ is_nullable: string; column_default: string | null }>`
      select is_nullable, column_default from information_schema.columns
      where table_schema = 'identity' and table_name = 'users' and column_name = 'activated_at'`.execute(db);
    expect(rows).toEqual([{ is_nullable: 'YES', column_default: null }]);
    await sql`insert into identity.users (id, email, display_name, role, status, webauthn_user_handle, created_at, updated_at)
              values (${uuidv7()}, 'stary.kod@evia.invalid', 'Stary kod', 'editor', 'invited', ${randomBytes(32)}, ${clock.now()}, ${clock.now()})`.execute(
      db,
    );
  });
});

import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedClock } from '../support/clock.ts';
import { createSession, createUser } from '../support/identity-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
const clock = new FixedClock('2026-10-16T08:00:00.000Z');
beforeAll(async () => {
  database = await migratedDatabase();
});
afterAll(async () => {
  await database.close();
});

const ARGON2ID_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c3ludGhldGlj$c3ludGhldGljLWhhc2g';

describe('the migration of TOTP and recovery codes (EVM-023; expand only)', () => {
  it('EVM-023 0038 an account has at most one TOTP factor; the state and the confirmation time agree; an unknown state is refused', async () => {
    const user = await createUser(database.admin, clock, { role: 'editor' });
    const insert = (state: string, confirmedAt: Date | null, userId: string = user.id) =>
      sql`
        insert into identity.totp_factors (user_id, secret_ciphertext, state, created_at, confirmed_at)
        values (${userId}, ${randomBytes(80)}, ${state}, ${clock.now()}, ${confirmedAt})`.execute(database.admin);
    await expect(insert('active', null)).rejects.toMatchObject({ code: '23514' });
    await expect(insert('pending', clock.now())).rejects.toMatchObject({ code: '23514' });
    await expect(insert('retired', clock.now())).rejects.toMatchObject({ code: '23514' });
    await insert('pending', null);
    await expect(insert('pending', null)).rejects.toMatchObject({ code: '23505' });
    await expect(insert('pending', null, uuidv7())).rejects.toMatchObject({ code: '23503' });
  });

  it('EVM-023 0038 a recovery code is stored only as an Argon2id hash (anything else is refused)', async () => {
    const user = await createUser(database.admin, clock, { role: 'editor' });
    const insert = (hash: string) =>
      sql`
        insert into identity.recovery_codes (user_id, generation_id, session_id, code_hash, created_at)
        values (${user.id}, ${uuidv7()}, ${uuidv7()}, ${hash}, ${clock.now()})`.execute(database.admin);
    await insert(ARGON2ID_HASH);
    await expect(insert('ABCDEFGHIJKLMNOPQRST')).rejects.toMatchObject({ code: '23514' });
    await expect(insert('$2b$10$abcdefghijklmnopqrstuv')).rejects.toMatchObject({ code: '23514' });
  });

  it('EVM-023 0038 sessions get the new columns with safe defaults (no TOTP authentication, no failures) and the existing ones keep working', async () => {
    const user = await createUser(database.admin, clock, { role: 'editor' });
    const session = await createSession(database.admin, clock, user);
    const { rows } = await sql<{ totp: Date | null; failures: number }>`
      select totp_authenticated_at as totp, step_up_failed_attempts as failures from identity.sessions where id = ${session.id}`.execute(
      database.admin,
    );
    expect(rows).toEqual([{ totp: null, failures: 0 }]);
    await expect(
      sql`update identity.sessions set step_up_failed_attempts = -1 where id = ${session.id}`.execute(database.admin),
    ).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('EVM-023 0038 a session may end with the reason step_up_failed, the earlier reasons are still accepted, an unknown one is refused', async () => {
    const user = await createUser(database.admin, clock, { role: 'editor' });
    const revoke = async (reason: string) => {
      const session = await createSession(database.admin, clock, user);
      await sql`update identity.sessions set revoked_at = ${clock.now()}, revoke_reason = ${reason} where id = ${session.id}`.execute(
        database.admin,
      );
    };
    for (const reason of ['logout', 'rotated', 'emergency_reset', 'link_superseded', 'expired', 'password_reset', 'step_up_failed'])
      await revoke(reason);
    await expect(revoke('forgotten')).rejects.toMatchObject({ code: '23514' });
  });

  it('EVM-023 0038 the outbox knows mfa_changed and recovery_code_used beside the earlier kinds; an unknown kind is refused', async () => {
    const insert = (kind: string) =>
      sql`insert into platform.email_outbox (kind, recipient_user_id, created_at) values (${kind}, ${uuidv7()}, ${clock.now()})`.execute(
        database.admin,
      );
    for (const kind of [
      'user_invitation',
      'administrator_alert',
      'password_reset',
      'password_changed',
      'mfa_changed',
      'recovery_code_used',
    ])
      await insert(kind);
    await expect(insert('newsletter')).rejects.toMatchObject({ code: '23514' });
  });

  it('EVM-023 0038 the application role may read, insert and update the factors and the codes but never delete a code or truncate (hashes stay as a record)', async () => {
    const privileges = async (table: string) => {
      const { rows } = await sql<{ privilege: string; allowed: boolean }>`
        select p as privilege, has_table_privilege('evia_it_app', ${table}, p) as allowed
        from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p`.execute(database.admin);
      return rows.filter((row) => row.allowed).map((row) => row.privilege);
    };
    expect(await privileges('identity.totp_factors')).toEqual(['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
    expect(await privileges('identity.recovery_codes')).toEqual(['SELECT', 'INSERT', 'UPDATE']);
  });
});

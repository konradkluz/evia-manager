import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedClock } from '../support/clock.ts';
import { createLink, createSession, createUser } from '../support/identity-fixtures.ts';
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

describe('the migration of the password reset (EVM-025; expand only, K13)', () => {
  it('EVM-025 0037 a link may be issued for a password reset and the earlier purposes and issuers are still accepted; anything else is refused', async () => {
    const user = await createUser(database.admin, clock, { role: 'editor', status: 'active' });
    const link = (purpose: string, issuedBy: string) =>
      sql`
        insert into identity.one_time_links (user_id, purpose, token_hash, issued_by, issued_at, expires_at)
        values (${user.id}, ${purpose}, ${randomBytes(32)}, ${issuedBy}, ${clock.now()}, ${new Date(clock.now().getTime() + 1000)})`.execute(
        database.admin,
      );
    await link('password_reset', 'password_reset');
    await link('account_activation', 'cli');
    await link('account_activation', 'invitation');
    await createLink(database.admin, clock, user.id);
    await expect(link('email_change', 'password_reset')).rejects.toMatchObject({ code: '23514' });
    await expect(link('password_reset', 'self_service')).rejects.toMatchObject({ code: '23514' });
  });

  it('EVM-025 0037 a session may end with the reason password_reset and the earlier reasons are still accepted; an unknown one is refused', async () => {
    const user = await createUser(database.admin, clock, { role: 'editor', status: 'active' });
    const revoke = async (reason: string) => {
      const session = await createSession(database.admin, clock, user);
      await sql`update identity.sessions set revoked_at = ${clock.now()}, revoke_reason = ${reason} where id = ${session.id}`.execute(
        database.admin,
      );
    };
    for (const reason of ['logout', 'rotated', 'emergency_reset', 'link_superseded', 'expired', 'password_reset']) await revoke(reason);
    await expect(revoke('forgotten')).rejects.toMatchObject({ code: '23514' });
  });

  it('EVM-025 0037 the outbox knows the kinds password_reset and password_changed beside the earlier two; an unknown kind is refused', async () => {
    const insert = (kind: string) =>
      sql`insert into platform.email_outbox (kind, recipient_user_id, created_at) values (${kind}, ${uuidv7()}, ${clock.now()})`.execute(
        database.admin,
      );
    for (const kind of ['user_invitation', 'administrator_alert', 'password_reset', 'password_changed']) await insert(kind);
    await expect(insert('newsletter')).rejects.toMatchObject({ code: '23514' });
  });

  it('EVM-025 0037 the application role gets no new privileges: the outbox stays without DELETE and TRUNCATE, the identity tables keep their grants', async () => {
    const privileges = async (table: string) => {
      const { rows } = await sql<{ privilege: string; allowed: boolean }>`
        select p as privilege, has_table_privilege('evia_it_app', ${table}, p) as allowed
        from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p`.execute(database.admin);
      return rows.filter((row) => row.allowed).map((row) => row.privilege);
    };
    expect(await privileges('platform.email_outbox')).toEqual(['SELECT', 'INSERT', 'UPDATE']);
    expect(await privileges('identity.one_time_links')).toEqual(['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
    expect(await privileges('identity.sessions')).toEqual(['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
  });
});

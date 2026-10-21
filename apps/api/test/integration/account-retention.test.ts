import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PURGE_SESSIONS_FAILED, PurgeSessionsJob } from '../../src/modules/identity/application/purge-sessions.job.ts';
import { JobFailure } from '../../src/platform/jobs/index.ts';
import { SESSION_RETENTION_MS } from '../../src/modules/identity/domain/constants.ts';
import { identityTables } from '../../src/modules/identity/infrastructure/tables.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser } from '../support/identity-fixtures.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp({ now: '2026-09-01T08:00:00.000Z' });
});
afterEach(async () => {
  await current.close();
});

const db = () => identityTables(current.database.admin);
const job = () => current.app.get(PurgeSessionsJob, { strict: false });
const DAY = 24 * 3_600_000;

/** A session that ended at `endedAt`: both deadlines (and, when `revoked`, the revocation) are that instant. */
async function endedSession(userId: string, endedAt: Date, options: { revoked?: boolean } = {}): Promise<string> {
  const user = { id: userId, email: '', password: '' } as never;
  const { id } = await createSession(current.database.admin, current.clock, user);
  const later = new Date(endedAt.getTime() + DAY);
  // revoked at `endedAt` with later deadlines, or ran out at `endedAt` (both deadlines)
  await sql`
    update identity.sessions
    set idle_expires_at = ${options.revoked === true ? later : endedAt}, absolute_expires_at = ${options.revoked === true ? later : endedAt},
        last_seen_at = ${new Date(endedAt.getTime() - 60_000)},
        revoked_at = ${options.revoked === true ? endedAt : null}, revoke_reason = ${options.revoked === true ? 'logout' : null}
    where id = ${id}`.execute(current.database.admin);
  return id;
}
const remaining = async (): Promise<string[]> => (await db().selectFrom('identity.sessions').select('id').execute()).map((row) => row.id);

describe('the retention of sessions (EVM-028 AC7; SR-DATA-07, P4; RODO art. 5(1)(e))', () => {
  it('EVM-028 AC7 a session that expired on 2026-09-01 is deleted by the job of 2026-10-02; its WebAuthn challenges go first (no foreign key error); the report is a number and nothing else', async () => {
    const owner = await createUser(current.database.admin, current.clock, { role: 'editor', status: 'active' });
    const expired = await endedSession(owner.id, new Date('2026-09-01T08:00:00.000Z'));
    await sql`
      insert into identity.webauthn_challenges (user_id, session_id, purpose, challenge_hash, created_at, expires_at)
      values (${owner.id}, ${expired}, 'passkey_step_up', ${randomBytes(32)}, ${current.clock.now()}, ${new Date(current.clock.now().getTime() + 300_000)})`.execute(
      current.database.admin,
    );
    current.clock.set('2026-10-02T08:00:00.000Z');
    const report = await job().run();
    expect(report).toEqual({ sessions: 1 });
    expect(JSON.stringify(report)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|@|\./);
    expect(await remaining()).toEqual([]);
    expect(await db().selectFrom('identity.webauthn_challenges').select('id').execute()).toEqual([]);
    expect(current.logs.text).not.toContain(owner.id);
    expect(current.logs.text).not.toContain(expired);
  });

  it('EVM-028 AC7 only what ended MORE than 30 days ago goes: 30 days exactly stays, a second more goes; a session that ended on 2026-09-03 and a live one stay', async () => {
    const owner = await createUser(current.database.admin, current.clock, { role: 'editor', status: 'active' });
    const now = new Date('2026-10-02T08:00:00.000Z');
    const cutoff = new Date(now.getTime() - SESSION_RETENTION_MS);
    const older = await endedSession(owner.id, new Date(cutoff.getTime() - 1000));
    const boundary = await endedSession(owner.id, cutoff);
    const recent = await endedSession(owner.id, new Date('2026-09-03T08:00:00.000Z'));
    current.clock.set(now);
    const live = (await createSession(current.database.admin, current.clock, owner)).id;
    expect(await job().run()).toEqual({ sessions: 1 });
    const left = await remaining();
    expect(left).not.toContain(older);
    expect(left.sort()).toEqual([boundary, recent, live].sort());
  });

  it('EVM-028 AC7 a session ended by revocation counts from the revocation (even if its deadlines are later), and an active one is never deleted', async () => {
    const owner = await createUser(current.database.admin, current.clock, { role: 'editor', status: 'active' });
    const revoked = await endedSession(owner.id, new Date('2026-09-01T08:00:00.000Z'), { revoked: true });
    current.clock.set('2026-10-02T08:00:00.000Z');
    const live = (await createSession(current.database.admin, current.clock, owner)).id;
    expect(await job().run()).toEqual({ sessions: 1 });
    expect(await remaining()).toEqual([live]);
    expect(await remaining()).not.toContain(revoked);
  });

  it('EVM-028 AC7 the audit trail is never touched, and a second run deletes nothing', async () => {
    const owner = await createUser(current.database.admin, current.clock, { role: 'editor', status: 'active' });
    const ended = await endedSession(owner.id, new Date('2026-09-01T08:00:00.000Z'));
    await sql`
      insert into audit.events (occurred_at, actor_type, actor_user_id, session_id, origin, action, outcome, object_type, object_id, trace_id)
      values (${current.clock.now()}, 'user', ${owner.id}, ${ended}, 'web', 'session.created', 'success', 'session', ${ended}, ${randomBytes(16).toString('hex')})`.execute(
      current.database.admin,
    );
    const events = async () =>
      (await sql<{ count: string }>`select count(*)::text as count from audit.events`.execute(current.database.admin)).rows[0]?.count;
    const before = await events();
    current.clock.set('2026-10-02T08:00:00.000Z');
    expect(await job().run()).toEqual({ sessions: 1 });
    expect(await job().run()).toEqual({ sessions: 0 });
    expect(await events()).toBe(before);
  });
});

describe('the job of retention of sessions fails closed (EVM-028 AC7)', () => {
  it('EVM-028 AC7 a failing purge leaves as a JobFailure with a fixed code — nothing of the database error reaches the queue or the log', async () => {
    await sql`revoke delete on identity.sessions from evia_app`.execute(current.database.admin);
    const owner = await createUser(current.database.admin, current.clock, { role: 'editor', status: 'active' });
    await endedSession(owner.id, new Date('2026-09-01T08:00:00.000Z'));
    current.clock.set('2026-10-02T08:00:00.000Z');
    const failure = await job()
      .run()
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(JobFailure);
    expect((failure as JobFailure).code).toBe(PURGE_SESSIONS_FAILED);
    expect(current.logs.text).toContain('sessions purge: failed');
    expect(current.logs.text).not.toMatch(/identity\.sessions|permission denied/i);
  });

  it('EVM-028 AC7 the job is a definition of the worker: the name, the nightly schedule in the business zone and a handler that runs the purge', async () => {
    const definition = job().definition();
    expect(definition).toMatchObject({ name: 'identity.purge-sessions', schedule: { cron: '50 3 * * *', timezone: 'Europe/Warsaw' } });
    expect(await definition.handler({ ids: [] })).toEqual({ sessions: 0 });
  });
});

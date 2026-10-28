import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLink, createUser } from '../support/identity-fixtures.ts';
import { FixedClock } from '../support/clock.ts';
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

const insert = (values: { kind?: string; variant?: string | null; state?: string; attempts?: number; sentAt?: Date | null }) =>
  sql`
    insert into platform.email_outbox (kind, variant, recipient_user_id, state, attempts, sent_at, created_at)
    values (${values.kind ?? 'user_invitation'}, ${values.variant ?? null}, ${uuidv7()}, ${values.state ?? 'pending'}, ${values.attempts ?? 0}, ${values.sentAt ?? null}, ${clock.now()})`.execute(
    database.admin,
  );

describe('the migration of the e-mail outbox (EVM-024; ADR-0003, SR-DATA-01)', () => {
  it('EVM-024 0035 the table holds the kind, the variant, the recipient by id, the state, the attempts and times — and no column for an address, a name, a token or a text', async () => {
    const { rows } = await sql<{ column_name: string }>`
      select column_name from information_schema.columns where table_schema = 'platform' and table_name = 'email_outbox' order by ordinal_position`.execute(
      database.admin,
    );
    expect(rows.map((row) => row.column_name)).toEqual([
      'id',
      'kind',
      'variant',
      'recipient_user_id',
      'state',
      'attempts',
      'enqueued_at',
      'sent_at',
      'created_at',
      'subject_id', // EVM-049 (0047): the thing an alert is about, a plain column
    ]);
  });

  it('EVM-024 0035 the vocabularies and the shape are checks of the database: an unknown kind or state, a variant that is not a code, too many attempts, `sent` without a time of sending', async () => {
    await insert({});
    await insert({ kind: 'administrator_alert', variant: 'administrator_invitation' });
    await insert({ state: 'sent', sentAt: clock.now() });
    for (const bad of [
      { kind: 'newsletter' },
      { state: 'queued' },
      { variant: 'Not A Code' },
      { variant: 'x'.repeat(41) },
      { attempts: 21 },
      { attempts: -1 },
      { state: 'sent' },
      { state: 'pending', sentAt: clock.now() },
    ]) {
      await expect(insert(bad), JSON.stringify(bad)).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('EVM-024 0035 the recipient is an identifier, not a foreign key (platform does not know the tables of a module), and the indexes serve the relay and the list of users', async () => {
    const { rows: foreign } = await sql`
      select 1 from pg_constraint where conrelid = 'platform.email_outbox'::regclass and contype = 'f'`.execute(database.admin);
    expect(foreign).toEqual([]);
    const { rows: indexes } = await sql<{ indexname: string; indexdef: string }>`
      select indexname, indexdef from pg_indexes where schemaname = 'platform' and tablename = 'email_outbox' order by indexname`.execute(
      database.admin,
    );
    expect(indexes.map((index) => index.indexname)).toEqual([
      'email_outbox_latest_of_recipient_idx',
      'email_outbox_pending_subject_idx', // EVM-049
      'email_outbox_pkey',
      'email_outbox_to_relay_idx',
    ]);
    expect(indexes.find((index) => index.indexname === 'email_outbox_to_relay_idx')?.indexdef).toMatch(/WHERE \(state = 'pending'/);
    expect(indexes.find((index) => index.indexname === 'email_outbox_latest_of_recipient_idx')?.indexdef).toMatch(
      /\(recipient_user_id, kind, created_at DESC\)/,
    );
  });

  it('EVM-024 0035 W14 the application role reads, inserts and updates the outbox and can NOT delete from it or truncate it; the reader of a read-only role has nothing', async () => {
    const { rows } = await sql<{ select: boolean; insert: boolean; update: boolean; delete: boolean; truncate: boolean }>`
      select has_table_privilege('evia_it_app', 'platform.email_outbox', 'SELECT') as "select",
             has_table_privilege('evia_it_app', 'platform.email_outbox', 'INSERT') as "insert",
             has_table_privilege('evia_it_app', 'platform.email_outbox', 'UPDATE') as "update",
             has_table_privilege('evia_it_app', 'platform.email_outbox', 'DELETE') as "delete",
             has_table_privilege('evia_it_app', 'platform.email_outbox', 'TRUNCATE') as "truncate"`.execute(database.admin);
    expect(rows[0]).toEqual({ select: true, insert: true, update: true, delete: false, truncate: false });
    const { rows: publicAccess } = await sql<{ allowed: boolean }>`
      select has_table_privilege('public', 'platform.email_outbox', 'SELECT') as allowed`.execute(database.admin);
    expect(publicAccess[0]?.allowed).toBe(false);
  });

  it('EVM-024 0036 the vocabulary of the issuer of a link accepts the invitation and still the command of the first Administrator; anything else is refused', async () => {
    const user = await createUser(database.admin, clock, { role: 'editor', status: 'invited' });
    const link = (issuedBy: string) =>
      sql`
        insert into identity.one_time_links (user_id, purpose, token_hash, issued_by, issued_at, expires_at)
        values (${user.id}, 'account_activation', ${randomBytes(32)}, ${issuedBy}, ${clock.now()}, ${new Date(clock.now().getTime() + 1000)})`.execute(
        database.admin,
      );
    await link('cli');
    await link('invitation');
    await expect(link('self_service')).rejects.toMatchObject({ code: '23514' });
    // an existing fixture of the old kind of write still works (expand: the code that is running writes 'cli')
    await createLink(database.admin, clock, user.id);
  });
});

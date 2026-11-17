import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/migrations/index.ts';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { migrateToLatest } from '../../src/platform/database/migrator.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { FixedClock } from '../support/clock.ts';
import { createUser } from '../support/identity-fixtures.ts';
import { freshDatabaseUrl } from './database.ts';

/**
 * 0067 - the kind `site_survey_expiring` of the outbox of e-mails (EVM-140 AC1; ADR-0024 pt 9; expand only: ONE CHECK that only grows, no backfill). It is applied on a
 * database that already holds rows of the kinds of 0052: they stay as they are, the new kind is accepted, an unknown one is still refused, and the logical undo (the
 * runner keeps no `down`) restores the CHECK of 0052 while no row of the new kind exists. Synthetic data only.
 */
const BEFORE = Object.fromEntries(Object.entries(MIGRATIONS).filter(([name]) => name < '0067')) as typeof MIGRATIONS;
/** The migrations up to and including 0067: later ones (0068 of the purge, merged into this branch) are not the subject of this test and apply on their own. */
const THROUGH_0067 = Object.fromEntries(
  Object.entries(MIGRATIONS).filter(([name]) => name <= '0067_email_outbox_site_survey'),
) as typeof MIGRATIONS;
const clock = new FixedClock('2026-11-17T08:00:00.000Z');
const T = '2026-11-17T08:00:00Z';
const OLD_KINDS = [
  'user_invitation',
  'administrator_alert',
  'password_reset',
  'password_changed',
  'mfa_changed',
  'recovery_code_used',
  'account_locked',
  'new_browser',
  'session_limit',
  'new_device',
];

let db: Kysely<Database>;
let recipient = '';

const insertKind = (kind: string) =>
  sql`insert into platform.email_outbox (kind, variant, recipient_user_id, created_at) values (${kind}, null, ${recipient}, ${T})`.execute(
    db,
  );
const kinds = async (): Promise<string[]> =>
  (await sql<{ kind: string }>`select kind from platform.email_outbox order by kind`.execute(db)).rows.map((row) => row.kind);

beforeAll(async () => {
  db = createDatabase({ url: await freshDatabaseUrl(), logger: createLogger({ level: 'fatal' }), pool: { max: 2 } });
  await migrateToLatest(db, BEFORE);
  recipient = (await createUser(db, clock, { role: 'editor' })).id;
  for (const kind of OLD_KINDS) await insertKind(kind);
});
afterAll(async () => {
  await db.destroy();
});

describe('migration 0067 - the kind of the reminder of a site survey (EVM-140 AC1; expand only)', () => {
  it('EVM-140 AC1 before 0067 the kind is refused (23514); 0067 applies alone and the rows that exist are untouched', async () => {
    await expect(insertKind('site_survey_expiring')).rejects.toMatchObject({ code: '23514' });
    expect((await migrateToLatest(db, THROUGH_0067)).applied).toEqual(['0067_email_outbox_site_survey']);
    expect(await kinds()).toEqual([...OLD_KINDS].sort());
  });

  it('EVM-140 AC1 after 0067 the new kind is accepted and an unknown kind is still refused (the list only grew)', async () => {
    await insertKind('site_survey_expiring');
    await expect(insertKind('made_up')).rejects.toMatchObject({ code: '23514' });
    for (const kind of OLD_KINDS) await insertKind(kind);
    expect((await kinds()).filter((kind) => kind === 'site_survey_expiring')).toHaveLength(1);
  });

  it('EVM-140 AC1 the logical undo restores the CHECK of 0052 while no row of the new kind exists, and loses nothing else', async () => {
    await sql`delete from platform.email_outbox where kind = 'site_survey_expiring'`.execute(db);
    await sql`
      alter table platform.email_outbox
        drop constraint email_outbox_kind_check,
        add constraint email_outbox_kind_check
          check (kind in (
            'user_invitation', 'administrator_alert', 'password_reset', 'password_changed', 'mfa_changed', 'recovery_code_used',
            'account_locked', 'new_browser', 'session_limit', 'new_device'
          ))`.execute(db);
    await expect(insertKind('site_survey_expiring')).rejects.toMatchObject({ code: '23514' });
    expect((await kinds()).length).toBe(OLD_KINDS.length * 2);
  });
});

import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/migrations/index.ts';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { migrateToLatest } from '../../src/platform/database/migrator.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { FixedClock } from '../support/clock.ts';
import { createMobileSession, createUser } from '../support/identity-fixtures.ts';
import { freshDatabaseUrl } from './database.ts';

/**
 * 0064 is applied on a database that already holds a device (EVM-095; expand only): the old row is untouched, the new column is empty and nullable, and the code
 * that is still running (it knows nothing of the column) still inserts devices.
 */
const BEFORE = Object.fromEntries(Object.entries(MIGRATIONS).filter(([name]) => name < '0064')) as typeof MIGRATIONS;
const clock = new FixedClock('2026-11-02T08:00:00.000Z');

let db: Kysely<Database>;
let deviceId = '';
beforeAll(async () => {
  db = createDatabase({ url: await freshDatabaseUrl(), logger: createLogger({ level: 'fatal' }), pool: { max: 2 } });
  await migrateToLatest(db, BEFORE);
  const user = await createUser(db, clock, { role: 'editor' });
  // the code before 0064 does not name the column: it is written the way that code writes
  const columns = await sql<{
    column_name: string;
  }>`select column_name from information_schema.columns where table_schema = 'identity' and table_name = 'devices'`.execute(db);
  expect(columns.rows.map((row) => row.column_name)).not.toContain('invalidated_at');
  deviceId = await insertWithoutTheColumn(user.id);
  expect((await migrateToLatest(db, MIGRATIONS)).applied).toEqual(['0064_device_invalidation']);
});
afterAll(async () => {
  await db.destroy();
});

async function insertWithoutTheColumn(userId: string): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    insert into identity.devices (user_id, secret_hash, model, os_version, security_patch, platform, app_version, last_contact_at, created_at)
    values (${userId}, decode(repeat('cd', 32), 'hex'), 'Pixel 8', '14', '2026-09-05', 'android', '1.2.0', '2026-11-01T08:00:00Z', '2026-11-01T08:00:00Z')
    returning id`.execute(db);
  return rows[0]?.id ?? '';
}

describe('migration 0064 - the moment a device was invalidated (EVM-095 AC7; expand only)', () => {
  it('EVM-095 AC7 the old row has an empty invalidated_at, nothing else changed', async () => {
    const { rows } = await sql<{ invalidated_at: Date | null; model: string; state: string }>`
      select invalidated_at, model, state from identity.devices where id = ${deviceId}`.execute(db);
    expect(rows[0]).toEqual({ invalidated_at: null, model: 'Pixel 8', state: 'active' });
  });

  it('EVM-095 AC7 the code that does not know the column still inserts a device, and the column accepts a time', async () => {
    const user = await createUser(db, clock, { role: 'editor' });
    const id = await insertWithoutTheColumn(user.id);
    await sql`update identity.devices set invalidated_at = '2026-11-02T08:00:00Z' where id = ${id}`.execute(db);
    const { rows } = await sql<{ invalidated_at: Date }>`select invalidated_at from identity.devices where id = ${id}`.execute(db);
    expect(rows[0]?.invalidated_at.toISOString()).toBe('2026-11-02T08:00:00.000Z');
  });

  it('EVM-095 AC7 the fixture of a mobile session still works after the migration', async () => {
    const user = await createUser(db, clock, { role: 'editor' });
    expect((await createMobileSession(db, clock, user)).deviceId).toBeDefined();
  });
});

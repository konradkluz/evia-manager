import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedClock } from '../support/clock.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createUser } from '../support/identity-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
let orderId = '';
let userId = '';
beforeAll(async () => {
  database = await migratedDatabase({ checkProjection: false });
  userId = (await createUser(database.admin, new FixedClock('2026-11-01T08:00:00.000Z'), { role: 'editor' })).id;
  const customerId = await insertCustomer(database.admin, {});
  const siteId = await insertSite(database.admin);
  [orderId = ''] = [...(await insertWorkOrders(database.admin, [{ number: 'ZL-5200-0001', customerId, siteId }])).values()];
});
afterAll(async () => {
  await database.close();
});

const admin = () => database.admin;
const fails = async (statement: Promise<unknown>, code: string): Promise<void> => {
  await expect(statement).rejects.toMatchObject({ code });
};
const insertExport = (overrides: {
  state?: string;
  key?: string;
  size?: number | null;
  failure?: string | null;
  readyAt?: string | null;
}) => {
  const id = uuidv7();
  const key = overrides.key ?? `exports/2026/11/${id}.zip`;
  return sql`insert into media.media_exports (id, work_order_id, requested_by, state, object_key, size_bytes, file_count, failure_code, created_at, ready_at, expires_at)
    values (${id}, ${orderId}, ${userId}, ${overrides.state ?? 'queued'}, ${key}, ${overrides.size ?? null}, ${overrides.size === null || overrides.size === undefined ? null : 3}, ${overrides.failure ?? null},
      '2026-11-01T08:00:00Z', ${overrides.readyAt ?? null}, '2026-11-02T08:00:00Z')`.execute(admin());
};

describe('migration 0063 - the ZIP export of the photos (EVM-052; expand only)', () => {
  it('EVM-052 AC1 an export is queued, running, ready, failed or expired; a ready one has a size, a count and a time', async () => {
    await insertExport({});
    await insertExport({ state: 'ready', size: 10, readyAt: '2026-11-01T08:05:00Z' });
    await insertExport({ state: 'failed', failure: 'storage_unavailable' });
    await fails(insertExport({ state: 'ready' }), '23514');
    await fails(insertExport({ state: 'done' }), '23514');
    await fails(insertExport({ state: 'failed' }), '23514');
    await fails(insertExport({ failure: 'storage_unavailable' }), '23514');
    await fails(insertExport({ state: 'failed', failure: 'oops' }), '23514');
  });

  it('EVM-052 AC4 the key is chosen by the server in the exports prefix (no name, no traversal) and an export lives forward in time', async () => {
    await fails(insertExport({ key: 'media/2026/11/x.zip' }), '23514');
    await fails(insertExport({ key: 'exports/2026/11/../x.zip' }), '23514');
    await fails(
      sql`insert into media.media_exports (id, work_order_id, requested_by, state, object_key, created_at, expires_at)
        values (${uuidv7()}, ${orderId}, ${userId}, 'queued', ${`exports/2026/11/${uuidv7()}.zip`}, '2026-11-01T08:00:00Z', '2026-11-01T07:00:00Z')`.execute(
        admin(),
      ),
      '23514',
    );
  });

  it('EVM-052 AC3 the alert code media_export_started is accepted and the list of 0058 still is', async () => {
    for (const code of ['media_export_started', 'sync_quick_create_quota_exceeded', 'emergency_reset']) {
      await sql`insert into platform.security_alert_outbox (alert_code, occurred_at, trace_id) values (${code}, '2026-11-01T08:00:00Z', ${'d'.repeat(32)})`.execute(
        admin(),
      );
    }
    await fails(
      sql`insert into platform.security_alert_outbox (alert_code, occurred_at, trace_id) values ('made_up', '2026-11-01T08:00:00Z', ${'d'.repeat(32)})`.execute(
        admin(),
      ),
      '23514',
    );
  });
});

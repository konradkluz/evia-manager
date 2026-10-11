import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { insertProcedure } from '../support/procedure-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
let app: Kysely<Database>;
beforeAll(async () => {
  database = await migratedDatabase();
  app = createDatabase({ url: database.appUrl, logger: createLogger({ level: 'fatal' }), pool: { max: 1 } });
});
afterAll(async () => {
  await app.destroy();
  await database.close();
});

const admin = () => database.admin;
const T = '2026-10-11T08:00:00Z';
const AUTHOR = uuidv7();
const fails = async (statement: Promise<unknown>, code: string): Promise<void> => {
  await expect(statement).rejects.toMatchObject({ code });
};

let counter = 0;
async function insertOrder(): Promise<{ orderId: string; stageId: string }> {
  counter += 1;
  const customerId = await insertCustomer(admin(), { email: `jan${counter}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [{ number: `ZL-${3200 + counter}-0001`, customerId, siteId }]);
  const orderId = [...ids.values()][0] ?? '';
  const process = await insertProcedure(admin(), orderId, { stages: [{}] });
  return { orderId, stageId: process.stageIds[0] ?? '' };
}

interface EntrySpec {
  readonly id?: string;
  readonly kind?: string;
  readonly category?: string | null;
  readonly body?: string | null;
  readonly stageId?: string | null;
  readonly supersedes?: string | null;
  readonly origin?: string;
  readonly author?: string | null;
}
const insertEntry = async (orderId: string, spec: EntrySpec = {}): Promise<string> => {
  const id = spec.id ?? uuidv7();
  const kind = spec.kind ?? 'note';
  const isEvent = kind === 'event';
  const category = spec.category === undefined ? (kind === 'note' ? 'phone_call' : null) : spec.category;
  const body = spec.body === undefined ? (isEvent ? null : 'Treść syntetyczna') : spec.body;
  const author = spec.author === undefined ? (isEvent ? null : AUTHOR) : spec.author;
  await sql`insert into timeline.timeline_entries
      (id, work_order_id, kind, note_category, body, procedure_stage_id, supersedes_entry_id, origin, created_at, created_by)
    values (${id}, ${orderId}, ${kind}, ${category}, ${body}, ${spec.stageId ?? null}, ${spec.supersedes ?? null},
      ${spec.origin ?? (isEvent ? 'system' : 'web')}, ${T}, ${author})`.execute(admin());
  return id;
};

describe('migration 0020 — the journal of a work order (EVM-037 AC1, AC3, AC7; ADR-0003; SR-AUTHZ-02; expand only)', () => {
  it('EVM-037 AC1 a note has a category, a comment has none, a text of 1..10 000 characters; the identifier is a UUIDv7', async () => {
    const { orderId } = await insertOrder();
    await insertEntry(orderId);
    await insertEntry(orderId, { kind: 'comment' });
    await insertEntry(orderId, { body: 'a'.repeat(10_000) });
    await fails(insertEntry(orderId, { body: 'a'.repeat(10_001) }), '23514');
    await fails(insertEntry(orderId, { body: '' }), '23514');
    await fails(insertEntry(orderId, { kind: 'note', category: null }), '23514');
    await fails(insertEntry(orderId, { kind: 'comment', category: 'meeting' }), '23514');
    await fails(insertEntry(orderId, { category: 'private_talk' }), '23514');
    await fails(insertEntry(orderId, { kind: 'diary' }), '23514');
    await fails(insertEntry(orderId, { id: '00000000-0000-4000-8000-000000000001' }), '23514');
  });

  it('EVM-037 AC1 an event has no text and no author and comes from the system; an entry of a person has an author and a body', async () => {
    const { orderId } = await insertOrder();
    await insertEntry(orderId, { kind: 'event' });
    await fails(insertEntry(orderId, { kind: 'event', body: 'Treść' }), '23514');
    await fails(insertEntry(orderId, { kind: 'event', author: AUTHOR }), '23514');
    await fails(insertEntry(orderId, { kind: 'event', origin: 'web' }), '23514');
    await fails(insertEntry(orderId, { origin: 'system' }), '23514');
    await fails(insertEntry(orderId, { author: null }), '23514');
    await fails(insertEntry(orderId, { body: null }), '23514');
    await fails(insertEntry(orderId, { origin: 'tablet' }), '23514');
  });

  it('EVM-037 AC7 SR-AUTHZ-02 an entry cannot point at a stage of another order: the composite key refuses it', async () => {
    const orderA = await insertOrder();
    const orderB = await insertOrder();
    await insertEntry(orderA.orderId, { stageId: orderA.stageId });
    await fails(insertEntry(orderA.orderId, { stageId: orderB.stageId }), '23503');
    await fails(insertEntry(orderA.orderId, { stageId: uuidv7() }), '23503');
  });

  it('EVM-037 AC3 SR-AUTHZ-02 a correction points at an entry of the SAME order, once; an event is never corrected', async () => {
    const orderA = await insertOrder();
    const orderB = await insertOrder();
    const original = await insertEntry(orderA.orderId);
    const foreign = await insertEntry(orderB.orderId);
    await fails(insertEntry(orderA.orderId, { supersedes: foreign }), '23503');
    await insertEntry(orderA.orderId, { supersedes: original });
    await fails(insertEntry(orderA.orderId, { supersedes: original }), '23505');
    // the kind of a correction is the kind of the entry it corrects: an event (not corrected) and a comment of a note are refused
    const event = await insertEntry(orderA.orderId, { kind: 'event' });
    await fails(insertEntry(orderA.orderId, { supersedes: event }), '23503');
    await fails(insertEntry(orderA.orderId, { kind: 'event', supersedes: original }), '23514');
    const note = await insertEntry(orderA.orderId);
    await fails(insertEntry(orderA.orderId, { kind: 'comment', supersedes: note }), '23503');
  });

  it('EVM-037 AC3 D3 the entry is append-only in the database: no column but the soft delete and the version can change', async () => {
    const { orderId, stageId } = await insertOrder();
    const other = await insertOrder();
    const original = await insertEntry(orderId, { stageId });
    const corrected = await insertEntry(orderId, { supersedes: original });
    const changes: Array<[string, ReturnType<typeof sql>]> = [
      ['id', sql`id = ${uuidv7()}`],
      ['work_order_id', sql`work_order_id = ${other.orderId}`],
      ['kind', sql`kind = 'comment', note_category = null`],
      ['note_category', sql`note_category = 'meeting'`],
      ['body', sql`body = 'Zmieniona treść'`],
      ['procedure_stage_id', sql`procedure_stage_id = null`],
      ['supersedes_entry_id', sql`supersedes_entry_id = null`],
      ['origin', sql`origin = 'mobile'`],
      ['captured_at', sql`captured_at = ${T}`],
      ['redacted_at', sql`redacted_at = ${T}, redacted_by = ${AUTHOR}`],
      ['created_at', sql`created_at = ${'2026-01-01T00:00:00Z'}`],
      ['created_by', sql`created_by = ${uuidv7()}`],
    ];
    for (const [column, set] of changes) {
      const target = column === 'supersedes_entry_id' ? corrected : original;
      await fails(sql`update timeline.timeline_entries set ${set} where id = ${target}`.execute(admin()), 'EV001');
      await fails(sql`update timeline.timeline_entries set ${set} where id = ${target}`.execute(app), 'EV001');
    }
    const { rows } = await sql<{ body: string }>`select body from timeline.timeline_entries where id = ${original}`.execute(admin());
    expect(rows[0]?.body).toBe('Treść syntetyczna');
    // the soft delete and the version are the only moves (EVM-040)
    await sql`update timeline.timeline_entries set deleted_at = ${T}, deleted_by = ${AUTHOR}, version = version + 1
      where id = ${original}`.execute(app);
  });

  it('EVM-037 D3 SR-DATA-03 the application role has SELECT, INSERT and UPDATE and no DELETE or TRUNCATE; the schema is not open to PUBLIC', async () => {
    const { rows } = await sql<Record<string, boolean>>`
      select has_table_privilege('evia_it_app', 'timeline.timeline_entries', 'select') as "select",
             has_table_privilege('evia_it_app', 'timeline.timeline_entries', 'insert') as "insert",
             has_table_privilege('evia_it_app', 'timeline.timeline_entries', 'update') as "update",
             has_table_privilege('evia_it_app', 'timeline.timeline_entries', 'delete') as "delete",
             has_table_privilege('evia_it_app', 'timeline.timeline_entries', 'truncate') as "truncate"`.execute(admin());
    expect(rows[0]).toEqual({ select: true, insert: true, update: true, delete: false, truncate: false });
    const { orderId } = await insertOrder();
    const id = await insertEntry(orderId);
    await fails(sql`delete from timeline.timeline_entries where id = ${id}`.execute(app), '42501');
    await fails(sql`truncate timeline.timeline_entries`.execute(app), '42501');
    const { rows: open } = await sql<{ n: string }>`
      select count(*)::text as n from information_schema.table_privileges
      where table_schema = 'timeline' and grantee = 'PUBLIC'`.execute(admin());
    expect(open[0]?.n).toBe('0');
    const { rows: usage } = await sql<{ usage: boolean }>`
      select has_schema_privilege('evia_it_app', 'timeline', 'usage') as "usage"`.execute(admin());
    expect(usage[0]?.usage).toBe(true);
  });

  it('EVM-037 ADR-0003 the keys are ON DELETE RESTRICT — no cascade', async () => {
    const { orderId } = await insertOrder();
    await insertEntry(orderId);
    await fails(sql`delete from work_orders.work_orders where id = ${orderId}`.execute(admin()), '23001');
    const { rows } = await sql<{ on_delete: string }>`
      select confdeltype as on_delete from pg_constraint where contype = 'f' and connamespace = 'timeline'::regnamespace`.execute(admin());
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.every((row) => row.on_delete === 'r')).toBe(true);
  });

  it('EVM-037 AC6 the order of the journal is the time of the server: created_at then id, served by an index of the order', async () => {
    const { rows } = await sql<{ indexdef: string }>`
      select indexdef from pg_indexes where schemaname = 'timeline' and tablename = 'timeline_entries' order by indexname`.execute(admin());
    const text = rows.map((row) => row.indexdef).join('\n');
    expect(text).toContain('(work_order_id, created_at DESC, id DESC)');
    expect(text).toContain('(work_order_id, kind, created_at DESC, id DESC)');
    expect(text).toContain('(work_order_id, procedure_stage_id, created_at DESC, id DESC)');
  });
});

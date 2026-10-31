import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { REDACTION_MARKER_PATTERN } from '../../src/modules/timeline/domain/redaction-marker.ts';
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
      (id, work_order_id, kind, note_category, body, procedure_stage_id, supersedes_entry_id, origin, created_at, created_by,
       event_code, event_payload)
    values (${id}, ${orderId}, ${kind}, ${category}, ${body}, ${spec.stageId ?? null}, ${spec.supersedes ?? null},
      ${spec.origin ?? (isEvent ? 'system' : 'web')}, ${T}, ${author},
      ${isEvent ? 'stage_status_changed' : null}, ${isEvent ? JSON.stringify({ objectType: 'work_order' }) : null}::jsonb)`.execute(
    admin(),
  );
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

  it('EVM-037 AC1 an event has no text and comes from the system; an entry of a person has an author and a body', async () => {
    const { orderId } = await insertOrder();
    await insertEntry(orderId, { kind: 'event' });
    await fails(insertEntry(orderId, { kind: 'event', body: 'Treść' }), '23514');
    // since 0021 an event may carry the actor who caused it (EVM-038 AC3: the author in the header)
    await insertEntry(orderId, { kind: 'event', author: AUTHOR });
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
      // EVM-098 (0056): the device of an entry from the phone is immutable too
      ['created_via_device_id', sql`created_via_device_id = ${uuidv7()}`],
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

describe('migration 0021 — the events of the journal (EVM-038 AC1, AC2, AC6; SR-LOG-03, SR-DATA-01; ASVS V16.4.2; expand only)', () => {
  const insertEvent = (orderId: string, spec: { kind?: string; code?: string | null; payload?: unknown; author?: string | null } = {}) => {
    const kind = spec.kind ?? 'event';
    const origin = kind === 'event' ? 'system' : 'web';
    const body = kind === 'event' ? null : 'Treść syntetyczna';
    const payload = spec.payload === undefined ? { objectType: 'work_order' } : spec.payload;
    return sql`insert into timeline.timeline_entries
        (id, work_order_id, kind, note_category, body, origin, created_at, created_by, event_code, event_payload)
      values (${uuidv7()}, ${orderId}, ${kind}, ${kind === 'note' ? 'meeting' : null}, ${body}, ${origin}, ${T},
        ${spec.author === undefined ? null : spec.author}, ${spec.code === undefined ? (kind === 'event' ? 'work_order_created' : null) : spec.code},
        ${payload === null ? null : JSON.stringify(payload)}::jsonb)`.execute(admin());
  };

  it('EVM-038 AC1 an event has a code of a fixed form and a payload that is a JSON object — and only an event has them', async () => {
    const { orderId } = await insertOrder();
    await insertEvent(orderId);
    await insertEvent(orderId, { author: AUTHOR });
    await fails(insertEvent(orderId, { code: null }), '23514');
    await fails(insertEvent(orderId, { payload: null }), '23514');
    await fails(insertEvent(orderId, { code: 'Work-Order' }), '23514');
    await fails(insertEvent(orderId, { code: 'a'.repeat(65) }), '23514');
    await fails(insertEvent(orderId, { payload: ['array'] }), '23514');
    await fails(insertEvent(orderId, { payload: 'text' }), '23514');
    await fails(insertEvent(orderId, { kind: 'note', code: 'work_order_created', author: AUTHOR }), '23514');
    await fails(insertEvent(orderId, { kind: 'note', code: null, payload: { objectType: 'work_order' }, author: AUTHOR }), '23514');
    await insertEvent(orderId, { kind: 'note', code: null, payload: null, author: AUTHOR });
  });

  it('EVM-038 AC6 the origin stays tied to the kind: a client cannot write system for a note, nor an event as a person', async () => {
    const { orderId } = await insertOrder();
    await fails(
      sql`insert into timeline.timeline_entries (id, work_order_id, kind, note_category, body, origin, created_at, created_by)
        values (${uuidv7()}, ${orderId}, 'note', 'meeting', 'Treść', 'system', ${T}, ${AUTHOR})`.execute(admin()),
      '23514',
    );
    await fails(
      sql`insert into timeline.timeline_entries (id, work_order_id, kind, origin, created_at, created_by, event_code, event_payload)
        values (${uuidv7()}, ${orderId}, 'event', 'web', ${T}, ${AUTHOR}, 'work_order_created', '{}'::jsonb)`.execute(admin()),
      '23514',
    );
    // the entry of a person still has an author
    await fails(
      sql`insert into timeline.timeline_entries (id, work_order_id, kind, note_category, body, origin, created_at)
        values (${uuidv7()}, ${orderId}, 'note', 'meeting', 'Treść', 'web', ${T})`.execute(admin()),
      '23514',
    );
  });

  it('EVM-038 AC2 D3 the code and the payload of an event are append-only; DELETE and TRUNCATE stay refused', async () => {
    const { orderId } = await insertOrder();
    const id = uuidv7();
    await sql`insert into timeline.timeline_entries (id, work_order_id, kind, origin, created_at, created_by, event_code, event_payload)
      values (${id}, ${orderId}, 'event', 'system', ${T}, ${AUTHOR}, 'work_order_created', '{"objectType":"work_order"}'::jsonb)`.execute(
      admin(),
    );
    for (const set of [sql`event_code = 'stage_updated'`, sql`event_payload = '{"objectType":"procedure_stage"}'::jsonb`]) {
      await fails(sql`update timeline.timeline_entries set ${set} where id = ${id}`.execute(admin()), 'EV001');
      await fails(sql`update timeline.timeline_entries set ${set} where id = ${id}`.execute(app), 'EV001');
    }
    await fails(sql`delete from timeline.timeline_entries where id = ${id}`.execute(app), '42501');
    await fails(sql`truncate timeline.timeline_entries`.execute(app), '42501');
    // the function of the trigger is still not callable by PUBLIC (`create or replace` keeps the REVOKE)
    const { rows } = await sql<{ allowed: boolean }>`
      select has_function_privilege('public', 'timeline.reject_entry_change()', 'execute') as allowed`.execute(admin());
    expect(rows[0]?.allowed).toBe(false);
    // rows of 0020 are untouched: the columns are null for them and no event was backfilled
    const { rows: old } = await sql<{ n: string }>`
      select count(*)::text as n from timeline.timeline_entries where kind <> 'event' and (event_code is not null or event_payload is not null)`.execute(
      admin(),
    );
    expect(old[0]?.n).toBe('0');
  });
});

describe('migration 0042 - the redaction of an entry (EVM-040 AC2, AC5; ADR-0003; D3; expand only)', () => {
  const MARKER = 'Treść usunięta przez administratora 03.10.2026.';
  const redact = (id: string, body: string = MARKER, by: string | null = AUTHOR, at: string | null = T) =>
    sql`update timeline.timeline_entries set body = ${body}, redacted_at = ${at}, redacted_by = ${by}, version = version + 1
      where id = ${id}`.execute(app);
  const row = async (id: string) =>
    (
      await sql<{ body: string | null; redacted_at: Date | null; redacted_by: string | null; version: number; kind: string }>`
      select body, redacted_at, redacted_by, version, kind from timeline.timeline_entries where id = ${id}`.execute(admin())
    ).rows[0];

  it('EVM-040 AC2 the redaction replaces the text by the marker once, with its time and author; the metadata, the place and the other columns stay', async () => {
    const { orderId } = await insertOrder();
    const id = await insertEntry(orderId, { body: 'Numer dowodu: ABC 123456' });
    await redact(id);
    const redacted = await row(id);
    expect(redacted).toMatchObject({ body: MARKER, redacted_by: AUTHOR, version: 2 });
    expect(redacted?.redacted_at?.toISOString()).toBe('2026-10-11T08:00:00.000Z');
    // a repeated or changed redaction, an un-redaction and a later change of the text are refused - there is no way back
    await fails(redact(id, 'Treść usunięta przez administratora 04.10.2026.'), 'EV001');
    await fails(sql`update timeline.timeline_entries set body = 'Przywrócona treść' where id = ${id}`.execute(app), 'EV001');
    await fails(
      sql`update timeline.timeline_entries set redacted_at = null, redacted_by = null where id = ${id}`.execute(admin()),
      'EV001',
    );
    await fails(sql`update timeline.timeline_entries set redacted_by = ${uuidv7()} where id = ${id}`.execute(admin()), 'EV001');
    expect((await row(id))?.body).toBe(MARKER);
  });

  it('EVM-040 AC2 a text other than the marker, a marker without the time or the author, and a redaction that changes another column are refused (EV001)', async () => {
    const { orderId } = await insertOrder();
    const id = await insertEntry(orderId, { body: 'Treść do ochrony' });
    await fails(redact(id, 'Zupełnie inny tekst'), 'EV001');
    await fails(redact(id, MARKER, null), 'EV001');
    await fails(redact(id, MARKER, AUTHOR, null), 'EV001');
    await fails(
      sql`update timeline.timeline_entries set body = ${MARKER}, redacted_at = ${T}, redacted_by = ${AUTHOR}, origin = 'mobile' where id = ${id}`.execute(
        admin(),
      ),
      'EV001',
    );
    await fails(
      sql`update timeline.timeline_entries set body = ${MARKER}, redacted_at = ${T}, redacted_by = ${AUTHOR}, created_by = ${uuidv7()} where id = ${id}`.execute(
        admin(),
      ),
      'EV001',
    );
    await fails(
      sql`update timeline.timeline_entries set body = ${MARKER}, redacted_at = ${T}, redacted_by = ${AUTHOR}, note_category = 'meeting' where id = ${id}`.execute(
        admin(),
      ),
      'EV001',
    );
    expect(await row(id)).toMatchObject({ body: 'Treść do ochrony', redacted_at: null, version: 1 });
  });

  it('EVM-040 AC2 the pattern of the trigger equals the pattern of the application: the same strings pass, the same are refused', async () => {
    const { orderId } = await insertOrder();
    const candidates = [
      MARKER,
      'Treść usunięta przez administratora 31.12.2026.',
      'Treść usunięta przez administratora 3.10.2026.',
      'Treść usunięta przez administratora 03-10-2026.',
      'Treść usunięta przez administratora 03.10.2026',
      'Treść usunięta przez administratora 03.10.2026.\n',
      'Treść usunięta przez administratora 03.10.2026. Dodatek',
      ' Treść usunięta przez administratora 03.10.2026.',
      'Zawartość: Treść usunięta przez administratora 03.10.2026.',
      'Treść usunięta przez administratora 03a10b2026.',
      'treść usunięta przez administratora 03.10.2026.',
      'Treść usunięta przez administratora 03.10.20266.',
    ];
    for (const candidate of candidates) {
      const id = await insertEntry(orderId);
      const accepted = await redact(id, candidate).then(
        () => true,
        () => false,
      );
      expect(accepted, JSON.stringify(candidate)).toBe(REDACTION_MARKER_PATTERN.test(candidate));
    }
  });

  it('EVM-040 AC5 an event is never redacted nor soft deleted: the trigger and the CHECK refuse it; a note is soft deleted as before', async () => {
    const { orderId } = await insertOrder();
    const event = await insertEntry(orderId, { kind: 'event' });
    await fails(redact(event), 'EV001');
    await fails(
      sql`update timeline.timeline_entries set redacted_at = ${T}, redacted_by = ${AUTHOR} where id = ${event}`.execute(admin()),
      'EV001',
    );
    await fails(
      sql`update timeline.timeline_entries set deleted_at = ${T}, deleted_by = ${AUTHOR}, version = version + 1 where id = ${event}`.execute(
        app,
      ),
      '23514',
    );
    await fails(
      sql`insert into timeline.timeline_entries (id, work_order_id, kind, origin, created_at, created_by, event_code, event_payload, deleted_at, deleted_by)
        values (${uuidv7()}, ${orderId}, 'event', 'system', ${T}, ${AUTHOR}, 'work_order_created', '{"objectType":"work_order"}'::jsonb, ${T}, ${AUTHOR})`.execute(
        admin(),
      ),
      '23514',
    );
    const note = await insertEntry(orderId);
    await sql`update timeline.timeline_entries set deleted_at = ${T}, deleted_by = ${AUTHOR}, version = version + 1 where id = ${note}`.execute(
      app,
    );
    // the soft delete of a redacted entry and its restoration stay possible (the marker stays)
    const redacted = await insertEntry(orderId);
    await redact(redacted);
    await sql`update timeline.timeline_entries set deleted_at = ${T}, deleted_by = ${AUTHOR}, version = version + 1 where id = ${redacted}`.execute(
      app,
    );
    await sql`update timeline.timeline_entries set deleted_at = null, deleted_by = null, version = version + 1 where id = ${redacted}`.execute(
      app,
    );
    expect(await row(redacted)).toMatchObject({ body: MARKER, version: 4 });
  });
});

describe('migration 0056 — the device of an entry from the phone (EVM-098 AC2, AC4; SR-SYNC-03; expand only)', () => {
  const MARKER = 'Treść usunięta przez administratora 31.10.2026.';
  const row = async (id: string) =>
    (await sql<{ body: string; version: number }>`select body, version from timeline.timeline_entries where id = ${id}`.execute(admin()))
      .rows[0];
  const insertWithDevice = (orderId: string, origin: string, deviceId: string | null, id: string = uuidv7()) =>
    sql`insert into timeline.timeline_entries
        (id, work_order_id, kind, note_category, body, origin, created_at, created_by, created_via_device_id)
      values (${id}, ${orderId}, 'comment', null, 'Treść syntetyczna', ${origin}, ${T}, ${AUTHOR}, ${deviceId})`.execute(app);

  it('EVM-098 AC2 an entry from the phone has the device of the session and only such an entry has one; there is no foreign key to the register of devices', async () => {
    const { orderId } = await insertOrder();
    const device = uuidv7();
    // a device that is not (or no longer) in identity.devices: no foreign key, the identifier is kept as long as the entry
    await insertWithDevice(orderId, 'mobile', device);
    await fails(insertWithDevice(orderId, 'mobile', null), '23514');
    await fails(insertWithDevice(orderId, 'web', device), '23514');
    // N-1 writes the panel's entries without naming the column
    await insertEntry(orderId);
    const { rows } = await sql<{ n: string }>`
      select count(*)::text as n from pg_constraint
      where conrelid = 'timeline.timeline_entries'::regclass and contype = 'f'
        and pg_get_constraintdef(oid) like '%created_via_device_id%'`.execute(admin());
    expect(rows[0]?.n).toBe('0');
    const { rows: valid } = await sql<{ convalidated: boolean }>`
      select convalidated from pg_constraint where conname = 'timeline_entries_device_of_mobile'`.execute(admin());
    expect(valid[0]?.convalidated).toBe(true);
  });

  it('EVM-098 AC4 the device of an entry cannot be changed nor removed; the soft delete and the redaction of an entry from the phone still work', async () => {
    const { orderId } = await insertOrder();
    const id = uuidv7();
    await insertWithDevice(orderId, 'mobile', uuidv7(), id);
    await fails(sql`update timeline.timeline_entries set created_via_device_id = ${uuidv7()} where id = ${id}`.execute(app), 'EV001');
    await fails(sql`update timeline.timeline_entries set created_via_device_id = null where id = ${id}`.execute(admin()), 'EV001');
    await sql`update timeline.timeline_entries set body = ${MARKER}, redacted_at = ${T}, redacted_by = ${AUTHOR}, version = version + 1
      where id = ${id}`.execute(app);
    await sql`update timeline.timeline_entries set deleted_at = ${T}, deleted_by = ${AUTHOR}, version = version + 1 where id = ${id}`.execute(
      app,
    );
    expect(await row(id)).toMatchObject({ body: MARKER, version: 3 });
  });

  it('EVM-098 AC8 the audit trail takes the device, the order and the type of the command all together or none, and a type of a closed list only', async () => {
    const event = (device: string | null, order: string | null, command: string | null) =>
      sql`insert into audit.events (occurred_at, actor_type, origin, action, outcome, object_type, trace_id, device_id, work_order_id, command_type)
        values (now(), 'system', 'web', 'sync.mutation_applied', 'success', 'timeline_entry', ${'0'.repeat(32)}, ${device}, ${order}, ${command})`.execute(
        admin(),
      );
    await event(uuidv7(), uuidv7(), 'CreateNote');
    await event(uuidv7(), uuidv7(), 'CreateComment');
    await event(null, null, null);
    await fails(event(uuidv7(), uuidv7(), 'DeleteEverything'), '23514');
    await fails(event(uuidv7(), null, 'CreateNote'), '23514');
    await fails(event(null, uuidv7(), 'CreateNote'), '23514');
    await fails(event(uuidv7(), uuidv7(), null), '23514');
  });
});

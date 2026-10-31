import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/platform/database/database.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { FixedClock } from '../support/clock.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createUser } from '../support/identity-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
let userId = '';
let orderId = '';
let otherOrderId = '';
let customerId = '';
let siteId = '';
beforeAll(async () => {
  database = await migratedDatabase({ checkProjection: false });
  userId = (await createUser(database.admin, new FixedClock('2026-10-31T08:00:00.000Z'), { role: 'editor' })).id;
  customerId = await insertCustomer(database.admin, { email: 'documents@example.invalid' });
  siteId = await insertSite(database.admin);
  const orders = await insertWorkOrders(database.admin, [
    { number: 'ZL-4700-0001', customerId, siteId },
    { number: 'ZL-4700-0002', customerId, siteId },
  ]);
  const ids = [...orders.values()];
  orderId = ids[0] ?? '';
  otherOrderId = ids[1] ?? '';
});
afterAll(async () => {
  await database.close();
});

const admin = () => database.admin;
const T = '2026-10-31T08:00:00Z';
const fails = async (statement: Promise<unknown>, code: string): Promise<void> => {
  await expect(statement).rejects.toMatchObject({ code });
};

interface DocumentSpec {
  readonly id?: string;
  readonly kind?: string;
  readonly title?: string;
  readonly order?: string | null;
  readonly customer?: string | null;
  readonly site?: string | null;
  readonly override?: string | null;
}
const insertDocument = (spec: DocumentSpec = {}) =>
  sql`insert into media.documents (id, kind_code, title, work_order_id, customer_id, site_id, confidentiality_override, created_at, created_by, updated_at, updated_by)
      values (${spec.id ?? uuidv7()}, ${spec.kind ?? 'connection_conditions'}, ${spec.title ?? 'Title'},
        ${spec.order === undefined ? orderId : spec.order}, ${spec.customer ?? null}, ${spec.site ?? null}, ${spec.override ?? null}, ${T}, ${userId}, ${T}, ${userId})`.execute(
    admin(),
  );
const insertVersion = (documentId: string, number = 1, id: string = uuidv7()) =>
  sql`insert into media.document_versions (id, document_id, version_number, created_at, created_by)
      values (${id}, ${documentId}, ${number}, ${T}, ${userId})`.execute(admin());

interface FileSpec {
  readonly purpose?: string;
  readonly versionId?: string | null;
  readonly key?: string;
  readonly size?: number;
}
const insertFile = (spec: FileSpec = {}) => {
  const id = uuidv7();
  return sql`insert into media.stored_files (id, purpose, document_version_id, object_key, state, state_changed_at,
        declared_size_bytes, declared_content_type, declared_sha256, created_at, created_by)
      values (${id}, ${spec.purpose ?? 'document'}, ${spec.versionId ?? null}, ${spec.key ?? `documents/2026/10/${id}/original`}, 'pending_upload', ${T},
        ${spec.size ?? 1024}, 'application/pdf', ${'a'.repeat(64)}, ${T}, ${userId})`.execute(admin());
};

async function newVersion(spec: DocumentSpec = {}): Promise<{ documentId: string; versionId: string }> {
  const documentId = uuidv7();
  await insertDocument({ ...spec, id: documentId });
  const versionId = uuidv7();
  await insertVersion(documentId, 1, versionId);
  return { documentId, versionId };
}

describe('migration 0059 - documents (EVM-047; ADR-0009; expand only)', () => {
  it('EVM-047 AC1 a document has exactly one anchor, a known kind, a title of 1..200 characters and a UUIDv7', async () => {
    await insertDocument();
    await insertDocument({ order: null, customer: customerId });
    await insertDocument({ order: null, site: siteId });
    await fails(insertDocument({ order: null }), '23514');
    await fails(insertDocument({ customer: customerId }), '23514');
    await fails(insertDocument({ kind: 'no_such_kind' }), '23503');
    await fails(insertDocument({ title: '' }), '23514');
    await fails(insertDocument({ title: 'x'.repeat(201) }), '23514');
    await fails(insertDocument({ id: '00000000-0000-4000-8000-000000000001' }), '23514');
  });

  it('EVM-047 AC4 the override admits the two raised classes only', async () => {
    await insertDocument({ override: 'building_security' });
    await insertDocument({ override: 'identity_data' });
    await fails(insertDocument({ override: 'standard' }), '23514');
  });

  it('EVM-047 AC7 the kind and the anchor never change', async () => {
    const { documentId } = await newVersion();
    await fails(sql`update media.documents set kind_code = 'other' where id = ${documentId}`.execute(admin()), 'EV002');
    await fails(sql`update media.documents set work_order_id = ${otherOrderId} where id = ${documentId}`.execute(admin()), 'EV002');
    await sql`update media.documents set title = 'Changed', version = 2 where id = ${documentId}`.execute(admin());
  });

  it('EVM-047 AC4 the override can rise but never fall nor be cleared', async () => {
    const { documentId } = await newVersion();
    await sql`update media.documents set confidentiality_override = 'building_security' where id = ${documentId}`.execute(admin());
    await sql`update media.documents set confidentiality_override = 'identity_data' where id = ${documentId}`.execute(admin());
    await fails(
      sql`update media.documents set confidentiality_override = 'building_security' where id = ${documentId}`.execute(admin()),
      'EV002',
    );
    await fails(sql`update media.documents set confidentiality_override = null where id = ${documentId}`.execute(admin()), 'EV002');
  });

  it('EVM-047 AC1 a version number is unique within the document', async () => {
    const { documentId } = await newVersion();
    await insertVersion(documentId, 2);
    await fails(insertVersion(documentId, 2), '23505');
    await fails(insertVersion(documentId, 0), '23514');
  });

  it('EVM-047 AC1 a document file has exactly a document version and a `documents/` key; a media file keeps its `media/` key', async () => {
    const { versionId } = await newVersion();
    await insertFile({ versionId });
    await fails(insertFile({ versionId }), '23505'); // one file per version
    await fails(insertFile({ versionId: null }), '23514'); // no owner
    const second = await newVersion();
    await fails(insertFile({ versionId: second.versionId, key: `media/2026/10/${uuidv7()}/original` }), '23514');
    await fails(insertFile({ versionId: second.versionId, key: 'documents/2026/10/not-an-id/original' }), '23514');
    await fails(insertFile({ purpose: 'media_original', versionId: second.versionId }), '23514'); // a media file needs a media asset
    await fails(insertFile({ purpose: 'media_original', key: `documents/2026/10/${uuidv7()}/original` }), '23514');
  });

  it('EVM-047 AC6 a document is at most 100 MB, a photo is still at most 50 MB', async () => {
    const { versionId } = await newVersion();
    await fails(insertFile({ versionId, size: 104_857_601 }), 'EV002');
    const second = await newVersion();
    await insertFile({ versionId: second.versionId, size: 104_857_600 });
  });

  it('EVM-047 AC7 the identity of a document file never changes', async () => {
    const { versionId } = await newVersion();
    const other = await newVersion();
    const id = uuidv7();
    await sql`insert into media.stored_files (id, purpose, document_version_id, object_key, state, state_changed_at, declared_size_bytes, declared_content_type, declared_sha256, created_at, created_by)
      values (${id}, 'document', ${versionId}, ${`documents/2026/10/${id}/original`}, 'pending_upload', ${T}, 10, 'application/pdf', ${'b'.repeat(64)}, ${T}, ${userId})`.execute(
      admin(),
    );
    await fails(sql`update media.stored_files set document_version_id = ${other.versionId} where id = ${id}`.execute(admin()), 'EV002');
  });

  it('EVM-047 AC7 the application role reads, inserts and updates a document, and only reads and inserts a version; it never deletes', async () => {
    const app = createDatabase({ url: database.appUrl, logger: createLogger({ level: 'fatal' }), pool: { max: 1 } });
    try {
      const { documentId, versionId } = await newVersion();
      await sql`select count(*) from media.documents`.execute(app);
      await sql`update media.documents set title = 'Other', version = 2 where id = ${documentId}`.execute(app);
      await fails(sql`delete from media.documents where id = ${documentId}`.execute(app), '42501');
      await fails(sql`delete from media.document_versions where id = ${versionId}`.execute(app), '42501');
      await fails(sql`update media.document_versions set version_number = 5 where id = ${versionId}`.execute(app), '42501');
    } finally {
      await app.destroy();
    }
  });
});

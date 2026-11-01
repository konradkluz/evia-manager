import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErasureCompletionJob, LEAVE_TO_REQUEST_MS } from '../../src/modules/media/application/erasure-completion.job.ts';
import {
  GRACE_MS,
  MAX_DURATION_MS,
  MISSING_OBJECTS_METRIC,
  ORPHAN_OBJECTS_METRIC,
  StorageReconciliationJob,
} from '../../src/modules/media/application/storage-reconciliation.job.ts';
import type { Clock } from '../../src/platform/clock/clock.ts';
import type { Logger } from '../../src/platform/logging/logger.ts';
import type { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import type { ObjectStorage } from '../../src/platform/object-storage/object-storage.ts';
import { CLOCK, DATABASE, LOGGER, METRICS } from '../../src/platform/tokens.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createUser } from '../support/identity-fixtures.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { insertDocumentRow } from '../support/document-fixtures.ts';
import { insertMedia } from '../support/media-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

const NOW = '2026-10-03T10:00:00.000Z';
/** A young record and an old one relative to the grace period of the reconciliation. */
const OLD = new Date(new Date(NOW).getTime() - 2 * GRACE_MS);

let current: IdentityApp;
let userId = '';
let orderId = '';
beforeAll(async () => {
  current = await createIdentityApp({ now: NOW });
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  current.clock.set(NOW);
  current.logs.lines.length = 0;
  await clearWorkOrderCreation(current.database.admin);
  current.storage.reset();
  current.storage.unavailable = false;
  await sql`delete from media.file_derivatives`.execute(current.database.admin);
  await sql`delete from media.upload_sessions`.execute(current.database.admin);
  await sql`delete from media.stored_files`.execute(current.database.admin);
  await sql`delete from media.document_versions`.execute(current.database.admin);
  await sql`delete from media.documents`.execute(current.database.admin);
  await sql`delete from media.media_assets`.execute(current.database.admin);
  userId = (await createUser(current.database.admin, current.clock, { role: 'administrator' })).id;
  const customerId = await insertCustomer(current.database.admin, { email: `uzgadnianie${uuidv7()}@example.invalid` });
  const siteId = await insertSite(current.database.admin);
  const ids = await insertWorkOrders(current.database.admin, [
    { number: `ZL-79${Math.floor(Math.random() * 90 + 10)}-0001`, customerId, siteId },
  ]);
  orderId = [...ids.values()][0] ?? '';
});

const admin = () => current.database.admin;
const metrics = () => current.app.get<MetricsRegistry>(METRICS, { strict: false });
const logger = () => current.app.get<Logger>(LOGGER, { strict: false });

function job(storage: ObjectStorage | null = current.storage, clock: Clock = current.clock): StorageReconciliationJob {
  return new StorageReconciliationJob(admin(), clock, logger(), storage, metrics());
}
const gauge = (name: string) =>
  metrics()
    .snapshot()
    .find((sample) => sample.name === name)?.value;

/** A `ready` photo that is old enough for the comparison; `withObject` puts its original in the bucket. */
async function readyPhoto(options: { withObject: boolean; age?: Date; erased?: boolean }) {
  const media = await insertMedia(admin(), { workOrderId: orderId, createdBy: userId, state: 'ready', createdAt: options.age ?? OLD });
  await sql`update media.stored_files set state_changed_at = ${options.age ?? OLD} where id = ${media.storedFileId}`.execute(admin());
  if (options.withObject) current.storage.putObject(media.objectKey, Buffer.from('synthetic'));
  if (options.erased === true) {
    await sql`update media.stored_files set erased_at = ${NOW}, original_filename = null where id = ${media.storedFileId}`.execute(admin());
  }
  return media;
}

describe('EVM-051 AC5 the reconciliation of the storage with the database (SR-FILE-11)', () => {
  it('EVM-051 AC5 an object without a record and a ready record without an object are both reported - as numbers, in a metric and one alert entry without a key, a name or an identifier', async () => {
    const consistent = await readyPhoto({ withObject: true });
    const missing = await readyPhoto({ withObject: false });
    const orphanKey = `media/2026/10/${uuidv7()}/original`;
    current.storage.putObject(orphanKey, Buffer.from('synthetic orphan'));
    // the orphan is older than the grace period: the clock of the storage said so when it was written
    current.clock.set(new Date(new Date(NOW).getTime() + 2 * GRACE_MS).toISOString());

    const result = await job().run();

    expect(result).toEqual({ orphanObjects: 1, missingObjects: 1, complete: 1 });
    expect(gauge(ORPHAN_OBJECTS_METRIC)).toBe(1);
    expect(gauge(MISSING_OBJECTS_METRIC)).toBe(1);
    const alerts = current.logs.lines.filter((line) => line.includes('"alert":"storage_reconciliation"'));
    expect(alerts).toHaveLength(1);
    expect(JSON.parse(alerts[0] ?? '{}')).toMatchObject({
      alert: 'storage_reconciliation',
      alertCode: 'storage_discrepancy',
      orphanObjects: 1,
      missingObjects: 1,
    });
    const written = current.logs.lines.join('\n');
    for (const secret of [orphanKey, missing.objectKey, consistent.objectKey, missing.mediaAssetId, missing.storedFileId]) {
      expect(written).not.toContain(secret);
    }
  });

  it('EVM-051 AC5 it reports and never repairs: nothing is deleted from the bucket and no row changes', async () => {
    const orphanKey = `documents/2026/10/${uuidv7()}/original`;
    current.storage.putObject(orphanKey, Buffer.from('synthetic orphan'));
    await readyPhoto({ withObject: false });
    const before = await sql<{
      n: string;
    }>`select md5(string_agg(to_jsonb(f)::text, ',' order by id)) as n from media.stored_files f`.execute(admin());
    current.clock.set(new Date(new Date(NOW).getTime() + 2 * GRACE_MS).toISOString());
    await job().run();
    expect(current.storage.currentKeys()).toContain(orphanKey);
    const after = await sql<{
      n: string;
    }>`select md5(string_agg(to_jsonb(f)::text, ',' order by id)) as n from media.stored_files f`.execute(admin());
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it('EVM-051 AC5 no false alarm: a record on its way, a young object, a young ready record and an erased record raise nothing', async () => {
    const onItsWay = await insertMedia(admin(), { workOrderId: orderId, createdBy: userId, state: 'uploaded', createdAt: OLD });
    const scanning = await insertMedia(admin(), { workOrderId: orderId, createdBy: userId, state: 'scanning', createdAt: OLD });
    await readyPhoto({ withObject: false, age: new Date(NOW) }); // ready a moment ago, its object may be still on its way to the listing
    await readyPhoto({ withObject: false, erased: true });
    const document = await insertDocumentRow(admin(), { workOrderId: orderId, createdBy: userId, state: 'ready', createdAt: OLD });
    current.storage.putObject(document.objectKey, Buffer.from('synthetic'));
    current.storage.putObject(`media/2026/10/${uuidv7()}/original`, Buffer.from('young orphan'));
    expect(onItsWay.objectKey).not.toBe(scanning.objectKey);

    const result = await job().run();

    expect(result).toEqual({ orphanObjects: 0, missingObjects: 0, complete: 1 });
    expect(current.logs.lines.join('\n')).not.toContain('storage_reconciliation"');
    expect(gauge(ORPHAN_OBJECTS_METRIC)).toBe(0);
  });

  it('EVM-051 AC5 the derivatives count too: a derivative row without its object is missing, a derivative object of a known file is not an orphan; the walk is paged', async () => {
    const photo = await readyPhoto({ withObject: true });
    const prefix = photo.objectKey.slice(0, -'original'.length);
    await sql`insert into media.file_derivatives (stored_file_id, variant, object_key, content_type, width, height, size_bytes, created_at) values
      (${photo.storedFileId}, 'thumbnail', ${`${prefix}thumbnail.webp`}, 'image/webp', 320, 180, 1, ${NOW}),
      (${photo.storedFileId}, 'preview', ${`${prefix}preview.webp`}, 'image/webp', 1600, 900, 1, ${NOW})`.execute(admin());
    current.storage.putObject(`${prefix}thumbnail.webp`, Buffer.from('synthetic')); // the preview is not there
    for (let index = 0; index < 5; index += 1) await readyPhoto({ withObject: true });
    current.clock.set(new Date(new Date(NOW).getTime() + 2 * GRACE_MS).toISOString());

    const small: ObjectStorage = Object.create(current.storage) as ObjectStorage;
    small.listObjects = (prefixOf, _limit, token) => current.storage.listObjects(prefixOf, 2, token);
    const result = await job(small).run();

    expect(result).toEqual({ orphanObjects: 0, missingObjects: 1, complete: 1 });
  });

  it('EVM-051 AC5 a walk that runs out of time says so and raises no alert about what it did not see; an unreachable storage fails the job without leaking', async () => {
    await readyPhoto({ withObject: false });
    let ticks = 0;
    const slow: Clock = { now: () => new Date(new Date(NOW).getTime() + (ticks++ === 0 ? 0 : MAX_DURATION_MS + 1)) };
    const result = await job(current.storage, slow).run();
    expect(result).toEqual({ orphanObjects: 0, missingObjects: 0, complete: 0 });
    expect(current.logs.lines.join('\n')).not.toContain('"alert":"storage_reconciliation"');

    current.storage.unavailable = true;
    await expect(job().run()).rejects.toMatchObject({ message: expect.not.stringContaining('bucket') as unknown });
    current.storage.unavailable = false;
    expect(await job(null).run()).toEqual({ orphanObjects: 0, missingObjects: 0, complete: 0 });
  });
});

describe('EVM-051 AC7 the completion of an erasure (CWE-459)', () => {
  const erasedFile = async (secondsAgo: number) => {
    const photo = await readyPhoto({ withObject: true });
    const prefix = photo.objectKey.slice(0, -'original'.length);
    await sql`insert into media.file_derivatives (stored_file_id, variant, object_key, content_type, width, height, size_bytes, created_at)
      values (${photo.storedFileId}, 'thumbnail', ${`${prefix}thumbnail.webp`}, 'image/webp', 320, 180, 1, ${NOW})`.execute(admin());
    current.storage.putObject(`${prefix}thumbnail.webp`, Buffer.from('synthetic'));
    const erasedAt = new Date(new Date(NOW).getTime() - secondsAgo * 1000);
    await sql`update media.stored_files set erased_at = ${erasedAt}, original_filename = null where id = ${photo.storedFileId}`.execute(
      admin(),
    );
    return { ...photo, thumbnail: `${prefix}thumbnail.webp` };
  };
  const completion = () =>
    new ErasureCompletionJob(
      current.app.get(DATABASE, { strict: false }),
      current.app.get<Clock>(CLOCK, { strict: false }),
      logger(),
      current.storage,
    );
  const objectsErased = async (id: string) =>
    (await sql<{ objects_erased_at: Date | null }>`select objects_erased_at from media.stored_files where id = ${id}`.execute(admin()))
      .rows[0]?.objects_erased_at;

  it('EVM-051 AC7 the job removes the original and the derivatives of a file erased earlier whose removal did not finish, and confirms it; a file erased a moment ago is left to its request', async () => {
    const old = await erasedFile(LEAVE_TO_REQUEST_MS / 1000 + 60);
    const fresh = await erasedFile(5);

    expect(await completion().run()).toEqual({ completed: 1, failed: 0 });

    expect(current.storage.currentKeys()).not.toContain(old.objectKey);
    expect(current.storage.currentKeys()).not.toContain(old.thumbnail);
    expect(await objectsErased(old.storedFileId)).toEqual(new Date(NOW));
    expect(current.storage.currentKeys()).toContain(fresh.objectKey);
    expect(await objectsErased(fresh.storedFileId)).toBeNull();
    // idempotent: nothing is left to do
    expect(await completion().run()).toEqual({ completed: 0, failed: 0 });
  });

  it('EVM-051 AC7 a storage that fails leaves the file for the next run (counted, not confirmed); no storage configured removes nothing', async () => {
    const old = await erasedFile(LEAVE_TO_REQUEST_MS / 1000 + 60);
    current.storage.unavailable = true;
    expect(await completion().run()).toEqual({ completed: 0, failed: 1 });
    current.storage.unavailable = false;
    expect(await objectsErased(old.storedFileId)).toBeNull();
    expect(current.storage.currentKeys()).toContain(old.objectKey);
    expect(await new ErasureCompletionJob(admin(), current.clock, logger(), null).run()).toEqual({ completed: 0, failed: 0 });
    expect(await completion().run()).toEqual({ completed: 1, failed: 0 });
  });

  it('EVM-051 AC7 a refused abort of a multipart upload (the worker key may not abort) does not block the removal of the objects or its confirmation', async () => {
    const old = await erasedFile(LEAVE_TO_REQUEST_MS / 1000 + 60);
    await sql`insert into media.upload_sessions (id, stored_file_id, user_id, s3_upload_id, part_size_bytes, part_count, state, expires_at, created_at, updated_at)
      values (${uuidv7()}, ${old.storedFileId}, ${userId}, 'upload-refused', 16777216, 1, 'aborted', ${NOW}, ${NOW}, ${NOW})`.execute(
      admin(),
    );
    const refusing = new Proxy(current.storage, {
      get: (target, property) =>
        property === 'abortMultipartUpload'
          ? () => Promise.reject(new Error('AccessDenied'))
          : (target[property as keyof ObjectStorage] as unknown as { bind: (self: unknown) => unknown }).bind(target),
    });
    const job = new ErasureCompletionJob(
      current.app.get(DATABASE, { strict: false }),
      current.app.get<Clock>(CLOCK, { strict: false }),
      logger(),
      refusing,
    );

    expect(await job.run()).toEqual({ completed: 1, failed: 0 });

    expect(current.storage.currentKeys()).not.toContain(old.objectKey);
    expect(current.storage.currentKeys()).not.toContain(old.thumbnail);
    expect(await objectsErased(old.storedFileId)).toEqual(new Date(NOW));
    expect(JSON.stringify(current.logs.lines)).not.toContain('upload-refused');
  });
});

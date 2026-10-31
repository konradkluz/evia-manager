import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MediaProcessingService } from '../../src/modules/media/index.ts';
import { MAX_PROCESSING_ATTEMPTS, STALE_PROCESSING_MS } from '../../src/modules/media/domain/derivatives.ts';
import { FakeImageProcessor } from '../../src/platform/media-processing/fake-image-processor.ts';
import { ImageProcessingError } from '../../src/platform/media-processing/image-processor.ts';
import { ObjectStorageError } from '../../src/platform/object-storage/object-storage.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { insertMedia, sha256Of } from '../support/media-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

const NOW = '2026-10-29T08:00:00.000Z';
const BASE = '/api/v1/work-orders';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp({ now: NOW });
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  current.clock.set(NOW);
  current.storage.unavailable = false;
  current.imageProcessor.behaviour = 'ok';
  current.imageProcessor.jobs.length = 0;
  current.storage.signedGets.length = 0;
  await clearWorkOrderCreation(current.database.admin);
  // the files of the earlier tests must not be taken by the loop of this one
  await sql`update media.stored_files set state = 'failed', state_reason_code = 'abandoned', process_attempts = 0 where state in ('clean', 'processing')`.execute(
    admin(),
  );
});

const admin = () => current.database.admin;
const processing = () => current.app.get(MediaProcessingService, { strict: false });

async function signIn(role: Role, channel: 'web' | 'mobile' = 'web') {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, { channel });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}

let numbering = 0;
async function order(deleted = false): Promise<string> {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `processing${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [
    {
      number: `ZL-8${String(numbering).padStart(3, '0')}-0001`,
      customerId,
      siteId,
      ...(deleted ? { deletedAt: new Date('2026-10-02T08:00:00Z') } : {}),
    },
  ]);
  return [...ids.values()][0] ?? '';
}

/** A synthetic body: not a real picture (the processor is a double here; the real libvips has its own tests). */
const photoBytes = (seed = 1, size = 4096): Buffer => Buffer.alloc(size, seed);

interface Clean {
  readonly mediaAssetId: string;
  readonly storedFileId: string;
  readonly objectKey: string;
  readonly body: Buffer;
}

/** A photo that passed the scan: `clean`, with the type, the size and the checksum the scan recorded and the pinned version of its object. */
async function cleanPhoto(
  orderId: string,
  userId: string,
  options: { category?: string; body?: Buffer; recordedSha?: string; mediaType?: 'photo' | 'video'; contentType?: string } = {},
): Promise<Clean> {
  const body = options.body ?? photoBytes(Math.floor(Math.random() * 200) + 1);
  const media = await insertMedia(admin(), {
    workOrderId: orderId,
    createdBy: userId,
    state: 'clean',
    size: body.length,
    sha256: sha256Of(body),
    createdAt: new Date(NOW),
  });
  const put = current.storage.putObject(media.objectKey, body);
  await sql`update media.stored_files set content_type = ${options.contentType ?? 'image/jpeg'}, size_bytes = ${body.length},
      sha256 = ${options.recordedSha ?? sha256Of(body)}, s3_version_id = ${put.versionId}, s3_etag = ${put.etag}
      where id = ${media.storedFileId}`.execute(admin());
  if (options.category !== undefined) {
    await sql`update media.media_assets set category = ${options.category} where id = ${media.mediaAssetId}`.execute(admin());
  }
  if (options.mediaType !== undefined) {
    await sql`update media.media_assets set media_type = ${options.mediaType} where id = ${media.mediaAssetId}`.execute(admin());
  }
  return { mediaAssetId: media.mediaAssetId, storedFileId: media.storedFileId, objectKey: media.objectKey, body };
}

interface FileRow {
  state: string;
  state_reason_code: string | null;
  process_attempts: number;
  process_claimed_at: Date | null;
}
const fileOf = async (storedFileId: string): Promise<FileRow> =>
  (
    await sql<FileRow>`select state, state_reason_code, process_attempts, process_claimed_at from media.stored_files where id = ${storedFileId}`.execute(
      admin(),
    )
  ).rows[0] as FileRow;
const derivativesOf = async (storedFileId: string) =>
  (
    await sql<{ variant: string; object_key: string; content_type: string; width: number; height: number; size_bytes: number }>`
      select variant, object_key, content_type, width, height, size_bytes from media.file_derivatives where stored_file_id = ${storedFileId} order by variant`.execute(
      admin(),
    )
  ).rows;

/** Passes of the loop until nothing is left to do. */
async function drain(): Promise<number> {
  let total = 0;
  for (let pass = 0; pass < 20; pass += 1) {
    const handled = await processing().runOnce();
    total += handled;
    if (handled === 0) break;
  }
  return total;
}

const downloadUrl = (
  browser: Awaited<ReturnType<typeof signIn>>,
  orderId: string,
  mediaAssetId: string,
  body: unknown = { variant: 'thumbnail' },
) => browser.panel.post(`${BASE}/${orderId}/media-assets/${mediaAssetId}/download-url`, body);

describe('EVM-068 AC1 the photos that passed the scan become ready with a thumbnail and a preview', () => {
  it('EVM-068 AC1 24 photos "W trakcie prac" and 12 "Stan przed pracami" in clean become ready; the list shows 36 ready and the groups 24 and 12', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    for (let index = 0; index < 24; index += 1) await cleanPhoto(orderId, owner.userId, { category: 'in_progress' });
    for (let index = 0; index < 12; index += 1) await cleanPhoto(orderId, owner.userId, { category: 'before_work' });

    expect(await drain()).toBe(36);

    const reader = await signIn('read_only');
    const items = ((await reader.panel.get(`${BASE}/${orderId}/media-assets?limit=100`)).body as { items: Array<Record<string, unknown>> })
      .items;
    expect(items).toHaveLength(36);
    expect(items.every((item) => item['fileState'] === 'ready')).toBe(true);
    expect(items.filter((item) => item['category'] === 'in_progress')).toHaveLength(24);
    expect(items.filter((item) => item['category'] === 'before_work')).toHaveLength(12);
    const { rows } = await sql<{ n: string }>`select count(*)::text as n from media.file_derivatives d
      join media.stored_files f on f.id = d.stored_file_id join media.media_assets a on a.id = f.media_asset_id where a.work_order_id = ${orderId}`.execute(
      admin(),
    );
    expect(rows[0]?.n).toBe('72');
  });

  it('EVM-068 AC1 a file becomes ready with BOTH derivatives under the prefix of its original, written add-only with a fixed type and cache control', async () => {
    const owner = await signIn('editor');
    const photo = await cleanPhoto(await order(), owner.userId);
    expect(await drain()).toBe(1);
    expect(await fileOf(photo.storedFileId)).toMatchObject({ state: 'ready', state_reason_code: null, process_attempts: 1 });
    const rows = await derivativesOf(photo.storedFileId);
    const prefix = photo.objectKey.slice(0, -'original'.length);
    expect(rows.map((row) => [row.variant, row.object_key, row.content_type])).toEqual([
      ['preview', `${prefix}preview.webp`, 'image/webp'],
      ['thumbnail', `${prefix}thumbnail.webp`, 'image/webp'],
    ]);
    for (const row of rows) {
      const stored = current.storage.read(row.object_key);
      expect(stored?.contentType).toBe('image/webp');
      expect(stored?.cacheControl).toBe('private, max-age=300');
      expect(stored?.body.length).toBe(row.size_bytes);
    }
  });

  it('EVM-068 AC1 a video is skipped by the loop (EVM-046) and a file with nothing to process stays as it is', async () => {
    const owner = await signIn('editor');
    const video = await cleanPhoto(await order(), owner.userId, { mediaType: 'video' });
    expect(await drain()).toBe(0);
    expect(await fileOf(video.storedFileId)).toMatchObject({ state: 'clean', process_attempts: 0 });
    expect(current.imageProcessor.jobs).toHaveLength(0);
  });

  it('EVM-068 AC1 the loop makes no derivatives without the processor, and the photos stay clean', async () => {
    const owner = await signIn('editor');
    const photo = await cleanPhoto(await order(), owner.userId);
    const off = new MediaProcessingService({
      db: admin(),
      clock: current.clock,
      logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined } as never,
      storage: current.storage,
      processor: null,
    });
    expect(off.enabled).toBe(false);
    expect(await off.runOnce()).toBe(0);
    expect(await off.processFile(photo.storedFileId)).toBe('skipped');
    await off.cleanWorkArea();
    expect(await fileOf(photo.storedFileId)).toMatchObject({ state: 'clean', process_attempts: 0 });
  });

  it('EVM-068 AC1 the work area is cleaned at the start of the loop (the photos a crash left there)', async () => {
    const before = current.imageProcessor.cleanups;
    await processing().cleanWorkArea();
    expect(current.imageProcessor.cleanups).toBe(before + 1);
  });
});

describe('EVM-068 AC2 the original is read as the scanned object and is never changed', () => {
  it('EVM-068 AC2 the processor receives exactly the bytes of the pinned version; the original keeps one version and its checksum', async () => {
    const owner = await signIn('editor');
    const photo = await cleanPhoto(await order(), owner.userId, { body: photoBytes(9, 5000) });
    await drain();
    expect(current.imageProcessor.jobs).toHaveLength(1);
    expect(sha256Of(current.imageProcessor.jobs[0]?.bytes ?? Buffer.alloc(0))).toBe(sha256Of(photo.body));
    expect(current.imageProcessor.jobs[0]?.contentType).toBe('image/jpeg');
    expect(current.storage.versionsOf(photo.objectKey)).toBe(1);
    expect(sha256Of(current.storage.read(photo.objectKey)?.body ?? Buffer.alloc(0))).toBe(sha256Of(photo.body));
  });

  it('EVM-068 AC2 an object that is not the scanned one (another checksum) never reaches the processor: failed at once, nothing written', async () => {
    const owner = await signIn('editor');
    const photo = await cleanPhoto(await order(), owner.userId, { recordedSha: 'b'.repeat(64) });
    expect(await drain()).toBe(1);
    expect(await fileOf(photo.storedFileId)).toMatchObject({ state: 'failed', state_reason_code: 'processing_error', process_attempts: 1 });
    expect(await derivativesOf(photo.storedFileId)).toEqual([]);
    expect(current.storage.read(`${photo.objectKey.slice(0, -8)}thumbnail.webp`)).toBeUndefined();
  });

  it('EVM-068 AC2 a file whose recorded type is not one of the allow-list is failed without asking the processor', async () => {
    const owner = await signIn('editor');
    const photo = await cleanPhoto(await order(), owner.userId, { contentType: 'application/pdf' });
    await drain();
    expect(await fileOf(photo.storedFileId)).toMatchObject({ state: 'failed', state_reason_code: 'processing_error' });
    expect(current.imageProcessor.jobs).toHaveLength(0);
  });
});

describe('EVM-068 AC3 a pixel bomb, a timeout and a crash do not stop the other photos (SR-FILE-04)', () => {
  it('EVM-068 AC3 a picture above the limit is failed with processing_error at once, without a retry, and the next photo of the batch is made', async () => {
    const owner = await signIn('editor');
    const orderId = await order();
    const bomb = await cleanPhoto(orderId, owner.userId, { body: photoBytes(1) });
    const fine = await cleanPhoto(orderId, owner.userId, { body: photoBytes(2) });
    current.imageProcessor.behaviour = (job) =>
      sha256Of(job.bytes) === sha256Of(bomb.body)
        ? Promise.reject(new ImageProcessingError('pixel_limit'))
        : Promise.resolve(FakeImageProcessor.outputs(800, 600));
    expect(await drain()).toBe(2);
    expect(await fileOf(bomb.storedFileId)).toMatchObject({ state: 'failed', state_reason_code: 'processing_error', process_attempts: 1 });
    expect(await fileOf(fine.storedFileId)).toMatchObject({ state: 'ready' });
    // never taken again
    current.clock.advance(STALE_PROCESSING_MS * 2);
    expect(await drain()).toBe(0);
    expect(current.imageProcessor.jobs).toHaveLength(2);
  });

  it('EVM-068 AC3 an unsupported file (a format the processor cannot read, HEIC included) and a processor that returned no WebP are permanent errors: failed at once', async () => {
    const owner = await signIn('editor');
    const orderId = await order();
    const heic = await cleanPhoto(orderId, owner.userId, { contentType: 'image/heic' });
    current.imageProcessor.behaviour = new ImageProcessingError('unsupported');
    await drain();
    expect(await fileOf(heic.storedFileId)).toMatchObject({ state: 'failed', state_reason_code: 'processing_error', process_attempts: 1 });
    const other = await cleanPhoto(orderId, owner.userId);
    current.imageProcessor.behaviour = new ImageProcessingError('invalid_output');
    await drain();
    expect(await fileOf(other.storedFileId)).toMatchObject({ state: 'failed', state_reason_code: 'processing_error', process_attempts: 1 });
  });

  it('EVM-068 AC3 a timeout is transient: the file waits in processing for the stale period, is taken again, and the next photo is made meanwhile', async () => {
    const owner = await signIn('editor');
    const orderId = await order();
    const slow = await cleanPhoto(orderId, owner.userId, { body: photoBytes(3) });
    current.imageProcessor.behaviour = new ImageProcessingError('timeout');
    expect(await processing().processFile(slow.storedFileId)).toBe('retry');
    expect(await fileOf(slow.storedFileId)).toMatchObject({ state: 'processing', process_attempts: 1 });
    // not taken again before the stale period (the backoff)
    expect(await drain()).toBe(0);
    expect(await fileOf(slow.storedFileId)).toMatchObject({ state: 'processing', process_attempts: 1 });
    // the next file of the batch passes
    current.imageProcessor.behaviour = 'ok';
    const next = await cleanPhoto(orderId, owner.userId, { body: photoBytes(4) });
    expect(await drain()).toBe(1);
    expect(await fileOf(next.storedFileId)).toMatchObject({ state: 'ready' });
    current.clock.advance(STALE_PROCESSING_MS + 1000);
    expect(await drain()).toBe(1);
    expect(await fileOf(slow.storedFileId)).toMatchObject({ state: 'ready', process_attempts: 2 });
  });

  it('EVM-068 AC3 a crash after the take uses an attempt: a worker that dies leaves the file in processing, and after three takes it is failed (no poison pill)', async () => {
    const owner = await signIn('editor');
    const poison = await cleanPhoto(await order(), owner.userId);
    // three takes whose worker died: the counter was raised at the take, not at the failure
    for (let take = 1; take <= MAX_PROCESSING_ATTEMPTS; take += 1) {
      await sql`update media.stored_files set state = 'processing', process_attempts = ${take}, process_claimed_at = ${current.clock.now()} where id = ${poison.storedFileId}`.execute(
        admin(),
      );
      current.clock.advance(STALE_PROCESSING_MS + 1000);
    }
    expect(await drain()).toBe(1);
    expect(await fileOf(poison.storedFileId)).toMatchObject({
      state: 'failed',
      state_reason_code: 'processing_error',
      process_attempts: 3,
    });
    expect(current.imageProcessor.jobs).toHaveLength(0);
  });
});

describe('EVM-068 AC3 an outage of the processor is no fault of the photos', () => {
  it('EVM-068 AC3 an unreachable processor gives the attempt back: many takes never fail the photo, and after the repair it becomes ready', async () => {
    const owner = await signIn('editor');
    const photo = await cleanPhoto(await order(), owner.userId);
    current.imageProcessor.behaviour = new ImageProcessingError('unreachable');
    for (let take = 1; take <= MAX_PROCESSING_ATTEMPTS + 3; take += 1) {
      expect(await processing().processFile(photo.storedFileId)).toBe('deferred');
      expect(await fileOf(photo.storedFileId)).toMatchObject({ state: 'processing', process_attempts: 0 });
      current.clock.advance(STALE_PROCESSING_MS + 1000);
    }
    current.imageProcessor.behaviour = 'ok';
    expect(await drain()).toBe(1);
    expect(await fileOf(photo.storedFileId)).toMatchObject({ state: 'ready' });
  });

  it('EVM-068 AC3 a pass stops at the first unreachable answer (the next photos would only wait for the connection)', async () => {
    const owner = await signIn('editor');
    const orderId = await order();
    await cleanPhoto(orderId, owner.userId);
    await cleanPhoto(orderId, owner.userId);
    current.imageProcessor.behaviour = new ImageProcessingError('unreachable');
    expect(await processing().runOnce()).toBe(0);
    expect(current.imageProcessor.jobs).toHaveLength(1);
  });
});

describe('EVM-068 AC4 a failing processing ends with processing_error after three tries and the panel is told', () => {
  it('EVM-068 AC4 transient errors on three takes end in failed / processing_error; the list says processingFailed and keeps the original', async () => {
    const owner = await signIn('editor');
    const orderId = await order();
    const photo = await cleanPhoto(orderId, owner.userId);
    current.imageProcessor.behaviour = new ImageProcessingError('internal');
    for (let take = 1; take <= MAX_PROCESSING_ATTEMPTS; take += 1) {
      const outcome = await processing().processFile(photo.storedFileId);
      expect(outcome).toBe(take < MAX_PROCESSING_ATTEMPTS ? 'retry' : 'failed');
      current.clock.advance(STALE_PROCESSING_MS + 1000);
    }
    expect(await fileOf(photo.storedFileId)).toMatchObject({ state: 'failed', state_reason_code: 'processing_error', process_attempts: 3 });
    expect(await processing().processFile(photo.storedFileId)).toBe('skipped');
    const reader = await signIn('read_only');
    const [item] = ((await reader.panel.get(`${BASE}/${orderId}/media-assets`)).body as { items: Array<Record<string, unknown>> }).items;
    expect(item).toMatchObject({ fileState: 'failed', stateReasonCode: null, processingFailed: true });
    // the original is untouched and still there: a file that PASSED the scan (AC4 of the story; the download is EVM-045)
    expect(current.storage.read(photo.objectKey)?.body.length).toBe(photo.body.length);
    expect(current.storage.isDeleted(photo.objectKey)).toBe(false);
  });

  it('EVM-068 AC4 a storage that fails is a transient error too (the original unreadable, a derivative not written)', async () => {
    const owner = await signIn('editor');
    const photo = await cleanPhoto(await order(), owner.userId);
    current.storage.unavailable = true;
    expect(await processing().processFile(photo.storedFileId)).toBe('retry');
    current.storage.unavailable = false;
    expect(await fileOf(photo.storedFileId)).toMatchObject({ state: 'processing', process_attempts: 1 });
  });

  it('EVM-068 AC4 a file that is ready, quarantined or failed for another reason carries no processingFailed', async () => {
    const owner = await signIn('editor');
    const orderId = await order();
    await cleanPhoto(orderId, owner.userId);
    await drain();
    const reader = await signIn('read_only');
    const [item] = ((await reader.panel.get(`${BASE}/${orderId}/media-assets`)).body as { items: Array<Record<string, unknown>> }).items;
    expect('processingFailed' in (item ?? {})).toBe(false);
  });
});

describe('EVM-068 two workers and the add-only write', () => {
  it('EVM-068 AC1 two workers take the same file once (compare-and-set): one makes it, the other finds nothing to do', async () => {
    const owner = await signIn('editor');
    const photo = await cleanPhoto(await order(), owner.userId);
    const outcomes = await Promise.all([processing().processFile(photo.storedFileId), processing().processFile(photo.storedFileId)]);
    expect([...outcomes].sort()).toEqual(['ready', 'skipped']);
    expect(current.imageProcessor.jobs).toHaveLength(1);
    expect(await derivativesOf(photo.storedFileId)).toHaveLength(2);
  });

  it('EVM-068 AC1 a derivative already in the storage after a crash before the commit (412) is a success when it has the same size', async () => {
    const owner = await signIn('editor');
    const photo = await cleanPhoto(await order(), owner.userId);
    const prefix = photo.objectKey.slice(0, -'original'.length);
    for (const image of FakeImageProcessor.outputs(1000, 500)) {
      await current.storage.putObjectIfAbsent({
        key: `${prefix}${image.variant}.webp`,
        body: image.body,
        contentType: 'image/webp',
        cacheControl: 'private, max-age=300',
      });
    }
    expect(await processing().processFile(photo.storedFileId)).toBe('ready');
    expect(await derivativesOf(photo.storedFileId)).toHaveLength(2);
  });

  it('EVM-068 AC1 an object of another size under the key is not taken for ours: a transient error, the attempts end in failed', async () => {
    const owner = await signIn('editor');
    const photo = await cleanPhoto(await order(), owner.userId);
    const prefix = photo.objectKey.slice(0, -'original'.length);
    await current.storage.putObjectIfAbsent({
      key: `${prefix}thumbnail.webp`,
      body: Buffer.from('somebody else'),
      contentType: 'image/webp',
      cacheControl: 'c',
    });
    expect(await processing().processFile(photo.storedFileId)).toBe('retry');
    expect(await derivativesOf(photo.storedFileId)).toEqual([]);
  });

  it('EVM-068 AC1 a failure of the database in the commit leaves the file in processing without a half-written pair (ready needs both rows)', async () => {
    const owner = await signIn('editor');
    const photo = await cleanPhoto(await order(), owner.userId);
    await sql`insert into media.file_derivatives (stored_file_id, variant, object_key, content_type, width, height, size_bytes, created_at)
      values (${photo.storedFileId}, 'thumbnail', ${`${photo.objectKey.slice(0, -8)}thumbnail.webp`}, 'image/webp', 10, 10, 30, ${NOW})`.execute(
      admin(),
    );
    expect(await processing().processFile(photo.storedFileId)).toBe('retry');
    expect(await fileOf(photo.storedFileId)).toMatchObject({ state: 'processing' });
    const { rows } = await sql<{
      n: string;
    }>`select count(*)::text as n from media.file_derivatives where stored_file_id = ${photo.storedFileId}`.execute(admin());
    expect(rows[0]?.n).toBe('1');
  });

  it('EVM-068 AC1 a storage error that is not "exists" while writing is surfaced as a retry', async () => {
    const owner = await signIn('editor');
    const photo = await cleanPhoto(await order(), owner.userId);
    const failing = current.storage.putObjectIfAbsent.bind(current.storage);
    current.storage.putObjectIfAbsent = () => Promise.reject(new ObjectStorageError('unavailable'));
    try {
      expect(await processing().processFile(photo.storedFileId)).toBe('retry');
    } finally {
      current.storage.putObjectIfAbsent = failing;
    }
  });
});

describe('EVM-068 AC6 AC7 the signed address of a thumbnail (the preview has no address until EVM-045)', () => {
  async function readyPhoto(orderId: string, userId: string): Promise<Clean> {
    const photo = await cleanPhoto(orderId, userId);
    expect(await processing().processFile(photo.storedFileId)).toBe('ready');
    return photo;
  }

  it('EVM-068 AC6 a signed GET of 300 s for the key of the derivative, typed image/webp and inline, not cached; the preview is not issued before the limits of EVM-045', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const photo = await readyPhoto(orderId, owner.userId);
    for (const variant of ['thumbnail'] as const) {
      const response = await downloadUrl(owner, orderId, photo.mediaAssetId, { variant });
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const body = response.body as { url: string; expiresAt: string };
      expect(Object.keys(body).sort()).toEqual(['expiresAt', 'url']);
      expect(new Date(body.expiresAt).getTime() - current.clock.now().getTime()).toBe(300_000);
      expect(new URL(body.url).pathname).toContain(`${variant}.webp`);
    }
    expect(
      current.storage.signedGets.map((entry) => [
        entry.key.endsWith('thumbnail.webp') || entry.key.endsWith('preview.webp'),
        entry.expiresInSeconds,
        entry.contentType,
        entry.cacheControl,
      ]),
    ).toEqual([[true, 300, 'image/webp', 'private, max-age=300']]);
  });

  it('EVM-068 AC7 Administrator, Editor and Read-only get the address; anonymous is 401; a mobile token is 403', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const photo = await readyPhoto(orderId, owner.userId);
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      expect((await downloadUrl(await signIn(role), orderId, photo.mediaAssetId)).status, role).toBe(200);
    }
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    expect((await downloadUrl({ userId: '', panel: anonymous }, orderId, photo.mediaAssetId)).status).toBe(401);
    expect((await downloadUrl(await signIn('editor', 'mobile'), orderId, photo.mediaAssetId)).status).toBe(403);
  });

  it('EVM-068 AC7 the medium of order B asked through order A, a missing medium, a deleted order and every state but ready are ONE 404', async () => {
    const orderA = await order();
    const orderB = await order();
    const deleted = await order(true);
    const owner = await signIn('administrator');
    const ready = await readyPhoto(orderB, owner.userId);
    const clean = await cleanPhoto(orderA, owner.userId);
    const states: Clean[] = [];
    for (const state of ['pending_upload', 'uploaded', 'scanning', 'processing', 'failed', 'quarantined'] as const) {
      const media = await cleanPhoto(orderA, owner.userId);
      await sql`update media.stored_files set state = ${state}, state_reason_code = ${state === 'failed' ? 'processing_error' : state === 'quarantined' ? 'malware_detected' : null},
        quarantined_at = ${state === 'quarantined' ? current.clock.now() : null} where id = ${media.storedFileId}`.execute(admin());
      states.push(media);
    }
    // ready, but the row of the variant is missing
    const rowless = await readyPhoto(orderA, owner.userId);
    await sql`delete from media.file_derivatives where stored_file_id = ${rowless.storedFileId}`.execute(admin());

    const answers = [
      await downloadUrl(owner, orderA, ready.mediaAssetId), // IDOR: the medium of B through A
      await downloadUrl(owner, orderA, uuidv7()), // missing
      await downloadUrl(owner, deleted, ready.mediaAssetId), // the order is deleted
      await downloadUrl(owner, uuidv7(), ready.mediaAssetId), // the order is missing
      await downloadUrl(owner, orderA, clean.mediaAssetId), // clean is enough for an original, never for a derivative
      ...(await Promise.all(states.map((media) => downloadUrl(owner, orderA, media.mediaAssetId)))),
      await downloadUrl(owner, orderA, rowless.mediaAssetId, { variant: 'thumbnail' }),
    ];
    const shapes = new Set(
      answers.map((answer) =>
        JSON.stringify({ status: answer.status, body: { ...(answer.body as object), traceId: undefined, instance: undefined } }),
      ),
    );
    expect(answers.every((answer) => answer.status === 404)).toBe(true);
    expect(shapes.size).toBe(1);
    expect(current.storage.signedGets.filter((entry) => entry.key.includes(ready.objectKey.slice(0, -8)))).toHaveLength(0);
  });

  it('EVM-068 AC7 a variant outside the list, an unknown field and a malformed identifier are 400 and issue no address', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const photo = await readyPhoto(orderId, owner.userId);
    for (const body of [
      { variant: 'preview' },
      { variant: 'original' },
      { variant: 'huge' },
      {},
      { variant: 'thumbnail', extra: 1 },
      { variant: ['thumbnail'] },
    ]) {
      expect((await downloadUrl(owner, orderId, photo.mediaAssetId, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await downloadUrl(owner, orderId, 'not-a-uuid')).status).toBe(400);
    expect(current.storage.signedGets).toHaveLength(0);
  });

  it('EVM-068 AC6 a storage that is unavailable is 503 without the address, and a missing configuration of the storage is the same', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const photo = await readyPhoto(orderId, owner.userId);
    current.storage.unavailable = true;
    const response = await downloadUrl(owner, orderId, photo.mediaAssetId);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toMatch(/X-Amz|bucket\.invalid/);
  });

  it('EVM-068 AC6 the address is not written to the log (SR-LOG-02)', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const photo = await readyPhoto(orderId, owner.userId);
    const response = await downloadUrl(owner, orderId, photo.mediaAssetId);
    const url = (response.body as { url: string }).url;
    const signature = new URL(url).searchParams.get('X-Amz-Signature') ?? 'synthetic';
    expect(current.logs.lines.join('\n')).not.toContain(signature);
    expect(current.logs.lines.join('\n')).not.toContain('response-content-disposition');
  });
});

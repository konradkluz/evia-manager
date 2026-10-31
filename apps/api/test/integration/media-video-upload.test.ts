import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNSCANNED_LARGE_FILE_METRIC } from '../../src/modules/media/application/media-scan.service.ts';
import { MediaScanService } from '../../src/modules/media/index.ts';
import type { Database } from '../../src/platform/database/database.ts';
import type { EventBus } from '../../src/platform/events/event-bus.ts';
import type { Logger } from '../../src/platform/logging/logger.ts';
import type { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { DATABASE, EVENT_BUS, LOGGER, METRICS } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { insertMedia, sha256Of } from '../support/media-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

const NOW = '2026-10-31T08:00:00.000Z';
const BASE = '/api/v1/work-orders';
const FOUR_GIB = 4_294_967_296;

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp({ now: NOW });
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  current.clock.set(NOW);
  current.scanner.mode = 'working';
  current.scanner.scans = 0;
  await clearWorkOrderCreation(current.database.admin);
});

const admin = () => current.database.admin;

async function signIn(role: Role = 'editor') {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, { channel: 'web' });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;

let numbering = 0;
async function order(): Promise<string> {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `film${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [{ number: `ZL-5${String(numbering).padStart(3, '0')}-0001`, customerId, siteId }]);
  return [...ids.values()][0] ?? '';
}

/** The first bytes of an MP4: a `ftyp` box (brand isom), then filler. A synthetic film, never a recording. */
const ftyp = (): Buffer => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(12)]);
const film = (size = 4096): Buffer => Buffer.concat([ftyp(), Buffer.alloc(size - 24, 3)]);

const film_item = (body: Buffer, over: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  category: 'measurement',
  fileName: 'Pomiar uziemienia.mp4',
  declaredSize: body.length,
  contentType: 'video/mp4',
  sha256: sha256Of(body),
  ...over,
});
const createMedia = (browser: Browser, orderId: string, items: unknown[]) =>
  browser.panel.post(`${BASE}/${orderId}/media-assets`, { items }, { 'Idempotency-Key': uuidv7() });
const codeOf = (body: unknown) => (body as { code?: string }).code;
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors ?? [];

describe('EVM-046 AC1 AC6 adding a film', () => {
  it('EVM-046 AC1 AC6 Administrator and Editor add an MP4 and a MOV (201): a film is a video with no duration yet and not scanned yet; Tylko odczyt 403, anonymous 401', async () => {
    const orderId = await order();
    const administrator = await signIn('administrator');
    const editor = await signIn('editor');
    const reader = await signIn('read_only');
    const mov = film_item(film(), { fileName: 'Pomiar.MOV', contentType: 'video/quicktime' });
    for (const [browser, item] of [
      [administrator, film_item(film())],
      [editor, mov],
    ] as const) {
      const response = await createMedia(browser, orderId, [item]);
      expect(response.status).toBe(201);
      expect((response.body as { items: Array<Record<string, unknown>> }).items[0]).toMatchObject({
        mediaType: 'video',
        category: 'measurement',
        fileState: 'pending_upload',
        durationSeconds: null,
        avScanned: false,
      });
    }
    const asset = await sql<{ media_type: string }>`select media_type from media.media_assets where id = ${mov.id}`.execute(admin());
    expect(asset.rows[0]?.media_type).toBe('video');
    const refused = await createMedia(reader, orderId, [film_item(film())]);
    expect(refused.status).toBe(403);
    expect(codeOf(refused.body)).toBe('forbidden');
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    expect((await anonymous.post(`${BASE}/${orderId}/media-assets`, { items: [] })).status).toBe(401);
  });

  it('EVM-046 AC7 adding a film creates the audit record media_asset.created and the journal entry media_assets_added, with no file name in either', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const item = film_item(film(), { fileName: 'Kowalski-ul-Kwiatowa-7.mp4' });
    const response = await createMedia(editor, orderId, [item]);
    expect(response.status).toBe(201);
    const audited = (
      await sql<
        Record<string, unknown>
      >`select * from audit.events where action = 'media_asset.created' and object_id = ${item.id}`.execute(admin())
    ).rows;
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({ actor_user_id: editor.userId, outcome: 'success', object_type: 'media_asset' });
    const journal = (
      await sql<{ event_payload: Record<string, unknown> }>`
        select event_payload from timeline.timeline_entries where work_order_id = ${orderId} and event_code = 'media_assets_added'`.execute(
        admin(),
      )
    ).rows;
    expect(journal).toHaveLength(1);
    expect(journal[0]?.event_payload).toEqual({ objectType: 'work_order', objectId: orderId, count: 1, mediaAssetIds: [item.id] });
    expect(JSON.stringify([audited, journal])).not.toContain('Kowalski');
  });

  it('EVM-046 AC1 exactly 4 GiB is accepted and one byte more is file_too_large; a photo is still limited to 50 MB; the type of the file and its name must agree', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const body = film();
    expect((await createMedia(editor, orderId, [film_item(body, { declaredSize: FOUR_GIB })])).status).toBe(201);
    const above = await createMedia(editor, orderId, [film_item(body, { declaredSize: FOUR_GIB + 1 })]);
    expect(above.status).toBe(400);
    expect(errorsOf(above.body).some((error) => error.pointer === '/items/0/declaredSize')).toBe(true);
    const photo = await createMedia(editor, orderId, [
      film_item(body, { fileName: 'IMG_0001.JPG', contentType: 'image/jpeg', category: 'in_progress', declaredSize: 52_428_801 }),
    ]);
    expect(photo.status).toBe(400);
    for (const over of [
      { fileName: 'film.avi', contentType: 'video/x-msvideo' },
      { fileName: 'film.mkv', contentType: 'video/x-matroska' },
      { fileName: 'film.avi', contentType: 'video/mp4' },
      { fileName: 'IMG_0001.JPG', contentType: 'video/mp4' },
      { fileName: 'film.mp4', contentType: 'image/jpeg' },
    ]) {
      const response = await createMedia(editor, orderId, [film_item(body, over)]);
      expect(response.status, JSON.stringify(over)).toBe(400);
    }
    // the kind is decided by the server from the type: the client cannot say it
    expect((await createMedia(editor, orderId, [film_item(body, { mediaType: 'photo' })])).status).toBe(400);
  });

  it('EVM-046 AC1 a film of 4 GiB is uploaded in 256 parts of 16 MiB (resumable)', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const item = film_item(film(), { declaredSize: FOUR_GIB });
    expect((await createMedia(editor, orderId, [item])).status).toBe(201);
    const session = await editor.panel.post(
      `${BASE}/${orderId}/media-assets/${item.id}/upload-sessions`,
      { id: uuidv7() },
      { 'Idempotency-Key': uuidv7() },
    );
    expect(session.status).toBe(201);
    expect(session.body).toMatchObject({ partSize: 16 * 1024 * 1024, partCount: 256 });
  });

  it('EVM-046 AC6 the session of a film of order B reached through order A is 404 for every operation (IDOR); Tylko odczyt 403', async () => {
    const orderA = await order();
    const orderB = await order();
    const editor = await signIn('editor');
    const reader = await signIn('read_only');
    const item = film_item(film());
    expect((await createMedia(editor, orderB, [item])).status).toBe(201);
    const session = await editor.panel.post(
      `${BASE}/${orderB}/media-assets/${item.id}/upload-sessions`,
      { id: uuidv7() },
      { 'Idempotency-Key': uuidv7() },
    );
    const sessionId = (session.body as { id: string }).id;
    const wrong = `${BASE}/${orderA}/media-assets/${item.id}/upload-sessions/${sessionId}`;
    for (const response of [
      await editor.panel.get(`${wrong}/parts`),
      await editor.panel.get(`${wrong}/parts/1/url`),
      await editor.panel.post(`${wrong}/complete`),
      await editor.panel.post(`${wrong}/abort`),
    ])
      expect(response.status).toBe(404);
    const own = `${BASE}/${orderB}/media-assets/${item.id}/upload-sessions/${sessionId}`;
    for (const response of [
      await reader.panel.get(`${own}/parts`),
      await reader.panel.get(`${own}/parts/1/url`),
      await reader.panel.post(`${own}/complete`),
    ])
      expect(response.status).toBe(403);
  });
});

describe('EVM-046 AC3 a film above the scan limit is not sent to the antivirus', () => {
  const dependencies = (extra: Record<string, unknown> = {}) => ({
    db: current.app.get<Kysely<Database>>(DATABASE, { strict: false }),
    clock: current.clock,
    events: current.app.get<EventBus>(EVENT_BUS, { strict: false }),
    logger: current.app.get<Logger>(LOGGER, { strict: false }),
    storage: current.storage,
    scanner: current.scanner,
    administrators: () => Promise.resolve([]),
    ...extra,
  });

  /** A film in `uploaded` whose object is in the storage; the file has a media asset of the kind `video`. */
  async function uploadedFilm(
    orderId: string,
    userId: string,
    body: Buffer,
    declared: { size: number; sha256: string } = { size: body.length, sha256: sha256Of(body) },
  ) {
    const media = await insertMedia(admin(), {
      workOrderId: orderId,
      createdBy: userId,
      state: 'uploaded',
      size: declared.size,
      sha256: declared.sha256,
      fileName: 'Pomiar.mp4',
      contentType: 'video/mp4',
      mediaType: 'video',
    });
    const put = current.storage.putObject(media.objectKey, body);
    await sql`update media.stored_files set s3_version_id = ${put.versionId}, s3_etag = ${put.etag} where id = ${media.storedFileId}`.execute(
      admin(),
    );
    return media;
  }
  const fileOf = async (storedFileId: string) =>
    (
      await sql<{
        state: string;
        av_scanned: boolean | null;
        size_bytes: string | null;
      }>`select state, av_scanned, size_bytes from media.stored_files where id = ${storedFileId}`.execute(admin())
    ).rows[0];

  it('EVM-046 AC3 a film within the limit goes through the antivirus and is av_scanned = true', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const media = await uploadedFilm(orderId, owner.userId, film());
    const service = new MediaScanService(dependencies({ scanLimitBytes: 1_000_000 }));
    expect(await service.scanFile(media.storedFileId)).toBe(true);
    expect(current.scanner.scans).toBe(1);
    expect(await fileOf(media.storedFileId)).toMatchObject({ state: 'clean', av_scanned: true });
  });

  it('EVM-046 AC3 SR-FILE-12 a film above 2 000 000 000 bytes (measured in the storage, whatever was declared) is checksummed, typed and sized but NOT scanned: clean with av_scanned = false and one count on the metric', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const small = film();
    // a stream of 2 000 000 100 bytes that is never held in memory: the header of an MP4, then a repeated chunk
    const total = 2_000_000_100;
    const chunk = Buffer.alloc(1 << 20, 1);
    function* bytes(): Generator<Buffer> {
      yield small.subarray(0, 4096);
      let sent = 4096;
      while (sent < total) {
        const piece = chunk.subarray(0, Math.min(chunk.length, total - sent));
        sent += piece.length;
        yield piece;
      }
    }
    const digest = createHash('sha256');
    for (const piece of bytes()) digest.update(piece);
    const media = await uploadedFilm(orderId, owner.userId, small, { size: total, sha256: digest.digest('hex') });
    const head = vi.spyOn(current.storage, 'head').mockResolvedValue({ size: total, etag: 'x', versionId: 'v' });
    const stream = vi
      .spyOn(current.storage, 'getObjectStream')
      .mockImplementation(() => Promise.resolve(Readable.from(bytes(), { objectMode: false })));
    try {
      const metrics = current.app.get<MetricsRegistry>(METRICS, { strict: false });
      const before = metrics
        .snapshot()
        .filter((sample) => sample.name === UNSCANNED_LARGE_FILE_METRIC)
        .reduce((sum, sample) => sum + sample.value, 0);
      const service = new MediaScanService(dependencies({ metrics }));
      expect(await service.scanFile(media.storedFileId)).toBe(true);
      expect(current.scanner.scans).toBe(0);
      expect(await fileOf(media.storedFileId)).toMatchObject({ state: 'clean', av_scanned: false, size_bytes: String(total) });
      const after = metrics.snapshot().filter((sample) => sample.name === UNSCANNED_LARGE_FILE_METRIC);
      expect(after.reduce((sum, sample) => sum + sample.value, 0) - before).toBe(1);
      expect(after.every((sample) => Object.keys(sample.labels).length === 0)).toBe(true);
    } finally {
      head.mockRestore();
      stream.mockRestore();
    }
  }, 180_000);

  it('EVM-046 AC3 a PHOTO is never left out of the scan, whatever its size: the exception is for films', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const body = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
      Buffer.alloc(4000, 9),
    ]);
    const media = await insertMedia(admin(), {
      workOrderId: orderId,
      createdBy: owner.userId,
      state: 'uploaded',
      size: body.length,
      sha256: sha256Of(body),
    });
    const put = current.storage.putObject(media.objectKey, body);
    await sql`update media.stored_files set s3_version_id = ${put.versionId}, s3_etag = ${put.etag} where id = ${media.storedFileId}`.execute(
      admin(),
    );
    const service = new MediaScanService(dependencies({ scanLimitBytes: 10 }));
    expect(await service.scanFile(media.storedFileId)).toBe(true);
    expect(current.scanner.scans).toBe(1);
    expect(await fileOf(media.storedFileId)).toMatchObject({ state: 'clean', av_scanned: true });
  });
});

/**
 * The signed address of a thumbnail or a preview for the PHONE (EVM-142 AC1; SR-FILE-07, SR-FILE-10, SR-AUTHZ-02, SR-AUTHZ-05, SR-AUTHZ-06, SR-MOB-14, SR-LOG-02, CWE-639)
 * against the real application and PostgreSQL. The phone sends a Bearer token and the headers of the app; it never gets the original and never sees a video (EVM-143).
 * Synthetic data only.
 */
import { sql } from 'kysely';
import request, { type Test } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MediaProcessingService } from '../../src/modules/media/index.ts';
import type { SignedUrlMeters } from '../../src/platform/signed-url-limits/signed-url-meters.ts';
import { SIGNED_URL_METERS } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createMobileSession, createSession, createUser, type Role, type UserFixture } from '../support/identity-fixtures.ts';
import { insertMedia, sha256Of } from '../support/media-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

const NOW = '2026-11-19T08:00:00.000Z';
const BASE = '/api/v1/work-orders';
const APP = { 'X-Client-Platform': 'android', 'X-Client-Version': '1.2.0' };

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
  current.logs.lines.length = 0;
  await clearWorkOrderCreation(current.database.admin);
  // the files of the earlier tests must not be taken by the loop of this one
  await sql`update media.stored_files set state = 'failed', state_reason_code = 'abandoned', process_attempts = 0 where state in ('clean', 'processing')`.execute(
    admin(),
  );
});

const admin = () => current.database.admin;
const server = () => current.app.getHttpServer();
const processing = () => current.app.get(MediaProcessingService, { strict: false });

interface Phone {
  readonly user: UserFixture;
  readonly bearer: string;
}
async function phone(role: Role = 'editor'): Promise<Phone> {
  const user = await createUser(admin(), current.clock, { role });
  return { user, ...(await createMobileSession(admin(), current.clock, user)) };
}

async function panel(role: Role = 'editor'): Promise<{ user: UserFixture; client: PanelClient }> {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, { channel: 'web' });
  const client = new PanelClient(server(), PANEL_ORIGIN);
  client.cookie = session.cookie;
  client.csrfToken = session.csrfToken;
  return { user, client };
}

/** The call of the phone: Bearer, the headers of the app, no cookie, no Origin. */
function addressOf(who: Phone | undefined, orderId: string, mediaAssetId: string, body: unknown = { variant: 'thumbnail' }): Test {
  let test = request(server()).post(`${BASE}/${orderId}/media-assets/${mediaAssetId}/download-url`).set(APP);
  if (who !== undefined) test = test.set('Authorization', `Bearer ${who.bearer}`);
  return test.set('Content-Type', 'application/json').send(JSON.stringify(body));
}

let numbering = 0;
async function order(options: { deleted?: boolean } = {}): Promise<string> {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `mobile-download${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [
    {
      number: `ZL-8${String(numbering).padStart(3, '0')}-0001`,
      customerId,
      siteId,
      ...(options.deleted === true ? { deletedAt: new Date('2026-11-02T08:00:00Z') } : {}),
    },
  ]);
  return [...ids.values()][0] ?? '';
}

interface Photo {
  readonly mediaAssetId: string;
  readonly storedFileId: string;
  readonly objectKey: string;
}

async function cleanPhoto(orderId: string, userId: string, mediaType: 'photo' | 'video' = 'photo'): Promise<Photo> {
  const body = Buffer.alloc(4096, Math.floor(Math.random() * 200) + 1);
  const media = await insertMedia(admin(), {
    workOrderId: orderId,
    createdBy: userId,
    state: 'clean',
    size: body.length,
    sha256: sha256Of(body),
    createdAt: new Date(NOW),
    fileName: 'Zdjecie przylacza.jpg',
    contentType: 'image/png',
  });
  const put = current.storage.putObject(media.objectKey, body);
  await sql`update media.stored_files set content_type = 'image/jpeg', size_bytes = ${body.length},
      sha256 = ${sha256Of(body)}, s3_version_id = ${put.versionId}, s3_etag = ${put.etag}
      where id = ${media.storedFileId}`.execute(admin());
  if (mediaType === 'video')
    await sql`update media.media_assets set media_type = 'video' where id = ${media.mediaAssetId}`.execute(admin());
  return { mediaAssetId: media.mediaAssetId, storedFileId: media.storedFileId, objectKey: media.objectKey };
}

async function readyPhoto(orderId: string, userId: string): Promise<Photo> {
  const photo = await cleanPhoto(orderId, userId);
  expect(await processing().processFile(photo.storedFileId)).toBe('ready');
  return photo;
}

/** A video that is `ready` with the two rows of derivatives the processor of videos writes. */
async function readyVideo(orderId: string, userId: string): Promise<Photo> {
  const media = await cleanPhoto(orderId, userId, 'video');
  await sql`update media.stored_files set state = 'ready', duration_seconds = 20, av_scanned = true where id = ${media.storedFileId}`.execute(
    admin(),
  );
  const prefix = media.objectKey.slice(0, -'original'.length);
  await sql`insert into media.file_derivatives (stored_file_id, variant, object_key, content_type, width, height, size_bytes, created_at) values
    (${media.storedFileId}, 'thumbnail', ${`${prefix}thumbnail.webp`}, 'image/webp', 320, 180, 9000, ${NOW}),
    (${media.storedFileId}, 'preview', ${`${prefix}preview.mp4`}, 'video/mp4', 1280, 720, 900000, ${NOW})`.execute(admin());
  return media;
}

const auditCount = async (mediaAssetId: string): Promise<number> =>
  Number(
    (await sql<{ n: string }>`select count(*)::text as n from audit.events where object_id = ${mediaAssetId}`.execute(admin())).rows[0]?.n,
  );

const traceless = (answer: { status: number; body: unknown }) =>
  JSON.stringify({ status: answer.status, body: { ...(answer.body as object), traceId: undefined, instance: undefined } });

describe('EVM-142 AC1 the phone gets the address of a thumbnail or a preview', () => {
  it('EVM-142 AC1 Administrator and Editor with a token of the phone get a short-lived address of the thumbnail and of the preview: 300 s, no-store, the host of the bucket, WebP inline', async () => {
    const orderId = await order();
    const owner = await panel('administrator');
    const photo = await readyPhoto(orderId, owner.user.id);
    for (const role of ['administrator', 'editor'] as const) {
      const who = await phone(role);
      for (const variant of ['thumbnail', 'preview'] as const) {
        const answer = await addressOf(who, orderId, photo.mediaAssetId, { variant });
        expect(answer.status, `${role} ${variant}`).toBe(200);
        expect(answer.headers['cache-control']).toBe('no-store');
        const body = answer.body as { url: string; expiresAt: string };
        expect(new URL(body.url).hostname).toBe('bucket.invalid');
        expect(Date.parse(body.expiresAt) - current.clock.now().getTime()).toBeLessThanOrEqual(300_000);
      }
    }
    const signed = current.storage.signedGets.at(-1);
    expect(signed).toMatchObject({ contentType: 'image/webp', disposition: { kind: 'inline' } });
  });

  it('EVM-142 AC1 the address is not written to the log and nothing is audited for it (SR-LOG-02)', async () => {
    const orderId = await order();
    const owner = await panel('administrator');
    const photo = await readyPhoto(orderId, owner.user.id);
    const before = await auditCount(photo.mediaAssetId);
    const who = await phone('editor');
    const answer = await addressOf(who, orderId, photo.mediaAssetId, { variant: 'preview' });
    expect(answer.status).toBe(200);
    expect(await auditCount(photo.mediaAssetId)).toBe(before);
    const logs = current.logs.lines.join('\n');
    expect(logs).not.toMatch(/bucket\.invalid|X-Amz|Zdjecie przylacza/);
    expect(logs).not.toContain((answer.body as { url: string }).url);
  });

  it('EVM-142 AC1 the original is a 403 from the phone BEFORE the lookup of the medium: an existing and a missing medium give the same answer, nothing is signed', async () => {
    const orderId = await order();
    const owner = await panel('administrator');
    const photo = await readyPhoto(orderId, owner.user.id);
    for (const role of ['administrator', 'editor'] as const) {
      const who = await phone(role);
      const answers = [
        await addressOf(who, orderId, photo.mediaAssetId, { variant: 'original' }),
        await addressOf(who, orderId, uuidv7(), { variant: 'original' }),
      ];
      expect(
        answers.map((answer) => answer.status),
        role,
      ).toEqual([403, 403]);
      expect(answers[0]?.body).toMatchObject({ code: 'forbidden' });
      expect(new Set(answers.map(traceless)).size).toBe(1);
    }
    expect(current.storage.signedGets).toHaveLength(0);
  });

  it('EVM-142 AC1 a photo of another order, a deleted one, one without a ready derivative, in quarantine, a missing one and a video are ONE 404 for the phone', async () => {
    const orderA = await order();
    const orderB = await order();
    const owner = await panel('administrator');
    const who = await phone('editor');
    const foreign = await readyPhoto(orderB, owner.user.id);
    const deleted = await readyPhoto(orderA, owner.user.id);
    await sql`update media.media_assets set deleted_at = now(), deleted_by = ${owner.user.id} where id = ${deleted.mediaAssetId}`.execute(
      admin(),
    );
    const notReady = await cleanPhoto(orderA, owner.user.id);
    const quarantined = await readyPhoto(orderA, owner.user.id);
    await sql`update media.stored_files set state = 'quarantined', state_reason_code = 'malware_detected', quarantined_at = now() where id = ${quarantined.storedFileId}`.execute(
      admin(),
    );
    const video = await readyVideo(orderA, owner.user.id);
    const refused = [];
    for (const variant of ['thumbnail', 'preview'] as const) {
      for (const id of [
        foreign.mediaAssetId,
        deleted.mediaAssetId,
        notReady.mediaAssetId,
        quarantined.mediaAssetId,
        uuidv7(),
        video.mediaAssetId,
      ]) {
        refused.push(await addressOf(who, orderA, id, { variant }));
      }
    }
    expect(refused.map((answer) => answer.status)).toEqual(Array.from({ length: 12 }, () => 404));
    expect(new Set(refused.map(traceless)).size).toBe(1);
    expect(current.storage.signedGets).toHaveLength(0);
    // the panel still gets the frame of the same video (the closing is for the phone only)
    const web = await panel('editor');
    expect(
      (await web.client.post(`${BASE}/${orderA}/media-assets/${video.mediaAssetId}/download-url`, { variant: 'thumbnail' })).status,
    ).toBe(200);
  });

  it('EVM-142 AC1 an order that is not visible (deleted) is a 404 for the phone, the same for every medium and variant', async () => {
    const deletedOrder = await order({ deleted: true });
    const liveOrder = await order();
    const owner = await panel('administrator');
    const photo = await readyPhoto(liveOrder, owner.user.id);
    for (const role of ['administrator', 'editor'] as const) {
      const who = await phone(role);
      const answers = [
        await addressOf(who, deletedOrder, photo.mediaAssetId, { variant: 'thumbnail' }),
        await addressOf(who, deletedOrder, uuidv7(), { variant: 'preview' }),
        await addressOf(who, uuidv7(), photo.mediaAssetId, { variant: 'thumbnail' }),
      ];
      expect(
        answers.map((answer) => answer.status),
        role,
      ).toEqual([404, 404, 404]);
      expect(new Set(answers.map(traceless)).size).toBe(1);
    }
  });

  it('EVM-142 AC1 the matrix of roles and channels: Read-only on the phone 403 channel_not_allowed for every variant; anonymous 401; a cookie of the panel is no credential of the phone; the panel is unchanged', async () => {
    const orderId = await order();
    const owner = await panel('administrator');
    const photo = await readyPhoto(orderId, owner.user.id);
    const reader = await phone('read_only');
    for (const variant of ['thumbnail', 'preview', 'original'] as const) {
      const refused = await addressOf(reader, orderId, photo.mediaAssetId, { variant });
      expect(refused.status, `read_only ${variant}`).toBe(403);
      expect(refused.body).toMatchObject({ code: 'channel_not_allowed' });
      expect((await addressOf(undefined, orderId, photo.mediaAssetId, { variant })).status, `anonymous ${variant}`).toBe(401);
    }
    // the panel keeps its rules (EVM-045): Read-only gets the derivatives and not the original, Administrator all three
    const web = await panel('read_only');
    const post = (variant: string) => web.client.post(`${BASE}/${orderId}/media-assets/${photo.mediaAssetId}/download-url`, { variant });
    expect([(await post('thumbnail')).status, (await post('preview')).status, (await post('original')).status]).toEqual([200, 200, 403]);
    const web2 = await panel('administrator');
    expect(
      (await web2.client.post(`${BASE}/${orderId}/media-assets/${photo.mediaAssetId}/download-url`, { variant: 'original' })).status,
    ).toBe(200);
  });

  it('EVM-142 AC1 a body outside the schema is a 400 and the version of the app is checked (426 for a missing header)', async () => {
    const orderId = await order();
    const owner = await panel('administrator');
    const photo = await readyPhoto(orderId, owner.user.id);
    const who = await phone('editor');
    expect((await addressOf(who, orderId, photo.mediaAssetId, { variant: 'huge' })).status).toBe(400);
    expect((await addressOf(who, orderId, photo.mediaAssetId, { variant: 'thumbnail', extra: 1 })).status).toBe(400);
    const noVersion = await request(server())
      .post(`${BASE}/${orderId}/media-assets/${photo.mediaAssetId}/download-url`)
      .set('Authorization', `Bearer ${who.bearer}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ variant: 'thumbnail' }));
    expect(noVersion.status).toBe(426);
  });

  it('EVM-142 AC1 the limit of 1000 addresses in 10 minutes is shared with the panel: after it the phone gets 429 rate_limited with Retry-After and nothing more is signed', async () => {
    const orderId = await order();
    const owner = await panel('administrator');
    const photo = await readyPhoto(orderId, owner.user.id);
    const who = await phone('editor');
    const meters = current.app.get<SignedUrlMeters>(SIGNED_URL_METERS, { strict: false });
    // 999 addresses already taken by the same user (for instance in the panel), the 1000th is the phone's
    for (let index = 0; index < 999; index += 1) meters.reserve(who.user.id, 'derivative');
    expect((await addressOf(who, orderId, photo.mediaAssetId, { variant: 'thumbnail' })).status).toBe(200);
    const signed = current.storage.signedGets.length;
    const refused = await addressOf(who, orderId, photo.mediaAssetId, { variant: 'preview' });
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ code: 'rate_limited' });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(current.storage.signedGets).toHaveLength(signed);
    // another user has a limit of his own
    expect((await addressOf(await phone('editor'), orderId, photo.mediaAssetId, { variant: 'thumbnail' })).status).toBe(200);
  });
});

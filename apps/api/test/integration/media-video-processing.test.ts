import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MediaProcessingService, VideoProcessingService } from '../../src/modules/media/index.ts';
import { VIDEO_WORKAREA_FULL_METRIC } from '../../src/modules/media/application/video-processing.service.ts';
import { MAX_VIDEO_PROCESSING_ATTEMPTS } from '../../src/modules/media/domain/derivatives.ts';
import { SYNTHETIC_PROBE } from '../../src/platform/media-processing/fake-video-processor.ts';
import { VideoProcessingError } from '../../src/platform/media-processing/video-processor.ts';
import type { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { DATABASE, EVENT_BUS, LOGGER, METRICS } from '../../src/platform/tokens.ts';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/platform/database/database.ts';
import type { EventBus } from '../../src/platform/events/event-bus.ts';
import type { Logger } from '../../src/platform/logging/logger.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { insertMedia, sha256Of } from '../support/media-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

const NOW = '2026-10-31T08:00:00.000Z';
const LATER = '2026-10-31T09:00:00.000Z';
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
  current.videoProcessor.probeBehaviour = SYNTHETIC_PROBE;
  current.videoProcessor.transcodeBehaviour = 'ok';
  current.videoProcessor.roomLeft = true;
  current.videoProcessor.jobs.length = 0;
  current.videoProcessor.disposed.length = 0;
  current.videoProcessor.maxRunning = 0;
  current.imageProcessor.behaviour = 'ok';
  current.storage.signedGets.length = 0;
  await clearWorkOrderCreation(current.database.admin);
  // the files of the earlier tests must not be taken by the loops of this one
  await sql`update media.stored_files set state = 'failed', state_reason_code = 'abandoned', process_attempts = 0 where state in ('clean', 'processing')`.execute(
    admin(),
  );
});

const admin = () => current.database.admin;
const videos = () => current.app.get(VideoProcessingService, { strict: false });
const photos = () => current.app.get(MediaProcessingService, { strict: false });

async function signIn(role: Role) {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, { channel: 'web' });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}

let numbering = 0;
async function order(): Promise<string> {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `video${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [{ number: `ZL-6${String(numbering).padStart(3, '0')}-0001`, customerId, siteId }]);
  return [...ids.values()][0] ?? '';
}

interface Clip {
  readonly mediaAssetId: string;
  readonly storedFileId: string;
  readonly objectKey: string;
  readonly body: Buffer;
}

/** A film that passed the scan: `clean` with the type, the size and the checksum the scan recorded and the pinned version of its object. */
async function cleanClip(
  orderId: string,
  userId: string,
  options: { recordedSha?: string; mediaType?: 'video' | 'photo' } = {},
): Promise<Clip> {
  const body = Buffer.alloc(4096, Math.floor(Math.random() * 200) + 1);
  const mediaType = options.mediaType ?? 'video';
  const media = await insertMedia(admin(), {
    workOrderId: orderId,
    createdBy: userId,
    state: 'clean',
    size: body.length,
    sha256: sha256Of(body),
    createdAt: new Date(NOW),
  });
  const put = current.storage.putObject(media.objectKey, body);
  await sql`update media.stored_files set content_type = ${mediaType === 'video' ? 'video/mp4' : 'image/jpeg'}, size_bytes = ${body.length},
      sha256 = ${options.recordedSha ?? sha256Of(body)}, s3_version_id = ${put.versionId}, s3_etag = ${put.etag}, av_scanned = true
      where id = ${media.storedFileId}`.execute(admin());
  await sql`update media.media_assets set media_type = ${mediaType} where id = ${media.mediaAssetId}`.execute(admin());
  return { mediaAssetId: media.mediaAssetId, storedFileId: media.storedFileId, objectKey: media.objectKey, body };
}

interface FileRow {
  state: string;
  state_reason_code: string | null;
  process_attempts: number;
  duration_seconds: number | null;
  quarantined_at: Date | null;
}
const fileOf = async (storedFileId: string): Promise<FileRow> =>
  (
    await sql<FileRow>`select state, state_reason_code, process_attempts, duration_seconds, quarantined_at from media.stored_files where id = ${storedFileId}`.execute(
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
const auditRows = (action: string, mediaAssetId: string) =>
  sql<Record<string, unknown>>`select * from audit.events where action = ${action} and object_id = ${mediaAssetId}`
    .execute(admin())
    .then((result) => result.rows);
const pendingMails = (orderId: string) =>
  sql<{
    n: string;
  }>`select count(*)::text as n from platform.email_outbox where variant = 'administrator_media_quarantined' and subject_id = ${orderId}`
    .execute(admin())
    .then((result) => Number(result.rows[0]?.n));
const alerts = () =>
  sql<{ n: string }>`select count(*)::text as n from platform.security_alert_outbox where alert_code = 'media_quarantined'`
    .execute(admin())
    .then((result) => Number(result.rows[0]?.n));

describe('EVM-046 AC4 the film becomes ready with a frame and a 720p preview', () => {
  it('EVM-046 AC4 clean -> processing -> ready: the duration is rounded up and kept, both derivatives are in the storage and in the table, the work area is cleaned', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const clip = await cleanClip(orderId, owner.userId);
    current.videoProcessor.previewBody = Buffer.alloc(5000, 7);
    expect(await videos().processFile(clip.storedFileId)).toBe('ready');
    expect(await fileOf(clip.storedFileId)).toMatchObject({ state: 'ready', state_reason_code: null, duration_seconds: 243 });
    const rows = await derivativesOf(clip.storedFileId);
    const prefix = clip.objectKey.slice(0, -'original'.length);
    expect(rows).toEqual([
      { variant: 'preview', object_key: `${prefix}preview.mp4`, content_type: 'video/mp4', width: 1280, height: 720, size_bytes: 5000 },
      {
        variant: 'thumbnail',
        object_key: `${prefix}thumbnail.webp`,
        content_type: 'image/webp',
        width: 320,
        height: 180,
        size_bytes: rows[1]?.size_bytes ?? 0,
      },
    ]);
    expect(current.storage.read(`${prefix}preview.mp4`)?.body.length).toBe(5000);
    // the original was read whole and unchanged; the job directory was removed
    expect(current.videoProcessor.jobs).toHaveLength(1);
    expect(current.videoProcessor.jobs[0]).toMatchObject({ contentType: 'video/mp4', bytes: clip.body.length });
    expect(current.videoProcessor.disposed).toEqual([current.videoProcessor.jobs[0]?.jobId]);
  });

  it('EVM-046 AC4 the loop takes films and leaves photos to the loop of photos', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const clip = await cleanClip(orderId, owner.userId);
    const photo = await cleanClip(orderId, owner.userId, { mediaType: 'photo' });
    expect(await videos().runOnce()).toBe(1);
    expect((await fileOf(clip.storedFileId)).state).toBe('ready');
    expect((await fileOf(photo.storedFileId)).state).toBe('clean');
    expect(await photos().runOnce()).toBe(1);
    expect((await fileOf(photo.storedFileId)).state).toBe('ready');
  });

  it('EVM-046 AC4 a derivative that is already in the storage (a crash before the commit) is a success when its size is the same', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const clip = await cleanClip(orderId, owner.userId);
    const prefix = clip.objectKey.slice(0, -'original'.length);
    current.videoProcessor.previewBody = Buffer.alloc(300, 1);
    current.storage.putObject(`${prefix}preview.mp4`, Buffer.alloc(300, 1));
    expect(await videos().processFile(clip.storedFileId)).toBe('ready');
    // with another size it is a fault of the storage: retried, then failed
    const other = await cleanClip(orderId, owner.userId);
    current.storage.putObject(`${other.objectKey.slice(0, -'original'.length)}preview.mp4`, Buffer.alloc(10, 1));
    expect(await videos().processFile(other.storedFileId)).toBe('retry');
  });
});

describe('EVM-046 AC2 a film that is not what its type says is quarantined as type_mismatch', () => {
  it.each(['unsupported', 'too_long'] as const)(
    'EVM-046 AC2 SR-LOG-03 the check says %s: processing -> quarantined(type_mismatch) with the audit event, ONE e-mail per active Administrator and an alert, in one transaction; no duration, no original',
    async (code) => {
      const orderId = await order();
      const owner = await signIn('editor');
      const administrators = (
        await sql<{ id: string }>`select id from identity.users where role = 'administrator' and status = 'active'`.execute(admin())
      ).rows.length;
      await signIn('administrator');
      const clip = await cleanClip(orderId, owner.userId);
      current.videoProcessor.probeBehaviour = new VideoProcessingError(code);
      const mailsBefore = await pendingMails(orderId);
      const alertsBefore = await alerts();
      expect(await videos().processFile(clip.storedFileId)).toBe('quarantined');
      const row = await fileOf(clip.storedFileId);
      expect(row).toMatchObject({ state: 'quarantined', state_reason_code: 'type_mismatch', duration_seconds: null });
      expect(row.quarantined_at?.toISOString()).toBe(NOW);
      expect(await auditRows('media_file.quarantined', clip.mediaAssetId)).toHaveLength(1);
      expect((await pendingMails(orderId)) - mailsBefore).toBe(administrators + 1);
      expect((await alerts()) - alertsBefore).toBe(1);
      const auditDump = JSON.stringify(await auditRows('media_file.quarantined', clip.mediaAssetId));
      expect(auditDump).not.toMatch(/\.mp4|Pomiar|mov/);
      const admin1 = await signIn('administrator');
      const response = await admin1.panel.post(`${BASE}/${orderId}/media-assets/${clip.mediaAssetId}/download-url`, {
        variant: 'original',
      });
      expect(response.status).toBe(404);
    },
  );

  it('EVM-046 AC2 the new scan of EVM-049 can bring it back: the second quarantine keeps the FIRST quarantined_at, adds no second e-mail and no second alert, and the duration stays empty', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const clip = await cleanClip(orderId, owner.userId);
    current.videoProcessor.probeBehaviour = new VideoProcessingError('unsupported');
    expect(await videos().processFile(clip.storedFileId)).toBe('quarantined');
    const mails = await pendingMails(orderId);
    const alertCount = await alerts();
    // the new scan ended clean (quarantined -> scanning -> clean keeps quarantined_at and the attempts)
    await sql`update media.stored_files set state = 'clean', state_reason_code = null where id = ${clip.storedFileId}`.execute(admin());
    current.clock.set(LATER);
    expect(await videos().processFile(clip.storedFileId)).toBe('quarantined');
    const row = await fileOf(clip.storedFileId);
    expect(row.state).toBe('quarantined');
    expect(row.quarantined_at?.toISOString()).toBe(NOW);
    expect(row.duration_seconds).toBeNull();
    expect(await pendingMails(orderId)).toBe(mails);
    expect(await alerts()).toBe(alertCount);
    expect(await auditRows('media_file.quarantined', clip.mediaAssetId)).toHaveLength(2);
  });

  it('EVM-046 AC2 an original that is not the scanned one (another checksum) is never given to the processor: failed', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const clip = await cleanClip(orderId, owner.userId, { recordedSha: sha256Of('another body') });
    expect(await videos().processFile(clip.storedFileId)).toBe('failed');
    expect(await fileOf(clip.storedFileId)).toMatchObject({
      state: 'failed',
      state_reason_code: 'processing_error',
      duration_seconds: null,
    });
  });
});

describe('EVM-046 AC5 a failure of the processing is the failure of the processing, not of the file', () => {
  it('EVM-046 AC5 a timeout of the transcoding is permanent: failed/processing_error at once, the duration (recorded before) stays, the original stays releasable for a scanned film', async () => {
    const orderId = await order();
    const owner = await signIn('administrator');
    const clip = await cleanClip(orderId, owner.userId);
    current.videoProcessor.transcodeBehaviour = new VideoProcessingError('timeout');
    expect(await videos().processFile(clip.storedFileId)).toBe('failed');
    expect(await fileOf(clip.storedFileId)).toMatchObject({
      state: 'failed',
      state_reason_code: 'processing_error',
      duration_seconds: 243,
    });
    expect((await derivativesOf(clip.storedFileId)).length).toBe(0);
    const response = await owner.panel.post(`${BASE}/${orderId}/media-assets/${clip.mediaAssetId}/download-url`, { variant: 'original' });
    expect(response.status).toBe(200);
    expect(
      (await owner.panel.post(`${BASE}/${orderId}/media-assets/${clip.mediaAssetId}/download-url`, { variant: 'preview' })).status,
    ).toBe(404);
  });

  it('EVM-046 AC5 a crash of the processor is retried once and then failed; an unreachable processor gives the take back', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const clip = await cleanClip(orderId, owner.userId);
    current.videoProcessor.probeBehaviour = new VideoProcessingError('internal');
    expect(await videos().processFile(clip.storedFileId)).toBe('retry');
    expect((await fileOf(clip.storedFileId)).process_attempts).toBe(1);
    // the stale period passes
    current.clock.set('2026-10-31T09:30:00.000Z');
    expect(await videos().processFile(clip.storedFileId)).toBe('failed');
    expect((await fileOf(clip.storedFileId)).process_attempts).toBe(MAX_VIDEO_PROCESSING_ATTEMPTS);

    const other = await cleanClip(orderId, owner.userId);
    current.videoProcessor.probeBehaviour = new VideoProcessingError('unreachable');
    expect(await videos().processFile(other.storedFileId)).toBe('deferred');
    expect(await fileOf(other.storedFileId)).toMatchObject({ state: 'processing', process_attempts: 0 });
  });

  it('EVM-046 AC5 a file with no recorded type or checksum is not processable: failed', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const clip = await cleanClip(orderId, owner.userId);
    await sql`update media.stored_files set content_type = 'image/png' where id = ${clip.storedFileId}`.execute(admin());
    expect(await videos().processFile(clip.storedFileId)).toBe('failed');
  });
});

describe('EVM-046 AC5 the work area: no room is no attempt', () => {
  it('EVM-046 AC5 without room the film is left as it is, no attempt is used, the counter goes up (no labels) and the pass stops', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const clip = await cleanClip(orderId, owner.userId);
    current.videoProcessor.roomLeft = false;
    const metrics = current.app.get<MetricsRegistry>(METRICS, { strict: false });
    const before = metrics
      .snapshot()
      .filter((sample) => sample.name === VIDEO_WORKAREA_FULL_METRIC)
      .reduce((sum, sample) => sum + sample.value, 0);
    expect(await videos().processFile(clip.storedFileId)).toBe('deferred');
    expect(await fileOf(clip.storedFileId)).toMatchObject({ state: 'clean', process_attempts: 0 });
    expect(await videos().runOnce()).toBe(0);
    const after = metrics
      .snapshot()
      .filter((sample) => sample.name === VIDEO_WORKAREA_FULL_METRIC)
      .reduce((sum, sample) => sum + sample.value, 0);
    expect(after - before).toBe(2);
    expect(
      metrics
        .snapshot()
        .filter((sample) => sample.name === VIDEO_WORKAREA_FULL_METRIC)
        .every((sample) => Object.keys(sample.labels).length === 0),
    ).toBe(true);
    current.videoProcessor.roomLeft = true;
    expect(await videos().processFile(clip.storedFileId)).toBe('ready');
  });

  it('EVM-046 AC5 a missing file is skipped', async () => {
    expect(await videos().processFile('0198a7a0-0000-7000-8000-0000000000ff')).toBe('skipped');
  });
});

describe('EVM-046 AC5 the concurrency of films is ONE, in the database', () => {
  it('EVM-046 AC5 two takes at the same moment (two replicas): exactly one film is transcoded, the other is skipped; a photo is not held back', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const first = await cleanClip(orderId, owner.userId);
    const second = await cleanClip(orderId, owner.userId);
    const photo = await cleanClip(orderId, owner.userId, { mediaType: 'photo' });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    current.videoProcessor.probeBehaviour = async () => {
      await gate;
      return SYNTHETIC_PROBE;
    };
    // a second instance with the same database stands for a second replica of the worker (its own in-process guard)
    const replica = new VideoProcessingService({
      db: current.app.get<Kysely<Database>>(DATABASE, { strict: false }),
      clock: current.clock,
      events: current.app.get<EventBus>(EVENT_BUS, { strict: false }),
      logger: current.app.get<Logger>(LOGGER, { strict: false }),
      storage: current.storage,
      processor: current.videoProcessor,
      administrators: () => Promise.resolve([]),
    });
    const attempts = [videos().processFile(first.storedFileId), replica.processFile(second.storedFileId)];
    // wait until one of them is inside the processor
    for (let tries = 0; tries < 200 && current.videoProcessor.running === 0; tries += 1)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(current.videoProcessor.running).toBe(1);
    // the photo is processed meanwhile
    expect(await photos().processFile(photo.storedFileId)).toBe('ready');
    const processingNow = (
      await sql<{ n: string }>`select count(*)::text as n from media.stored_files f join media.media_assets a on a.id = f.media_asset_id
        where a.media_type = 'video' and f.state = 'processing'`.execute(admin())
    ).rows[0]?.n;
    expect(processingNow).toBe('1');
    release();
    const outcomes = (await Promise.all(attempts)).sort();
    expect(outcomes).toEqual(['ready', 'skipped']);
    expect(current.videoProcessor.maxRunning).toBe(1);
    // the film that was skipped is taken by the next pass
    expect(await videos().runOnce()).toBe(1);
  });

  it('EVM-046 AC5 a film whose claim went stale (the worker died) does not block the others for ever', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const dead = await cleanClip(orderId, owner.userId);
    const next = await cleanClip(orderId, owner.userId);
    await sql`update media.stored_files set state = 'processing', process_attempts = 1, process_claimed_at = ${new Date(NOW)} where id = ${dead.storedFileId}`.execute(
      admin(),
    );
    expect(await videos().processFile(next.storedFileId)).toBe('skipped');
    current.clock.set('2026-10-31T08:30:00.000Z');
    expect(await videos().processFile(next.storedFileId)).toBe('ready');
  });
});

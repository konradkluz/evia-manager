import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MediaProcessingService, type MediaAuditEvent } from '../../src/modules/media/index.ts';
import type { EventBus } from '../../src/platform/events/event-bus.ts';
import type { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { EVENT_BUS, METRICS } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { insertMedia, sha256Of } from '../support/media-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

const NOW = '2026-10-30T08:00:00.000Z';
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
  current.logs.lines.length = 0;
  await clearWorkOrderCreation(current.database.admin);
  // the files of the earlier tests must not be taken by the loop of this one
  await sql`update media.stored_files set state = 'failed', state_reason_code = 'abandoned', process_attempts = 0 where state in ('clean', 'processing')`.execute(
    admin(),
  );
});

const admin = () => current.database.admin;
const processing = () => current.app.get(MediaProcessingService, { strict: false });

type Browser = Awaited<ReturnType<typeof signIn>>;

async function signIn(role: Role, channel: 'web' | 'mobile' = 'web') {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, { channel });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}

let numbering = 0;
async function order(): Promise<string> {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `download${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [{ number: `ZL-7${String(numbering).padStart(3, '0')}-0001`, customerId, siteId }]);
  return [...ids.values()][0] ?? '';
}

interface Photo {
  readonly mediaAssetId: string;
  readonly storedFileId: string;
  readonly objectKey: string;
}

/** A photo that passed the scan: `clean`, with the type, the size, the checksum and the pinned version the scan recorded. */
async function cleanPhoto(
  orderId: string,
  userId: string,
  options: { mediaType?: 'photo' | 'video'; contentType?: string; fileName?: string } = {},
): Promise<Photo> {
  const body = Buffer.alloc(4096, Math.floor(Math.random() * 200) + 1);
  const media = await insertMedia(admin(), {
    workOrderId: orderId,
    createdBy: userId,
    state: 'clean',
    size: body.length,
    sha256: sha256Of(body),
    createdAt: new Date(NOW),
    ...(options.fileName === undefined ? {} : { fileName: options.fileName }),
    // the client DECLARED a png; the scan below records the type the server detected
    contentType: 'image/png',
  });
  const put = current.storage.putObject(media.objectKey, body);
  await sql`update media.stored_files set content_type = ${options.contentType ?? 'image/jpeg'}, size_bytes = ${body.length},
      sha256 = ${sha256Of(body)}, s3_version_id = ${put.versionId}, s3_etag = ${put.etag}
      where id = ${media.storedFileId}`.execute(admin());
  if (options.mediaType !== undefined) {
    await sql`update media.media_assets set media_type = ${options.mediaType} where id = ${media.mediaAssetId}`.execute(admin());
  }
  return { mediaAssetId: media.mediaAssetId, storedFileId: media.storedFileId, objectKey: media.objectKey };
}

async function readyPhoto(orderId: string, userId: string, fileName = 'Zdjecie przylacza.jpg'): Promise<Photo> {
  const photo = await cleanPhoto(orderId, userId, { fileName });
  expect(await processing().processFile(photo.storedFileId)).toBe('ready');
  return photo;
}

const stateOf = (photo: Photo, state: string, reason: string | null) =>
  sql`update media.stored_files set state = ${state}, state_reason_code = ${reason},
    quarantined_at = ${state === 'quarantined' ? current.clock.now() : null} where id = ${photo.storedFileId}`.execute(admin());

const downloadUrl = (browser: Browser, orderId: string, mediaAssetId: string, body: unknown) =>
  browser.panel.post(`${BASE}/${orderId}/media-assets/${mediaAssetId}/download-url`, body);

const traceless = (answer: { status: number; body: unknown }) =>
  JSON.stringify({ status: answer.status, body: { ...(answer.body as object), traceId: undefined, instance: undefined } });

const auditOf = (action: string, mediaAssetId: string) =>
  sql<Record<string, unknown>>`select * from audit.events where action = ${action} and object_id = ${mediaAssetId} order by occurred_at, id`
    .execute(admin())
    .then((result) => result.rows);

const alertCount = (): number =>
  current.app
    .get<MetricsRegistry>(METRICS, { strict: false })
    .snapshot()
    .filter((sample) => sample.name === 'signed_url_alert')
    .reduce((total, sample) => total + sample.value, 0);

describe('EVM-045 AC2 AC3 the signed address of the original', () => {
  it('EVM-045 AC2 Editor gets an attachment address: the scanned version, the type the server detected, 300 s, a cleaned name, the host of the bucket', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const photo = await readyPhoto(orderId, editor.userId, 'Zdjęcie "przyłącza"; nr 7.jpg');
    const response = await downloadUrl(editor, orderId, photo.mediaAssetId, { variant: 'original' });
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.body as { url: string; expiresAt: string };
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'url']);
    expect(new Date(body.expiresAt).getTime() - current.clock.now().getTime()).toBe(300_000);
    const url = new URL(body.url);
    expect(url.hostname).toBe('bucket.invalid');
    expect(url.pathname).toBe(`/${photo.objectKey}`);
    // the type the server DETECTED (image/jpeg), not the declaration of the client (image/png)
    expect(url.searchParams.get('response-content-type')).toBe('image/jpeg');
    expect(url.searchParams.get('response-content-disposition')).toBe(
      'attachment; filename="Zdjecie przy_acza nr 7.jpg"; filename*=UTF-8\'\'Zdj%C4%99cie%20przy%C5%82%C4%85cza%20nr%207.jpg',
    );
    const stored = (
      await sql<{ s3_version_id: string }>`select s3_version_id from media.stored_files where id = ${photo.storedFileId}`.execute(admin())
    ).rows[0];
    expect(url.searchParams.get('versionId')).toBe(stored?.s3_version_id);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(current.storage.signedGets.at(-1)).toMatchObject({ expiresInSeconds: 300, cacheControl: 'private, no-store' });
  });

  it('EVM-045 AC3 the address of an original writes ONE audit event (who, which medium, when, outcome) and nothing else; a derivative writes none', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const photo = await readyPhoto(orderId, editor.userId, 'Imię Nazwisko przyłącze.jpg');
    await downloadUrl(editor, orderId, photo.mediaAssetId, { variant: 'thumbnail' });
    await downloadUrl(editor, orderId, photo.mediaAssetId, { variant: 'preview' });
    expect(await auditOf('media_file.original_downloaded', photo.mediaAssetId)).toHaveLength(0);
    const response = await downloadUrl(editor, orderId, photo.mediaAssetId, { variant: 'original' });
    const rows = await auditOf('media_file.original_downloaded', photo.mediaAssetId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_user_id: editor.userId,
      outcome: 'success',
      object_type: 'media_asset',
      object_id: photo.mediaAssetId,
      origin: 'web',
    });
    expect(rows[0]?.['occurred_at']).toEqual(current.clock.now());
    const dump = JSON.stringify(rows[0]);
    for (const secret of [(response.body as { url: string }).url, 'Imi', photo.objectKey, 'bucket.invalid', orderId])
      expect(dump).not.toContain(secret);
  });

  it('EVM-045 AC3 a failed audit means no address (fail closed) and no event stays', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const photo = await readyPhoto(orderId, editor.userId);
    let fail = true;
    current.app.get<EventBus>(EVENT_BUS, { strict: false }).subscribe<MediaAuditEvent>('media_file.original_downloaded', () => {
      if (fail) return Promise.reject(new Error('synthetic audit failure'));
      return Promise.resolve();
    });
    try {
      const response = await downloadUrl(editor, orderId, photo.mediaAssetId, { variant: 'original' });
      expect(response.status).toBe(500);
      expect(JSON.stringify(response.body)).not.toMatch(/bucket\.invalid|X-Amz/);
      expect(await auditOf('media_file.original_downloaded', photo.mediaAssetId)).toHaveLength(0);
    } finally {
      fail = false;
    }
  });

  it('EVM-045 AC3 the address, the name of the file and the key of the object are not written to the log (SR-LOG-02)', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const photo = await readyPhoto(orderId, editor.userId, 'Jan Kowalski przyłącze.jpg');
    const response = await downloadUrl(editor, orderId, photo.mediaAssetId, { variant: 'original' });
    const url = (response.body as { url: string }).url;
    const logs = current.logs.lines.join('\n');
    for (const secret of [
      new URL(url).searchParams.get('X-Amz-Signature') ?? 'synthetic',
      'response-content-disposition',
      'Kowalski',
      'Jan%20',
      photo.objectKey,
      'bucket.invalid',
    ]) {
      expect(logs).not.toContain(secret);
    }
  });
});

describe('EVM-045 AC4 AC7 the roles by variant', () => {
  it('EVM-045 AC7 the matrix: Administrator and Editor 200 for all three variants, Read-only 200, 200 and 403 forbidden for the original, anonymous 401, a mobile token 403 (the guard refuses the channel), no CSRF token 403', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const photo = await readyPhoto(orderId, owner.userId);
    const expected: Record<Role, number[]> = {
      administrator: [200, 200, 200],
      editor: [200, 200, 200],
      read_only: [200, 200, 403],
    };
    for (const [role, statuses] of Object.entries(expected) as Array<[Role, number[]]>) {
      const caller = await signIn(role);
      for (const [index, variant] of (['thumbnail', 'preview', 'original'] as const).entries()) {
        const answer = await downloadUrl(caller, orderId, photo.mediaAssetId, { variant });
        expect(answer.status, `${role} ${variant}`).toBe(statuses[index]);
        if (answer.status === 403) expect(answer.body).toMatchObject({ code: 'forbidden' });
      }
    }
    const anonymous = { userId: '', panel: new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN) };
    const mobile = await signIn('editor', 'mobile');
    const noCsrf = await signIn('editor');
    noCsrf.panel.csrfToken = undefined;
    for (const variant of ['thumbnail', 'preview', 'original'] as const) {
      expect((await downloadUrl(anonymous, orderId, photo.mediaAssetId, { variant })).status, `anonymous ${variant}`).toBe(401);
      const refused = await downloadUrl(mobile, orderId, photo.mediaAssetId, { variant });
      expect(refused.status, `mobile ${variant}`).toBe(403);
      expect(refused.body).toMatchObject({ code: 'forbidden' });
      expect((await downloadUrl(noCsrf, orderId, photo.mediaAssetId, { variant })).status, `no csrf ${variant}`).toBe(403);
    }
  });

  it('EVM-045 AC4 Read-only asking for an original is a 403 BEFORE the lookup of the medium: an existing and a missing medium give the same answer; the refusal is audited', async () => {
    const orderId = await order();
    const owner = await signIn('administrator');
    const photo = await readyPhoto(orderId, owner.userId);
    const reader = await signIn('read_only');
    const answers = [
      await downloadUrl(reader, orderId, photo.mediaAssetId, { variant: 'original' }),
      await downloadUrl(reader, orderId, uuidv7(), { variant: 'original' }),
    ];
    expect(answers.map((answer) => answer.status)).toEqual([403, 403]);
    expect(new Set(answers.map(traceless)).size).toBe(1);
    expect(current.storage.signedGets).toHaveLength(0);
    const denied = await auditOf('media_file.original_download_denied', photo.mediaAssetId);
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ actor_user_id: reader.userId, outcome: 'denied', object_type: 'media_asset' });
    expect(await auditOf('media_file.original_downloaded', photo.mediaAssetId)).toHaveLength(0);
  });
});

describe('EVM-045 AC6 the files that are not served', () => {
  it('EVM-045 AC6 the original is served only in clean, ready and failed with processing_error; every other state, the medium of order B through order A and a missing medium are ONE 404', async () => {
    const orderA = await order();
    const orderB = await order();
    const owner = await signIn('administrator');
    const unavailable: Array<[string, string | null]> = [
      ['pending_upload', null],
      ['uploaded', null],
      ['scanning', null],
      ['quarantined', 'malware_detected'],
      ['quarantined', 'type_mismatch'],
      ['failed', 'checksum_mismatch'],
      ['failed', 'malware_detected'],
      ['failed', 'type_mismatch'],
      ['failed', 'abandoned'],
    ];
    const refused = [];
    for (const [state, reason] of unavailable) {
      const media = await cleanPhoto(orderA, owner.userId);
      await stateOf(media, state, reason);
      refused.push(await downloadUrl(owner, orderA, media.mediaAssetId, { variant: 'original' }));
    }
    const foreign = await cleanPhoto(orderB, owner.userId);
    refused.push(await downloadUrl(owner, orderA, foreign.mediaAssetId, { variant: 'original' }));
    refused.push(await downloadUrl(owner, orderA, uuidv7(), { variant: 'original' }));
    expect(refused.every((answer) => answer.status === 404)).toBe(true);
    expect(new Set(refused.map(traceless)).size).toBe(1);
    expect(current.storage.signedGets).toHaveLength(0);

    for (const [state, reason] of [
      ['clean', null],
      ['ready', null],
      ['failed', 'processing_error'],
    ] as const) {
      const media = await cleanPhoto(orderA, owner.userId);
      await stateOf(media, state, reason);
      expect((await downloadUrl(owner, orderA, media.mediaAssetId, { variant: 'original' })).status, `${state}/${reason}`).toBe(200);
    }
    // a derivative needs `ready` AND the row of the variant: a clean file has neither
    const clean = await cleanPhoto(orderA, owner.userId);
    expect((await downloadUrl(owner, orderA, clean.mediaAssetId, { variant: 'preview' })).status).toBe(404);
  });

  it('EVM-045 AC6 a video has no original address until EVM-046 (404); every address of a photo is on the host of the bucket', async () => {
    const orderId = await order();
    const owner = await signIn('administrator');
    const video = await cleanPhoto(orderId, owner.userId, { mediaType: 'video', contentType: 'video/mp4' });
    expect((await downloadUrl(owner, orderId, video.mediaAssetId, { variant: 'original' })).status).toBe(404);
    const photo = await readyPhoto(orderId, owner.userId);
    for (const variant of ['thumbnail', 'preview', 'original'] as const) {
      const url = new URL(((await downloadUrl(owner, orderId, photo.mediaAssetId, { variant })).body as { url: string }).url);
      expect(url.hostname).toBe('bucket.invalid');
    }
  });
});

describe('EVM-045 AC5 the limits of issuing addresses', () => {
  it('EVM-045 AC5 the 101st original in 10 minutes is 429 rate_limited with Retry-After; one alert from the 51st (log, metric, audit); the first refusal audited once; derivatives are another class; the window slides', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const photo = await readyPhoto(orderId, editor.userId);
    const alertsBefore = alertCount();
    for (let index = 0; index < 100; index += 1) {
      expect((await downloadUrl(editor, orderId, photo.mediaAssetId, { variant: 'original' })).status, `original ${index + 1}`).toBe(200);
    }
    const alerts = current.logs.lines.filter((line) => line.includes('mass_download'));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain('"alert":"security"');
    expect(alerts[0]).not.toMatch(/bucket\.invalid|X-Amz|przy/);
    expect(alertCount() - alertsBefore).toBe(1);
    expect(await auditOf('media_file.download_alerted', photo.mediaAssetId)).toHaveLength(1);

    const first = await downloadUrl(editor, orderId, photo.mediaAssetId, { variant: 'original' });
    const second = await downloadUrl(editor, orderId, photo.mediaAssetId, { variant: 'original' });
    expect([first.status, second.status]).toEqual([429, 429]);
    expect(first.body).toMatchObject({ code: 'rate_limited' });
    expect(Number(first.headers['retry-after'])).toBeGreaterThan(0);
    expect(await auditOf('media_file.download_rejected', photo.mediaAssetId)).toHaveLength(1);
    // a refusal adds nothing: exactly 100 addresses were signed and audited
    expect(current.storage.signedGets).toHaveLength(100);
    expect(await auditOf('media_file.original_downloaded', photo.mediaAssetId)).toHaveLength(100);

    expect((await downloadUrl(editor, orderId, photo.mediaAssetId, { variant: 'thumbnail' })).status).toBe(200);
    expect((await downloadUrl(await signIn('administrator'), orderId, photo.mediaAssetId, { variant: 'original' })).status).toBe(200);

    current.clock.set(new Date(current.clock.now().getTime() + 11 * 60_000).toISOString());
    expect((await downloadUrl(editor, orderId, photo.mediaAssetId, { variant: 'original' })).status).toBe(200);
  }, 120_000);

  it('EVM-045 AC5 concurrent requests at the threshold get exactly 100 addresses of the original', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const photo = await readyPhoto(orderId, editor.userId);
    const answers = await Promise.all(
      Array.from({ length: 120 }, () => downloadUrl(editor, orderId, photo.mediaAssetId, { variant: 'original' })),
    );
    expect(answers.filter((answer) => answer.status === 200)).toHaveLength(100);
    expect(answers.filter((answer) => answer.status === 429)).toHaveLength(20);
    expect(current.storage.signedGets).toHaveLength(100);
  }, 120_000);
});

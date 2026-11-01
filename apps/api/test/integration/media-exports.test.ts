import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MediaExportBuilder } from '../../src/modules/media/index.ts';
import type { FileState } from '../../src/modules/media/domain/scan-outcome.ts';
import { DERIVATIVE_URL_SECONDS, EXPORT_STORAGE } from '../../src/platform/object-storage/object-storage.ts';
import { DELETION_REGISTER } from '../../src/platform/deletion-register/deletion-register.ts';
import { InMemoryDeletionRegister } from '../../src/platform/deletion-register/in-memory-deletion-register.ts';
import { CLOCK } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role, type UserFixture } from '../support/identity-fixtures.ts';
import { insertMedia, sha256Of } from '../support/media-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';
import { readZip } from '../support/zip-reader.ts';

const NOW = '2026-11-01T08:00:00.000Z';
const BASE = '/api/v1/work-orders';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp({
    now: NOW,
    configure: (builder) =>
      builder.overrideProvider(DELETION_REGISTER).useFactory({
        inject: [CLOCK],
        factory: (clock: IdentityApp['clock']) => new InMemoryDeletionRegister(clock),
      }),
  });
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  current.clock.set(NOW);
  current.storage.unavailable = false;
  current.exportStorage.unavailable = false;
  current.exportStorage.reset();
  current.exportStorage.signedGets.length = 0;
  current.logs.lines.length = 0;
  await clearWorkOrderCreation(current.database.admin);
});

const admin = () => current.database.admin;
const builder = () => current.app.get(MediaExportBuilder, { strict: false });

interface Person {
  readonly user: UserFixture;
  readonly panel: PanelClient;
}

/** A browser of a user; `fresh` = the passkey was used a moment ago (the step-up window of 15 minutes is open). */
async function browser(user: UserFixture, options: { fresh?: boolean; channel?: 'web' | 'mobile' } = {}): Promise<Person> {
  const session = await createSession(admin(), current.clock, user, {
    channel: options.channel ?? 'web',
    ...(options.fresh === false ? {} : { passkeyAuthenticatedAt: current.clock.now() }),
  });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { user, panel };
}

async function person(role: Role, options: { fresh?: boolean } = {}): Promise<Person> {
  return browser(await createUser(admin(), current.clock, { role }), options);
}

let numbering = 0;
async function order(): Promise<string> {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `export${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [{ number: `ZL-5${String(numbering).padStart(3, '0')}-0001`, customerId, siteId }]);
  return [...ids.values()][0] ?? '';
}

interface Photo {
  readonly mediaAssetId: string;
  readonly storedFileId: string;
  readonly body: Buffer;
}

async function deletedOrder(): Promise<string> {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `export${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [
    { number: `ZL-5${String(numbering).padStart(3, '0')}-0001`, customerId, siteId, deletedAt: new Date(NOW) },
  ]);
  return [...ids.values()][0] ?? '';
}

/** An order with 205 ready photos of 50 MB: more than 10 GiB (the rows are what the plan looks at; the originals are not needed until a build). */
async function heavyOrder(userId: string): Promise<{ orderId: string; fileIds: string[] }> {
  const orderId = await order();
  const fileIds: string[] = [];
  for (let index = 0; index < 205; index += 1) fileIds.push((await readyPhoto(orderId, userId, `heavy-${index}.jpg`)).storedFileId);
  return { orderId, fileIds };
}

const grow = (orderId: string): Promise<unknown> =>
  sql`update media.stored_files set size_bytes = 52428800 where media_asset_id in (select id from media.media_assets where work_order_id = ${orderId})`.execute(
    admin(),
  );

/** A photo that is `ready`: scanned, with the type, the size, the pinned version and the ETag the scan recorded; the original is in the bucket of the media. */
async function readyPhoto(orderId: string, userId: string, fileName = 'Zdjecie przylacza.jpg', state: FileState = 'ready'): Promise<Photo> {
  const body = Buffer.alloc(2048, Math.floor(Math.random() * 200) + 1);
  const media = await insertMedia(admin(), {
    workOrderId: orderId,
    createdBy: userId,
    state,
    ...(state === 'quarantined' ? { reason: 'malware_detected' as const } : {}),
    size: body.length,
    sha256: sha256Of(body),
    createdAt: new Date(NOW),
    fileName,
  });
  const put = current.storage.putObject(media.objectKey, body);
  await sql`update media.stored_files set content_type = 'image/jpeg', size_bytes = ${body.length}, sha256 = ${sha256Of(body)},
      s3_version_id = ${put.versionId}, s3_etag = ${put.etag} where id = ${media.storedFileId}`.execute(admin());
  return { mediaAssetId: media.mediaAssetId, storedFileId: media.storedFileId, body };
}

const key = (): Record<string, string> => ({ 'Idempotency-Key': uuidv7() });
const order_ = (who: Person, orderId: string, headers: Record<string, string> = key()) =>
  who.panel.post(`${BASE}/${orderId}/media-exports`, undefined, headers);
const getExport = (who: Person, orderId: string, exportId: string) => who.panel.get(`${BASE}/${orderId}/media-exports/${exportId}`);
const listExports = (who: Person, orderId: string) => who.panel.get(`${BASE}/${orderId}/media-exports`);
const link = (who: Person, orderId: string, exportId: string) =>
  who.panel.post(`${BASE}/${orderId}/media-exports/${exportId}/download-url`);

/** Orders an export as `who` and lets the worker build it. */
async function readyExport(who: Person, orderId: string): Promise<string> {
  const answer = await order_(who, orderId);
  expect(answer.status, JSON.stringify(answer.body)).toBe(202);
  const exportId = (answer.body as { exportId: string }).exportId;
  await builder().runOnce();
  return exportId;
}

const rowOf = async (exportId: string) =>
  (await sql<Record<string, unknown>>`select * from media.media_exports where id = ${exportId}`.execute(admin())).rows[0];
const auditOf = (action: string, objectId: string) =>
  sql<Record<string, unknown>>`select * from audit.events where action = ${action} and object_id = ${objectId} order by occurred_at, id`
    .execute(admin())
    .then((result) => result.rows);
const minutes = (count: number): void => {
  current.clock.advance(count * 60_000);
};

describe('EVM-052 AC1 the export of the photos of an order', () => {
  it('EVM-052 AC1 an Editor orders the export of 48 ready photos; the worker builds the ZIP; the ready export is downloaded once; the files in quarantine and the unready are not in it', async () => {
    const editor = await person('editor');
    const orderId = await order();
    for (let index = 0; index < 48; index += 1) await readyPhoto(orderId, editor.user.id, `IMG_${index}.jpg`);
    await readyPhoto(orderId, editor.user.id, 'quarantined.jpg', 'quarantined');
    await readyPhoto(orderId, editor.user.id, 'uploading.jpg', 'scanning');

    const ordered = await order_(editor, orderId);
    expect(ordered.status).toBe(202);
    const { exportId, state } = ordered.body as { exportId: string; state: string };
    expect(state).toBe('queued');
    expect((await getExport(editor, orderId, exportId)).body).toMatchObject({ id: exportId, workOrderId: orderId, state: 'queued' });

    expect(await builder().runOnce()).toBe(1);
    const status = (await getExport(editor, orderId, exportId)).body as Record<string, unknown>;
    expect(status).toMatchObject({ state: 'ready', fileCount: 48 });
    expect(JSON.stringify(status)).not.toMatch(/exports\/|\.zip|http/);

    const row = await rowOf(exportId);
    const stored = current.exportStorage.read(String(row?.['object_key']));
    expect(stored?.contentType).toBe('application/zip');
    expect(stored?.cacheControl).toBe('private, no-store');
    const entries = readZip(stored?.body ?? Buffer.alloc(0));
    expect(entries).toHaveLength(48);
    expect(entries.map((entry) => entry.name).every((name) => /^\d{3}-IMG_\d+\.jpg$/.test(name))).toBe(true);
    expect(entries.some((entry) => /quarantined|uploading/.test(entry.name))).toBe(false);
    expect(status['sizeBytes']).toBe(stored?.body.length);
    // the ZIP does not live in the bucket of the media
    expect(current.storage.currentKeys().some((candidate) => candidate.startsWith('exports/'))).toBe(false);

    const first = await link(editor, orderId, exportId);
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toContain('no-store');
    expect(new URL((first.body as { url: string }).url).pathname).toBe(`/${String(row?.['object_key'])}`);
    expect((await link(editor, orderId, exportId)).status).toBe(404);
    expect((await getExport(editor, orderId, exportId)).body).toMatchObject({ state: 'downloaded' });
  });

  it('EVM-052 AC1 the address is signed by the server: 300 seconds at most, application/zip, an attachment named from the number of the order, no store', async () => {
    const editor = await person('editor');
    const orderId = await order();
    await readyPhoto(orderId, editor.user.id);
    const exportId = await readyExport(editor, orderId);
    const answer = await link(editor, orderId, exportId);
    expect(answer.status).toBe(200);
    const signed = current.exportStorage.signedGets.at(-1);
    expect(signed).toMatchObject({
      contentType: 'application/zip',
      expiresInSeconds: DERIVATIVE_URL_SECONDS,
      cacheControl: 'private, no-store',
    });
    expect(signed?.disposition.kind).toBe('attachment');
    expect(JSON.stringify(signed?.disposition)).toMatch(/"filename":"ZL-5\d{3}-0001-zdjecia\.zip"/);
    expect((answer.body as { expiresAt: string }).expiresAt).toBe(new Date(current.clock.now().getTime() + 300_000).toISOString());
    // the name of the file comes from the order: no customer, no address
    expect(JSON.stringify(signed)).not.toMatch(/example\.invalid/);
  });

  it('EVM-052 AC1 an order without a ready photo: 409 no_media_to_export, and nothing in the quarantine is counted in the answer', async () => {
    const editor = await person('editor');
    const orderId = await order();
    await readyPhoto(orderId, editor.user.id, 'q.jpg', 'quarantined');
    const answer = await order_(editor, orderId);
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ code: 'no_media_to_export' });
    expect(JSON.stringify(answer.body)).not.toMatch(/\d+ (file|plik)/i);
    expect((await sql`select 1 from media.media_exports`.execute(admin())).rows).toHaveLength(0);
  });

  it('EVM-052 AC1 a photo the worker finds erased before the end is not offered: the exports of the order end and the object goes (SR-PRIV-04)', async () => {
    const editor = await person('editor');
    const orderId = await order();
    const photo = await readyPhoto(orderId, editor.user.id);
    await readyPhoto(orderId, editor.user.id, 'second.jpg');
    const ordered = (await order_(editor, orderId)).body as { exportId: string };
    // the file of the first photo is erased after the order and before the worker takes it
    await sql`update media.stored_files set erased_at = ${NOW}, original_filename = null where id = ${photo.storedFileId}`.execute(admin());
    await builder().runOnce();
    // the set was computed AGAIN: the erased photo is not in the archive
    const row = await rowOf(ordered.exportId);
    const archive = readZip(current.exportStorage.read(String(row?.['object_key']))?.body ?? Buffer.alloc(0));
    expect(archive).toHaveLength(1);
    expect(archive[0]?.name).toMatch(/second\.jpg$/);
  });

  it('EVM-052 AC1 the erasure of a file by the Administrator ends the active exports of the order, and the sweep removes their objects (SR-PRIV-04, SR-DATA-07)', async () => {
    const editor = await person('editor');
    const administrator = await person('administrator');
    const orderId = await order();
    const photo = await readyPhoto(orderId, editor.user.id);
    await readyPhoto(orderId, editor.user.id, 'second.jpg');
    const exportId = await readyExport(editor, orderId);
    const objectKey = String((await rowOf(exportId))?.['object_key']);
    expect(current.exportStorage.read(objectKey)).toBeDefined();

    const erased = await administrator.panel.post(`${BASE}/${orderId}/media-assets/${photo.mediaAssetId}/purge-file`, undefined, {
      'If-Match': '"1"',
    });
    expect(erased.status, JSON.stringify(erased.body)).toBe(204);
    expect((await getExport(editor, orderId, exportId)).status).toBe(404);
    expect((await link(editor, orderId, exportId)).status).toBe(404);

    await builder().runOnce();
    expect(current.exportStorage.isDeleted(objectKey)).toBe(true);
    expect(await rowOf(exportId)).toMatchObject({ state: 'expired' });
    expect((await rowOf(exportId))?.['object_removed_at']).not.toBeNull();
  });

  it('EVM-052 AC1 a photo erased while the archive is being built is never offered: the archive is not ready, the export ends and the object is removed', async () => {
    const editor = await person('editor');
    const orderId = await order();
    const photo = await readyPhoto(orderId, editor.user.id);
    await readyPhoto(orderId, editor.user.id, 'second.jpg');
    const exportId = ((await order_(editor, orderId)).body as { exportId: string }).exportId;
    // the erasure lands between the build and the mark: the files are read, then the row of the photo changes (the version the archive holds is gone)
    const original = current.storage.getObjectStream.bind(current.storage);
    let hooked = false;
    current.storage.getObjectStream = async (objectKey, pin) => {
      const stream = await original(objectKey, pin);
      if (!hooked) {
        hooked = true;
        await sql`update media.stored_files set erased_at = ${NOW}, original_filename = null where id = ${photo.storedFileId}`.execute(
          admin(),
        );
      }
      return stream;
    };
    try {
      await builder().runOnce();
    } finally {
      current.storage.getObjectStream = original;
    }
    expect((await getExport(editor, orderId, exportId)).status).toBe(404);
    expect(await rowOf(exportId)).toMatchObject({ state: 'expired' });
    await builder().runOnce();
    expect((await rowOf(exportId))?.['object_removed_at']).not.toBeNull();
    expect(current.exportStorage.currentKeys()).toEqual([]);
  });
});

describe('EVM-052 AC2 the limits of a user (SR-FILE-09, P10)', () => {
  it('EVM-052 AC2 an export 5 minutes ago: 429 export_rate_limited with Retry-After; after 10 minutes the next is accepted', async () => {
    const editor = await person('editor');
    const orderId = await order();
    await readyPhoto(orderId, editor.user.id);
    expect((await order_(editor, orderId)).status).toBe(202);
    minutes(5);
    const refused = await order_(editor, orderId);
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ code: 'export_rate_limited' });
    expect(refused.headers['retry-after']).toBe('300');
    minutes(5);
    expect((await order_(editor, orderId)).status).toBe(202);
  });

  it('EVM-052 AC2 the sixth export within 24 hours is refused though the 10 minutes passed; failed exports count too; after the window it is accepted again', async () => {
    const editor = await person('editor');
    const orderId = await order();
    await readyPhoto(orderId, editor.user.id);
    for (let count = 0; count < 5; count += 1) {
      expect((await order_(await browser(editor.user), orderId)).status, `export ${count + 1}`).toBe(202);
      minutes(11);
    }
    // two of the five failed: they count all the same
    await sql`update media.media_exports set state = 'failed', failure_code = 'storage_unavailable' where requested_by = ${editor.user.id} and state = 'queued'`.execute(
      admin(),
    );
    const refused = await order_(await browser(editor.user), orderId);
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ code: 'export_rate_limited' });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(3600);
    current.clock.advance(24 * 3_600_000);
    expect((await order_(await browser(editor.user), orderId)).status).toBe(202);
  });

  it('EVM-052 AC2 photos above 10 GiB: 429 export_too_large, no export is created and the refusal is audited', async () => {
    const editor = await person('editor');
    const { orderId } = await heavyOrder(editor.user.id);
    await grow(orderId);
    const refused = await order_(editor, orderId);
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ code: 'export_too_large' });
    expect((await sql`select 1 from media.media_exports where requested_by = ${editor.user.id}`.execute(admin())).rows).toHaveLength(0);
    const audit = await auditOf('media_export.rate_limited', orderId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_user_id: editor.user.id, outcome: 'denied', object_type: 'work_order' });
    expect(JSON.stringify(audit[0])).not.toMatch(/Zdjecie|jpg/);
  });

  it('EVM-052 AC2 two concurrent orders of one user (two keys): exactly one 202 and one 429 export_rate_limited, one row', async () => {
    const editor = await person('editor');
    const orderId = await order();
    await readyPhoto(orderId, editor.user.id);
    const [a, b] = await Promise.all([order_(editor, orderId), order_(editor, orderId)]);
    expect([a.status, b.status].sort()).toEqual([202, 429]);
    expect((await sql`select 1 from media.media_exports where requested_by = ${editor.user.id}`.execute(admin())).rows).toHaveLength(1);
  });

  it('EVM-052 AC2 the audit of a limit has the actor and the order and no personal data; the first export is audited as requested', async () => {
    const editor = await person('editor');
    const orderId = await order();
    await readyPhoto(orderId, editor.user.id);
    const exportId = ((await order_(editor, orderId)).body as { exportId: string }).exportId;
    minutes(1);
    expect((await order_(editor, orderId)).status).toBe(429);
    expect(await auditOf('media_export.requested', exportId)).toHaveLength(1);
    const limited = await auditOf('media_export.rate_limited', orderId);
    expect(limited).toHaveLength(1);
    expect(limited[0]).toMatchObject({ actor_user_id: editor.user.id, outcome: 'denied' });
  });

  it('EVM-052 AC2 an idempotent repeat returns the SAME export, is not counted again and is marked as a replay; another order with the same key is 422', async () => {
    const editor = await person('editor');
    const orderId = await order();
    const other = await order();
    await readyPhoto(orderId, editor.user.id);
    await readyPhoto(other, editor.user.id);
    const headers = key();
    const first = await order_(editor, orderId, headers);
    const second = await order_(editor, orderId, headers);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect((second.body as { exportId: string }).exportId).toBe((first.body as { exportId: string }).exportId);
    expect((await sql`select 1 from media.media_exports where requested_by = ${editor.user.id}`.execute(admin())).rows).toHaveLength(1);
    // the same key for another order does not create a second export or step around the limit
    const mismatch = await order_(editor, other, headers);
    expect(mismatch.status).toBe(422);
    expect(mismatch.body).toMatchObject({ code: 'idempotency_mismatch' });
    expect((await sql`select 1 from media.media_exports where requested_by = ${editor.user.id}`.execute(admin())).rows).toHaveLength(1);
    // a missing or a malformed key is 400
    expect((await order_(editor, orderId, {})).status).toBe(400);
    expect((await order_(editor, orderId, { 'Idempotency-Key': 'not-a-key' })).status).toBe(400);
  });
});

describe('EVM-052 AC3 the e-mail to the Administrators, the alert and the audit (SR-FILE-09, SR-LOG-07)', () => {
  it('EVM-052 AC3 every ACTIVE Administrator gets an e-mail with the link to the order only; a deactivated one does not; the alert and the audit event are written', async () => {
    const editor = await person('editor');
    const first = await createUser(admin(), current.clock, { role: 'administrator' });
    const second = await createUser(admin(), current.clock, { role: 'administrator' });
    const gone = await createUser(admin(), current.clock, { role: 'administrator', status: 'deactivated' });
    const orderId = await order();
    await readyPhoto(orderId, editor.user.id);
    const exportId = ((await order_(editor, orderId)).body as { exportId: string }).exportId;

    const mails = await sql<{ recipient_user_id: string; kind: string }>`select recipient_user_id, kind from platform.email_outbox
      where variant = 'administrator_media_export_started' and subject_id = ${orderId}`.execute(admin());
    const recipients = mails.rows.map((row) => row.recipient_user_id);
    expect(recipients).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(recipients).not.toContain(gone.id);
    expect(recipients).not.toContain(editor.user.id);
    expect(mails.rows.every((row) => row.kind === 'administrator_alert')).toBe(true);
    const alert =
      await sql`select * from platform.security_alert_outbox where alert_code = 'media_export_started' and occurred_at = ${NOW}`.execute(
        admin(),
      );
    expect(alert.rows.length).toBeGreaterThanOrEqual(1);
    const audit = await auditOf('media_export.requested', exportId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_user_id: editor.user.id, outcome: 'success', object_type: 'media_export' });
  });

  it('EVM-052 AC3 a refused order leaves no mail and no alert (the same transaction)', async () => {
    const editor = await person('editor');
    await createUser(admin(), current.clock, { role: 'administrator' });
    const orderId = await order();
    const before = await sql<{
      n: string;
    }>`select count(*)::text as n from platform.email_outbox where variant = 'administrator_media_export_started'`.execute(admin());
    expect((await order_(editor, orderId)).status).toBe(409);
    const after = await sql<{
      n: string;
    }>`select count(*)::text as n from platform.email_outbox where variant = 'administrator_media_export_started'`.execute(admin());
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it('EVM-052 AC3 the audit of the build has the system as the actor; the ready and the downloaded events carry neither a name nor an address', async () => {
    const editor = await person('editor');
    const orderId = await order();
    await readyPhoto(orderId, editor.user.id, 'Jan Kowalski ul. Dluga 5.jpg');
    const exportId = await readyExport(editor, orderId);
    await link(editor, orderId, exportId);
    const events = [
      ...(await auditOf('media_export.ready', exportId)),
      ...(await auditOf('media_export.downloaded', exportId)),
      ...(await auditOf('media_export.requested', exportId)),
    ];
    expect(events.map((event) => event['action'])).toEqual(['media_export.ready', 'media_export.downloaded', 'media_export.requested']);
    expect(events[0]).toMatchObject({ actor_type: 'system', outcome: 'success' });
    expect(events[1]).toMatchObject({ actor_user_id: editor.user.id });
    const text = JSON.stringify(events);
    expect(text).not.toMatch(/Kowalski|Dluga|\.jpg|\.zip|X-Amz|exports\//);
    expect(current.logs.lines.join('\n')).not.toMatch(/Kowalski|Dluga|\.zip|X-Amz|exports\/20/);
  });
});

describe('EVM-052 AC4 the file is removed after 24 hours (SR-DATA-07)', () => {
  it('EVM-052 AC4 an export of 2026-10-05 10:00: at 2026-10-06 10:01 the link is 404 at once, and the sweep removes the object, writes the end and the audit', async () => {
    current.clock.set('2026-10-05T08:00:00.000Z'); // 10:00 in Warsaw
    const editor = await person('editor');
    const orderId = await order();
    await readyPhoto(orderId, editor.user.id);
    const exportId = await readyExport(editor, orderId);
    const objectKey = String((await rowOf(exportId))?.['object_key']);
    expect(current.exportStorage.read(objectKey)).toBeDefined();

    // before the end of the life the export works
    current.clock.set('2026-10-06T07:59:00.000Z');
    const early = await browser(editor.user);
    expect((await getExport(early, orderId, exportId)).status).toBe(200);

    current.clock.set('2026-10-06T08:01:00.000Z'); // 10:01 the next day
    const later = await browser(editor.user);
    expect((await getExport(later, orderId, exportId)).status).toBe(404);
    expect((await link(later, orderId, exportId)).status).toBe(404);
    expect(((await listExports(later, orderId)).body as { items: unknown[] }).items).toEqual([]);
    // the job has not run yet: the object is still there, but nobody can reach it
    expect(current.exportStorage.isDeleted(objectKey)).toBe(false);

    await builder().runOnce();
    expect(current.exportStorage.isDeleted(objectKey)).toBe(true);
    const row = await rowOf(exportId);
    expect(row).toMatchObject({ state: 'expired' });
    expect(row?.['object_removed_at']).not.toBeNull();
    expect(await auditOf('media_export.expired', exportId)).toHaveLength(1);
    // a second run changes nothing (idempotent)
    await builder().runOnce();
    expect(await auditOf('media_export.expired', exportId)).toHaveLength(1);
  });

  it('EVM-052 AC4 a storage that fails during the sweep leaves the row for the next pass: the end is written only after the object is confirmed removed', async () => {
    const editor = await person('editor');
    const orderId = await order();
    await readyPhoto(orderId, editor.user.id);
    const exportId = await readyExport(editor, orderId);
    const objectKey = String((await rowOf(exportId))?.['object_key']);
    current.clock.advance(25 * 3_600_000);
    current.exportStorage.unavailable = true;
    await builder().runOnce();
    expect((await rowOf(exportId))?.['object_removed_at']).toBeNull();
    expect(current.exportStorage.isDeleted(objectKey)).toBe(false);
    current.exportStorage.unavailable = false;
    await builder().runOnce();
    expect(current.exportStorage.isDeleted(objectKey)).toBe(true);
    expect((await rowOf(exportId))?.['object_removed_at']).not.toBeNull();
  });

  it('EVM-052 AC4 an export that was never built and is past its life is ended without an object', async () => {
    const editor = await person('editor');
    const orderId = await order();
    await readyPhoto(orderId, editor.user.id);
    const exportId = ((await order_(editor, orderId)).body as { exportId: string }).exportId;
    current.clock.advance(25 * 3_600_000);
    await builder().runOnce();
    expect(await rowOf(exportId)).toMatchObject({ state: 'expired' });
    expect(current.exportStorage.currentKeys()).toEqual([]);
  });
});

describe('EVM-052 AC5 who may order an export (SR-AUTHZ-06, SR-SESS-08, SR-AUTHZ-05)', () => {
  it('EVM-052 AC5 an Administrator and an Editor need a step-up (403 step_up_required) and get 202 after it', async () => {
    const orderId = await order();
    for (const role of ['administrator', 'editor'] as const) {
      const user = await createUser(admin(), current.clock, { role });
      await readyPhoto(orderId, user.id, `${role}.jpg`);
      const stale = await browser(user, { fresh: false });
      const refused = await order_(stale, orderId);
      expect(refused.status, role).toBe(403);
      expect(refused.body, role).toMatchObject({ code: 'step_up_required' });
      expect((await order_(await browser(user), orderId)).status, role).toBe(202);
      minutes(11);
    }
  });

  it('EVM-052 AC5 Read-only gets 403 forbidden (not step_up_required), an unauthenticated caller 401, a token of the phone 403 channel_not_allowed; a call without the CSRF token is refused', async () => {
    const orderId = await order();
    const reader = await person('read_only');
    const denied = await order_(reader, orderId);
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: 'forbidden' });
    const anonymous = await request(current.app.getHttpServer())
      .post(`${BASE}/${orderId}/media-exports`)
      .set('Origin', PANEL_ORIGIN)
      .set('Idempotency-Key', uuidv7());
    expect(anonymous.status).toBe(401);
    const phone = await person('editor');
    const mobile = await browser(phone.user, { channel: 'mobile' });
    const viaPhone = await order_(mobile, orderId);
    expect(viaPhone.status).toBe(403);
    const editor = await person('editor');
    editor.panel.csrfToken = undefined;
    const noToken = await order_(editor, orderId);
    expect(noToken.status).toBe(403);
    expect(noToken.body).toMatchObject({ code: 'csrf_failed' });
  });

  it('EVM-052 AC5 the reads and the address are web only: a token of the phone is refused on all four operations; an anonymous caller is 401', async () => {
    const orderId = await order();
    const user = await createUser(admin(), current.clock, { role: 'editor' });
    const mobile = await browser(user, { channel: 'mobile' });
    const id = uuidv7();
    expect((await listExports(mobile, orderId)).status).toBe(403);
    expect((await getExport(mobile, orderId, id)).status).toBe(403);
    expect((await link(mobile, orderId, id)).status).toBe(403);
    const server = current.app.getHttpServer();
    expect((await request(server).get(`${BASE}/${orderId}/media-exports`)).status).toBe(401);
    expect((await request(server).get(`${BASE}/${orderId}/media-exports/${id}`)).status).toBe(401);
    expect((await request(server).post(`${BASE}/${orderId}/media-exports/${id}/download-url`).set('Origin', PANEL_ORIGIN)).status).toBe(
      401,
    );
  });

  it('EVM-052 AC5 a bucket of the exports that is not configured (no MEDIA_EXPORT_BUCKET) answers 503 media_storage_unavailable and orders nothing (fail closed)', async () => {
    const editor = await person('editor');
    const orderId = await order();
    await readyPhoto(orderId, editor.user.id);
    const stripped = await createIdentityApp({
      now: NOW,
      database: current.database,
      configure: (builder_) => builder_.overrideProvider(EXPORT_STORAGE).useValue(null),
    });
    try {
      const panel = new PanelClient(stripped.app.getHttpServer(), PANEL_ORIGIN);
      const session = await createSession(admin(), current.clock, editor.user, { passkeyAuthenticatedAt: current.clock.now() });
      panel.cookie = session.cookie;
      panel.csrfToken = session.csrfToken;
      const answer = await panel.post(`${BASE}/${orderId}/media-exports`, undefined, key());
      expect(answer.status).toBe(503);
      expect(answer.body).toMatchObject({ code: 'media_storage_unavailable' });
      expect((await sql`select 1 from media.media_exports where requested_by = ${editor.user.id}`.execute(admin())).rows).toHaveLength(0);
      const noWorker = stripped.app.get(MediaExportBuilder, { strict: false });
      expect(noWorker.enabled).toBe(false);
      expect(await noWorker.runOnce()).toBe(0);
    } finally {
      await stripped.app.close();
    }
  });
});

describe('EVM-052 AC6 states of the export', () => {
  it('EVM-052 AC6 a storage that fails during the build gives `failed` with a closed code, no message of the storage and an audit event; the export counts to the limit', async () => {
    const editor = await person('editor');
    const orderId = await order();
    await readyPhoto(orderId, editor.user.id);
    const exportId = ((await order_(editor, orderId)).body as { exportId: string }).exportId;
    current.exportStorage.unavailable = true;
    await builder().runOnce();
    const status = await getExport(editor, orderId, exportId);
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ state: 'failed', failureCode: 'storage_unavailable' });
    expect(JSON.stringify(status.body)).not.toMatch(/ObjectStorage|bucket|exports\//i);
    expect(await auditOf('media_export.failed', exportId)).toHaveLength(1);
    expect((await link(editor, orderId, exportId)).status).toBe(404);
    minutes(11);
    current.exportStorage.unavailable = false;
    expect((await order_(await browser(editor.user), orderId)).status).toBe(202);
  });

  it('EVM-052 AC6 a photo whose original cannot be read (the version is gone) gives `failed` / processing_error and leaves no object', async () => {
    const editor = await person('editor');
    const orderId = await order();
    const photo = await readyPhoto(orderId, editor.user.id);
    const exportId = ((await order_(editor, orderId)).body as { exportId: string }).exportId;
    await sql`update media.stored_files set s3_version_id = 'version-missing' where id = ${photo.storedFileId}`.execute(admin());
    await builder().runOnce();
    expect((await getExport(editor, orderId, exportId)).body).toMatchObject({ state: 'failed', failureCode: 'processing_error' });
    expect(current.exportStorage.currentKeys()).toEqual([]);
    expect(current.exportStorage.streamedUploads.aborted).toBeGreaterThanOrEqual(1);
  });

  it('EVM-052 AC6 when the photos are gone by the time the worker builds, the export is failed / no_media; when they grew above the limit, failed / too_large', async () => {
    const editor = await person('editor');
    const gone = await order();
    const photo = await readyPhoto(gone, editor.user.id);
    const first = ((await order_(editor, gone)).body as { exportId: string }).exportId;
    await sql`update media.media_assets set deleted_at = ${NOW}, deleted_by = ${editor.user.id} where id = ${photo.mediaAssetId}`.execute(
      admin(),
    );
    await builder().runOnce();
    expect((await getExport(editor, gone, first)).body).toMatchObject({ state: 'failed', failureCode: 'no_media' });

    minutes(11);
    const { orderId: big } = await heavyOrder(editor.user.id);
    const second = ((await order_(await browser(editor.user), big)).body as { exportId: string }).exportId;
    await grow(big);
    await builder().runOnce();
    expect((await getExport(await browser(editor.user), big, second)).body).toMatchObject({ state: 'failed', failureCode: 'too_large' });
  });

  it('EVM-052 AC6 a stop of the worker during the build aborts the upload and puts the SAME export back in the queue; the next pass builds it', async () => {
    const editor = await person('editor');
    const orderId = await order();
    await readyPhoto(orderId, editor.user.id);
    const exportId = ((await order_(editor, orderId)).body as { exportId: string }).exportId;
    const original = current.storage.getObjectStream.bind(current.storage);
    const worker: { stop?: () => Promise<void> } = {};
    current.storage.getObjectStream = async (objectKey, pin) => {
      const stream = await original(objectKey, pin);
      // the stop of the worker arrives while the originals are being read
      void worker.stop?.();
      return stream;
    };
    worker.stop = builder().start(3_600_000);
    try {
      const pass = builder().runOnce();
      await pass.catch(() => undefined);
      await worker.stop();
    } finally {
      current.storage.getObjectStream = original;
    }
    expect(await rowOf(exportId)).toMatchObject({ state: 'queued', started_at: null });
    expect(current.exportStorage.currentKeys()).toEqual([]);
    await builder().runOnce();
    expect((await getExport(editor, orderId, exportId)).body).toMatchObject({ state: 'ready' });
  });

  it('EVM-052 AC6 an export left `running` by a worker that died is taken again after the stale period', async () => {
    const editor = await person('editor');
    const orderId = await order();
    await readyPhoto(orderId, editor.user.id);
    const exportId = ((await order_(editor, orderId)).body as { exportId: string }).exportId;
    await sql`update media.media_exports set state = 'running', started_at = ${NOW} where id = ${exportId}`.execute(admin());
    await builder().runOnce();
    expect(await rowOf(exportId)).toMatchObject({ state: 'running' });
    current.clock.advance(4 * 3_600_000);
    await builder().runOnce();
    expect(await rowOf(exportId)).toMatchObject({ state: 'ready' });
  });
});

describe('EVM-052 AC7 only the requester sees and downloads the export (SR-AUTHZ-06, CWE-639)', () => {
  it('EVM-052 AC7 another Administrator, another Editor and Read-only get 404 on the state and the address, an empty list; the requester gets 200', async () => {
    const owner = await person('editor');
    const orderId = await order();
    await readyPhoto(orderId, owner.user.id);
    const exportId = await readyExport(owner, orderId);
    const strangers = [await person('administrator'), await person('editor'), await person('read_only')];
    const answers: string[] = [];
    for (const stranger of strangers) {
      const state = await getExport(stranger, orderId, exportId);
      const address = await link(stranger, orderId, exportId);
      const list = await listExports(stranger, orderId);
      expect([state.status, address.status, list.status], stranger.user.id).toEqual([404, 404, 200]);
      expect((list.body as { items: unknown[] }).items).toEqual([]);
      answers.push(JSON.stringify({ ...(state.body as object), traceId: undefined, instance: undefined }));
    }
    // the same body for every stranger and for an export that does not exist (no oracle of existence)
    const missing = await getExport(strangers[0] as Person, orderId, uuidv7());
    answers.push(JSON.stringify({ ...(missing.body as object), traceId: undefined, instance: undefined }));
    expect(new Set(answers).size).toBe(1);
    expect((await listExports(owner, orderId)).body).toMatchObject({ items: [{ id: exportId, state: 'ready' }] });
    expect((await link(owner, orderId, exportId)).status).toBe(200);
    expect(await auditOf('media_export.downloaded', exportId)).toHaveLength(1);
  });

  it('EVM-052 AC7 the own export named under the path of ANOTHER order, a deleted order and an order that does not exist: the same 404', async () => {
    const owner = await person('editor');
    const orderId = await order();
    const other = await order();
    await readyPhoto(orderId, owner.user.id);
    const exportId = await readyExport(owner, orderId);
    const deleted = await deletedOrder();
    for (const path of [other, deleted, uuidv7()]) {
      expect((await getExport(owner, path, exportId)).status, path).toBe(404);
      expect((await link(owner, path, exportId)).status, path).toBe(404);
    }
    // the list of ANOTHER live order is simply empty (the export is not there); a deleted or missing order is 404
    expect(((await listExports(owner, other)).body as { items: unknown[] }).items).toEqual([]);
    for (const path of [deleted, uuidv7()]) expect((await listExports(owner, path)).status, path).toBe(404);
    // the export is still unused: the failed attempts did not consume it
    expect((await link(owner, orderId, exportId)).status).toBe(200);
  });

  it('EVM-052 AC7 the role and the account are checked at the moment of the call: an Editor demoted to Read-only, or an account deactivated, after the order gets no address (the former employee)', async () => {
    const orderId = await order();
    for (const change of ['demoted', 'deactivated'] as const) {
      const owner = await person('editor');
      await readyPhoto(orderId, owner.user.id, `${change}.jpg`);
      const exportId = await readyExport(owner, orderId);
      if (change === 'demoted') await sql`update identity.users set role = 'read_only' where id = ${owner.user.id}`.execute(admin());
      else
        await sql`update identity.users set status = 'deactivated', deactivated_at = ${NOW} where id = ${owner.user.id}`.execute(admin());
      const answer = await link(owner, orderId, exportId);
      expect([401, 403, 404], change).toContain(answer.status);
      expect(current.exportStorage.signedGets.some((entry) => entry.key.includes(exportId))).toBe(false);
      const row = await rowOf(exportId);
      expect(row?.['downloaded_at'], change).toBeNull();
      minutes(11);
    }
  });

  it('EVM-052 AC7 two concurrent calls for the address of one export: exactly one 200 and one 404 (the link works once)', async () => {
    const owner = await person('editor');
    const orderId = await order();
    await readyPhoto(orderId, owner.user.id);
    const exportId = await readyExport(owner, orderId);
    const answers = await Promise.all([link(owner, orderId, exportId), link(owner, orderId, exportId), link(owner, orderId, exportId)]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 404, 404]);
    expect(await auditOf('media_export.downloaded', exportId)).toHaveLength(1);
  });

  it('EVM-052 AC7 an address that could not be signed does not consume the export (the storage is down: 503, the next call works)', async () => {
    const owner = await person('editor');
    const orderId = await order();
    await readyPhoto(orderId, owner.user.id);
    const exportId = await readyExport(owner, orderId);
    current.exportStorage.unavailable = true;
    const failed = await link(owner, orderId, exportId);
    expect(failed.status).toBe(503);
    expect(failed.body).toMatchObject({ code: 'media_storage_unavailable' });
    expect((await rowOf(exportId))?.['downloaded_at']).toBeNull();
    expect(await auditOf('media_export.downloaded', exportId)).toHaveLength(0);
    current.exportStorage.unavailable = false;
    expect((await link(owner, orderId, exportId)).status).toBe(200);
  });

  it('EVM-052 AC7 the address and the key never appear in the log; the state of a queued or running export is not downloadable', async () => {
    const owner = await person('editor');
    const orderId = await order();
    await readyPhoto(orderId, owner.user.id);
    const queued = ((await order_(owner, orderId)).body as { exportId: string }).exportId;
    expect((await link(owner, orderId, queued)).status).toBe(404);
    await builder().runOnce();
    const answer = await link(owner, orderId, queued);
    const url = (answer.body as { url: string }).url;
    expect(answer.status).toBe(200);
    const log = current.logs.lines.join('\n');
    expect(log).not.toContain(url);
    expect(log).not.toMatch(/X-Amz|exports\/20\d\d/);
  });
});

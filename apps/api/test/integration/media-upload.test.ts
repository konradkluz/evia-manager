import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MediaScanService } from '../../src/modules/media/index.ts';
import { PART_SIZE_BYTES } from '../../src/modules/media/domain/upload-plan.ts';
import { EICAR } from '../../src/platform/malware-scan/fake-malware-scanner.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { insertMedia, sha256Of } from '../support/media-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';
import type { WorkOrderStatus } from '../../src/modules/work-orders/domain/work-order-status.ts';

const NOW = '2026-10-27T08:00:00.000Z';
const BASE = '/api/v1/work-orders';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  current.clock.set(NOW);
  current.storage.unavailable = false;
  current.scanner.mode = 'working';
  await clearWorkOrderCreation(current.database.admin);
});

const admin = () => current.database.admin;

async function signIn(role: Role = 'editor', channel: 'web' | 'mobile' = 'web') {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, { channel });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;

let numbering = 0;
async function order(options: { status?: WorkOrderStatus; deleted?: boolean } = {}): Promise<string> {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `jan${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [
    {
      number: `ZL-6${String(numbering).padStart(3, '0')}-0001`,
      customerId,
      siteId,
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(options.deleted === true ? { deletedAt: new Date('2026-10-02T08:00:00Z') } : {}),
    },
  ]);
  return [...ids.values()][0] ?? '';
}

/** A tiny synthetic JPEG: the signature and filler bytes — never a real photograph. */
const jpeg = (size = 2048, fill = 7): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), Buffer.alloc(size - 12, fill)]);
const png = (size = 2048): Buffer =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]),
    Buffer.alloc(size - 16),
  ]);

const itemFor = (body: Buffer, over: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  category: 'in_progress',
  fileName: 'IMG_0001.JPG',
  declaredSize: body.length,
  contentType: 'image/jpeg',
  sha256: sha256Of(body),
  ...over,
});

const createMedia = (browser: Browser, orderId: string, items: unknown[], key: string | null = uuidv7()) =>
  browser.panel.post(`${BASE}/${orderId}/media-assets`, { items }, key === null ? {} : { 'Idempotency-Key': key });
const createSessionFor = (browser: Browser, orderId: string, mediaAssetId: string, sessionId = uuidv7(), key = uuidv7()) =>
  browser.panel.post(`${BASE}/${orderId}/media-assets/${mediaAssetId}/upload-sessions`, { id: sessionId }, { 'Idempotency-Key': key });
const sessionPath = (orderId: string, mediaAssetId: string, sessionId: string) =>
  `${BASE}/${orderId}/media-assets/${mediaAssetId}/upload-sessions/${sessionId}`;
const listFor = (browser: Browser, orderId: string, query = '') => browser.panel.get(`${BASE}/${orderId}/media-assets${query}`);

interface MediaBody {
  id: string;
  fileState: string;
  stateReasonCode: string | null;
  needsAttention: boolean;
  originalFilename: string | null;
  uploadSession: { id: string } | null;
  declaredSize: number;
}
const mediaOf = (body: unknown) => body as MediaBody;
const codeOf = (body: unknown) => (body as { code?: string }).code;
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;

const fileRow = async (mediaAssetId: string) =>
  (
    await sql<{
      id: string;
      state: string;
      state_reason_code: string | null;
      object_key: string;
      sha256: string | null;
      content_type: string | null;
    }>`
      select id, state, state_reason_code, object_key, sha256, content_type from media.stored_files where media_asset_id = ${mediaAssetId}`.execute(
      admin(),
    )
  ).rows[0];
const uploadIdOf = async (sessionId: string): Promise<string> =>
  (await sql<{ s3_upload_id: string }>`select s3_upload_id from media.upload_sessions where id = ${sessionId}`.execute(admin())).rows[0]
    ?.s3_upload_id ?? '';
const auditCount = async (action: string): Promise<number> =>
  Number((await sql<{ n: string }>`select count(*)::text as n from audit.events where action = ${action}`.execute(admin())).rows[0]?.n);

/** The whole flow of the panel for one file: the medium, the session, the parts straight to the storage, `complete`. */
async function upload(browser: Browser, orderId: string, body: Buffer, over: Record<string, unknown> = {}) {
  const item = itemFor(body, over);
  const created = await createMedia(browser, orderId, [item]);
  expect(created.status).toBe(201);
  const session = await createSessionFor(browser, orderId, item.id);
  expect(session.status).toBe(201);
  const sessionId = (session.body as { id: string }).id;
  const uploadId = await uploadIdOf(sessionId);
  for (let part = 1; part <= (session.body as { partCount: number }).partCount; part += 1) {
    const url = await browser.panel.get(`${sessionPath(orderId, item.id, sessionId)}/parts/${part}/url`);
    expect(url.status).toBe(200);
    const start = (part - 1) * PART_SIZE_BYTES;
    current.storage.putPart(uploadId, part, body.subarray(start, start + (url.body as { contentLength: number }).contentLength));
  }
  const complete = await browser.panel.post(`${sessionPath(orderId, item.id, sessionId)}/complete`);
  return { item, sessionId, uploadId, complete };
}

const scan = () => current.app.get(MediaScanService, { strict: false });

describe('EVM-044 AC1 — a batch of media, the upload through signed URLs and the state "Sprawdzanie pliku" (SR-FILE-02, SR-API-05)', () => {
  it('EVM-044 AC1 an Editor adds 5 files: 201, every file pending_upload, no key, checksum or upload id in the answer, one journal event, 5 audit records', async () => {
    const editor = await signIn('editor');
    const orderId = await order();
    const items = Array.from({ length: 5 }, (_, index) => itemFor(jpeg(2048 + index), { fileName: `IMG_000${index}.JPG` }));
    const audits = await auditCount('media_asset.created');
    const response = await createMedia(editor, orderId, items);
    expect(response.status).toBe(201);
    const batch = (response.body as { items: MediaBody[] }).items;
    expect(batch.map((entry) => entry.id)).toEqual(items.map((entry) => entry.id));
    expect(
      batch.every((entry) => entry.fileState === 'pending_upload' && entry.originalFilename === null && entry.uploadSession === null),
    ).toBe(true);
    expect(JSON.stringify(response.body)).not.toMatch(/object_?key|media\/20|upload_?id|sha256|IMG_000/i);
    const journal = (
      await sql<{ event_payload: Record<string, unknown> }>`
        select event_payload from timeline.timeline_entries where work_order_id = ${orderId} and event_code = 'media_assets_added'`.execute(
        admin(),
      )
    ).rows;
    expect(journal).toHaveLength(1);
    expect(journal[0]?.event_payload).toEqual({
      objectType: 'work_order',
      objectId: orderId,
      count: 5,
      mediaAssetIds: items.map((entry) => entry.id),
    });
    expect(JSON.stringify(journal)).not.toContain('IMG_000');
    expect((await auditCount('media_asset.created')) - audits).toBe(5);
    const audited = (
      await sql<
        Record<string, unknown>
      >`select * from audit.events where action = 'media_asset.created' and object_id = ${items[0]?.id}`.execute(admin())
    ).rows;
    expect(audited[0]).toMatchObject({ actor_user_id: editor.userId, outcome: 'success', object_type: 'media_asset' });
    expect(JSON.stringify(audited)).not.toContain('IMG_000');
  });

  it('EVM-044 AC1 AC6 the key of the object is assigned by the server: media/{year}/{month}/{id of the file}/original — no name, no order number', async () => {
    const editor = await signIn('editor');
    const orderId = await order();
    const item = itemFor(jpeg(), { fileName: 'Kowalski-ul-Kwiatowa-7.jpg' });
    await createMedia(editor, orderId, [item]);
    const row = await fileRow(item.id);
    expect(row?.object_key).toBe(`media/2026/10/${row?.id}/original`);
    expect(row?.object_key).not.toMatch(/Kowalski|ZL-|Kwiatowa/);
  });

  it('EVM-044 AC1 a repeat with the same key and body returns the same media with Idempotent-Replayed, without a second event or audit; the same key on another order is 422', async () => {
    const editor = await signIn('editor');
    const orderId = await order();
    const items = [itemFor(jpeg())];
    const key = uuidv7();
    const first = await createMedia(editor, orderId, items, key);
    const audits = await auditCount('media_asset.created');
    const again = await createMedia(editor, orderId, items, key);
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body).toEqual(first.body);
    expect(await auditCount('media_asset.created')).toBe(audits);
    const other = await order();
    expect((await createMedia(editor, other, items, key)).status).toBe(422);
    expect(codeOf((await createMedia(editor, other, items, key)).body)).toBe('idempotency_mismatch');
  });

  it('EVM-044 AC1 an order that is closed still accepts media ("nic nie ginie")', async () => {
    const editor = await signIn('editor');
    const orderId = await order({ status: 'settled' });
    expect((await createMedia(editor, orderId, [itemFor(jpeg())])).status).toBe(201);
  });

  it('EVM-044 AC1 the Idempotency-Key is required, an empty or oversized batch and an existing identifier (any order, any user) are refused without detail', async () => {
    const editor = await signIn('editor');
    const stranger = await signIn('editor');
    const orderId = await order();
    const strangerOrder = await order();
    expect(codeOf((await createMedia(editor, orderId, [itemFor(jpeg())], null)).body)).toBe('validation_failed');
    expect((await createMedia(editor, orderId, [])).status).toBe(400);
    expect(
      (
        await createMedia(
          editor,
          orderId,
          Array.from({ length: 51 }, () => itemFor(jpeg())),
        )
      ).status,
    ).toBe(400);
    const taken = itemFor(jpeg());
    expect((await createMedia(stranger, strangerOrder, [taken])).status).toBe(201);
    for (const [browser, id] of [
      [editor, orderId],
      [stranger, strangerOrder],
    ] as const) {
      const clash = await createMedia(browser, id, [taken]);
      expect(clash.status).toBe(409);
      expect(codeOf(clash.body)).toBe('id_conflict');
      expect(JSON.stringify(clash.body)).not.toContain(strangerOrder);
    }
    const duplicate = itemFor(jpeg());
    expect(errorsOf((await createMedia(editor, orderId, [duplicate, duplicate])).body)).toContainEqual({
      pointer: '/items/1/id',
      code: 'duplicate',
    });
    expect((await createMedia(editor, orderId, [{ ...itemFor(jpeg()), id: '00000000-0000-4000-8000-000000000001' }])).status).toBe(400);
    expect((await createMedia(editor, orderId, [{ ...itemFor(jpeg()), objectKey: 'media/x' }])).status).toBe(400);
  });

  it('EVM-044 AC1 AC6 the session plans the parts (16 MiB, the last shorter); the URL of a part is signed for 3600 s with the exact length; the browser PUT and complete give uploaded', async () => {
    const editor = await signIn('editor');
    const orderId = await order();
    const body = jpeg(2048);
    const item = itemFor(body, { declaredSize: PART_SIZE_BYTES + 2048, sha256: 'b'.repeat(64) });
    await createMedia(editor, orderId, [item]);
    const session = await createSessionFor(editor, orderId, item.id);
    expect(session.status).toBe(201);
    expect(session.body).toMatchObject({ mediaAssetId: item.id, state: 'active', partSize: PART_SIZE_BYTES, partCount: 2 });
    expect(current.storage.contentTypes.at(-1)).toBe('image/jpeg');
    const sid = (session.body as { id: string }).id;
    const first = await editor.panel.get(`${sessionPath(orderId, item.id, sid)}/parts/1/url`);
    const last = await editor.panel.get(`${sessionPath(orderId, item.id, sid)}/parts/2/url`);
    expect(first.body).toMatchObject({ contentLength: PART_SIZE_BYTES });
    expect(last.body).toMatchObject({ contentLength: 2048 });
    expect(first.headers['cache-control']).toBe('no-store');
    expect(current.storage.presigned.at(-1)).toMatchObject({ partNumber: 2, contentLength: 2048, expiresInSeconds: 3600 });
    expect((await editor.panel.get(`${sessionPath(orderId, item.id, sid)}/parts/3/url`)).status).toBe(400);
    expect((await editor.panel.get(`${sessionPath(orderId, item.id, sid)}/parts/0/url`)).status).toBe(400);
    const uploadId = await uploadIdOf(sid);
    current.storage.putPart(uploadId, 1, Buffer.alloc(PART_SIZE_BYTES));
    const parts = await editor.panel.get(`${sessionPath(orderId, item.id, sid)}/parts`);
    expect(parts.body).toEqual({ items: [{ partNumber: 1, size: PART_SIZE_BYTES }] });
    // complete before the last part: the numbers say what is missing, nothing is assembled
    const early = await editor.panel.post(`${sessionPath(orderId, item.id, sid)}/complete`);
    expect(early.status).toBe(422);
    expect(codeOf(early.body)).toBe('upload_incomplete');
    expect(errorsOf(early.body)).toEqual([{ pointer: '', code: 'parts_missing' }]);
    current.storage.putPart(uploadId, 2, body);
    const done = await editor.panel.post(`${sessionPath(orderId, item.id, sid)}/complete`);
    expect(done.status).toBe(200);
    expect(mediaOf(done.body)).toMatchObject({ id: item.id, fileState: 'uploaded', needsAttention: false });
    // a repeat after the assembly is harmless
    const repeat = await editor.panel.post(`${sessionPath(orderId, item.id, sid)}/complete`);
    expect(repeat.status).toBe(200);
    expect(mediaOf(repeat.body).fileState).toBe('uploaded');
  });

  it('EVM-044 AC6 complete verifies the total: a part of a wrong length is 422 size_mismatch and nothing is assembled', async () => {
    const editor = await signIn('editor');
    const orderId = await order();
    const body = jpeg(4096);
    const item = itemFor(body);
    await createMedia(editor, orderId, [item]);
    const sid = ((await createSessionFor(editor, orderId, item.id)).body as { id: string }).id;
    current.storage.putPart(await uploadIdOf(sid), 1, body.subarray(0, 4000));
    const response = await editor.panel.post(`${sessionPath(orderId, item.id, sid)}/complete`);
    expect(response.status).toBe(422);
    expect(errorsOf(response.body)).toEqual([{ pointer: '', code: 'size_mismatch' }]);
    expect((await fileRow(item.id))?.state).toBe('pending_upload');
  });

  it('EVM-044 AC4 the list of the media returns the state of every file in one page with a cursor; "Sprawdzanie pliku" is uploaded or scanning', async () => {
    const editor = await signIn('editor');
    const orderId = await order();
    for (let index = 0; index < 3; index += 1) {
      current.clock.advance(1000);
      await insertMedia(admin(), { workOrderId: orderId, createdBy: editor.userId, state: 'uploaded', createdAt: current.clock.now() });
    }
    const first = await listFor(editor, orderId, '?limit=2');
    expect(first.status).toBe(200);
    expect((first.body as { items: unknown[]; nextCursor: string }).items).toHaveLength(2);
    const next = (first.body as { nextCursor: string }).nextCursor;
    expect(next).toMatch(/^[A-Za-z0-9_-]+$/);
    const second = await listFor(editor, orderId, `?limit=2&cursor=${next}`);
    expect((second.body as { items: unknown[]; nextCursor: null }).items).toHaveLength(1);
    expect((second.body as { nextCursor: null }).nextCursor).toBeNull();
    const ids = [...(first.body as { items: MediaBody[] }).items, ...(second.body as { items: MediaBody[] }).items].map(
      (entry) => entry.id,
    );
    expect(new Set(ids).size).toBe(3);
    expect((first.body as { items: MediaBody[] }).items.every((entry) => entry.fileState === 'uploaded')).toBe(true);
    expect(codeOf((await listFor(editor, orderId, '?cursor=bogus')).body)).toBe('invalid_cursor');
    const strangerOrder = await order();
    expect(codeOf((await listFor(editor, strangerOrder, `?limit=2&cursor=${next}`)).body)).toBe('invalid_cursor');
  });
});

describe('EVM-044 AC2 — the type and the size (SR-FILE-01, SR-FILE-03)', () => {
  it('EVM-044 AC2 a SVG, an HTML file, an archive and a file above 50 MB are refused before any upload, with pointers and codes only', async () => {
    const editor = await signIn('editor');
    const orderId = await order();
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [{ fileName: 'x.svg', contentType: 'image/svg+xml' }, '/items/0/contentType', 'unsupported_type'],
      [{ fileName: 'x.html', contentType: 'text/html' }, '/items/0/contentType', 'unsupported_type'],
      [{ fileName: 'x.zip', contentType: 'application/zip' }, '/items/0/contentType', 'unsupported_type'],
      [{ fileName: 'x.svg', contentType: 'image/jpeg' }, '/items/0/fileName', 'unsupported_type'],
      [{ declaredSize: 52_428_801 }, '/items/0/declaredSize', 'file_too_large'],
    ];
    for (const [over, pointer, code] of cases) {
      const response = await createMedia(editor, orderId, [{ ...itemFor(jpeg()), ...over }]);
      expect(response.status, JSON.stringify(over)).toBe(400);
      const errors = errorsOf(response.body) ?? [];
      // a size above the limit of the contract is refused by the schema, a type by the rules: both name the field and never the value
      expect(
        errors.some((error) => error.pointer === pointer),
        JSON.stringify(errors),
      ).toBe(true);
      expect(
        errors.every((error) => !JSON.stringify(error).includes('x.svg')),
        code,
      ).toBe(true);
    }
    expect(
      (await sql<{ n: string }>`select count(*)::text as n from media.media_assets where work_order_id = ${orderId}`.execute(admin()))
        .rows[0]?.n,
    ).toBe('0');
  });

  it('EVM-044 AC2 a .jpg whose content is a PNG is quarantined with type_mismatch after the scan', async () => {
    const editor = await signIn('editor');
    const orderId = await order();
    const body = png();
    const { item, complete } = await upload(editor, orderId, body);
    expect(complete.status).toBe(200);
    expect(await scan().runOnce()).toBe(1);
    expect(await fileRow(item.id)).toMatchObject({ state: 'quarantined', state_reason_code: 'type_mismatch', content_type: 'image/png' });
    const entry = ((await listFor(editor, orderId)).body as { items: MediaBody[] }).items[0];
    expect(entry).toMatchObject({ fileState: 'quarantined', needsAttention: true, stateReasonCode: null });
    expect(JSON.stringify(entry)).not.toMatch(/type_mismatch|malware/);
  });

  it('EVM-044 AC2 a genuine JPEG with a matching checksum becomes clean', async () => {
    const editor = await signIn('editor');
    const orderId = await order();
    const { item } = await upload(editor, orderId, jpeg());
    await scan().runOnce();
    expect(await fileRow(item.id)).toMatchObject({ state: 'clean', state_reason_code: null, content_type: 'image/jpeg' });
    expect((await fileRow(item.id))?.sha256).toBe(sha256Of(jpeg()));
  });
});

describe('EVM-044 AC3 — the scan fails closed (SR-FILE-05, SR-ERR-01, SR-ERR-02)', () => {
  it('EVM-044 AC3 with the scanner unavailable the file stays in scanning, is retried after the stale period, and is never clean without a scan', async () => {
    const editor = await signIn('editor');
    const orderId = await order();
    const { item } = await upload(editor, orderId, jpeg());
    current.scanner.mode = 'unavailable';
    expect(await scan().runOnce()).toBe(0);
    expect((await fileRow(item.id))?.state).toBe('scanning');
    expect(await scan().runOnce()).toBe(0); // not taken again at once: the stale period is the backoff
    expect(current.scanner.scans).toBeGreaterThan(0);
    current.scanner.mode = 'working';
    current.clock.advance(3 * 60_000);
    expect(await scan().runOnce()).toBe(1);
    expect((await fileRow(item.id))?.state).toBe('clean');
  });

  it('EVM-044 AC3 stopping the scan loop waits for the pass in progress: the file in the scanner gets its verdict before the stop settles', async () => {
    const editor = await signIn('editor');
    const orderId = await order();
    const { item } = await upload(editor, orderId, jpeg());
    const original = current.scanner.scan.bind(current.scanner);
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = (): void => undefined;
    const inScanner = new Promise<void>((resolve) => {
      entered = resolve;
    });
    current.scanner.scan = async (source) => {
      entered();
      await gate;
      return original(source);
    };
    try {
      const stop = scan().start(5);
      await inScanner;
      let settled = false;
      const stopped = stop().then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(settled).toBe(false);
      release();
      await stopped;
      expect((await fileRow(item.id))?.state).toBe('clean');
    } finally {
      release();
      Reflect.deleteProperty(current.scanner, 'scan');
    }
  });

  it('EVM-044 AC3 the EICAR test file is quarantined as malware_detected, audited without a name, and shows "Wymaga uwagi" without the reason', async () => {
    const editor = await signIn('editor');
    const orderId = await order();
    const body = Buffer.concat([jpeg(512), Buffer.from(EICAR)]);
    const { item } = await upload(editor, orderId, body, { fileName: 'foto-klienta.jpg' });
    await scan().runOnce();
    expect(await fileRow(item.id)).toMatchObject({ state: 'quarantined', state_reason_code: 'malware_detected' });
    const audited = (
      await sql<
        Record<string, unknown>
      >`select * from audit.events where action = 'media_file.quarantined' and object_id = ${item.id}`.execute(admin())
    ).rows;
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({ actor_type: 'system', outcome: 'success', object_type: 'media_asset' });
    expect(JSON.stringify(audited)).not.toContain('foto-klienta');
    const entry = ((await listFor(editor, orderId)).body as { items: MediaBody[] }).items[0];
    expect(entry).toMatchObject({ fileState: 'quarantined', needsAttention: true });
    expect(JSON.stringify(entry)).not.toMatch(/malware|eicar/i);
  });

  it('EVM-044 AC3 a second pass or a second worker never scans a file twice (compare-and-set)', async () => {
    const editor = await signIn('editor');
    const orderId = await order();
    const { item } = await upload(editor, orderId, jpeg());
    const file = await fileRow(item.id);
    const [a, b] = await Promise.all([scan().scanFile(file?.id ?? ''), scan().scanFile(file?.id ?? '')]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await scan().runOnce()).toBe(0);
  });

  it('EVM-044 AC3 a storage that cannot be read leaves the file in scanning (no verdict, no clean)', async () => {
    const editor = await signIn('editor');
    const orderId = await order();
    const { item } = await upload(editor, orderId, jpeg());
    current.storage.unavailable = true;
    expect(await scan().runOnce()).toBe(0);
    current.storage.unavailable = false;
    expect((await fileRow(item.id))?.state).toBe('scanning');
  });

  it('EVM-044 AC3 a file that has no recorded object of the declared length is never marked clean (an object longer than declared is a damaged transfer)', async () => {
    const editor = await signIn('editor');
    const orderId = await order();
    const stored = await insertMedia(admin(), { workOrderId: orderId, createdBy: editor.userId, state: 'uploaded', size: 100 });
    const put = current.storage.putObject(stored.objectKey, jpeg(500));
    await sql`update media.stored_files set s3_version_id = ${put.versionId}, s3_etag = ${put.etag} where id = ${stored.storedFileId}`.execute(
      admin(),
    );
    await scan().runOnce();
    expect(await fileRow(stored.mediaAssetId)).toMatchObject({ state: 'failed', state_reason_code: 'checksum_mismatch' });
  });
});

describe('EVM-044 AC5 — the integrity of the transfer (SR-CRYPTO-05)', () => {
  it('EVM-044 AC5 a declared SHA-256 that differs from the content gives failed/checksum_mismatch, shown as such; "Ponów" opens a new session for the same medium', async () => {
    const editor = await signIn('editor');
    const orderId = await order();
    const { item, sessionId } = await upload(editor, orderId, jpeg(), { sha256: 'c'.repeat(64) });
    await scan().runOnce();
    expect(await fileRow(item.id)).toMatchObject({ state: 'failed', state_reason_code: 'checksum_mismatch' });
    const shown = ((await listFor(editor, orderId)).body as { items: MediaBody[] }).items[0];
    expect(shown).toMatchObject({ fileState: 'failed', stateReasonCode: 'checksum_mismatch', needsAttention: false });
    const keyBefore = (await fileRow(item.id))?.object_key;
    const retry = await createSessionFor(editor, orderId, item.id);
    expect(retry.status).toBe(201);
    expect((retry.body as { id: string }).id).not.toBe(sessionId);
    expect(await fileRow(item.id)).toMatchObject({ state: 'pending_upload', state_reason_code: null, object_key: keyBefore, sha256: null });
  });

  it('EVM-044 AC5 a new session is refused (409) for a file in any other state: uploaded, scanning, clean, quarantined', async () => {
    const editor = await signIn('editor');
    const orderId = await order();
    for (const state of ['uploaded', 'scanning', 'clean', 'quarantined', 'ready'] as const) {
      const stored = await insertMedia(admin(), {
        workOrderId: orderId,
        createdBy: editor.userId,
        state,
        ...(state === 'quarantined' ? { reason: 'malware_detected' as const } : {}),
      });
      const response = await createSessionFor(editor, orderId, stored.mediaAssetId);
      expect(response.status, state).toBe(409);
      expect(codeOf(response.body)).toBe('invalid_state_transition');
    }
  });
});

describe('EVM-044 AC4 — the unfinished uploads of the user ("Nie wysłano N zdjęć")', () => {
  it('EVM-044 AC4 unfinished returns the active sessions AND the pending files without one (an interrupted batch) of the CALLER only, with the file name; the plain list never returns the name', async () => {
    const editor = await signIn('editor');
    const colleague = await signIn('editor');
    const orderId = await order();
    const mine = await insertMedia(admin(), {
      workOrderId: orderId,
      createdBy: editor.userId,
      fileName: 'IMG_0100.JPG',
      session: { userId: editor.userId },
    });
    await insertMedia(admin(), {
      workOrderId: orderId,
      createdBy: editor.userId,
      fileName: 'expired.jpg',
      session: { userId: editor.userId, expiresAt: new Date('2026-10-26T08:00:00Z') },
    });
    await insertMedia(admin(), {
      workOrderId: orderId,
      createdBy: editor.userId,
      fileName: 'aborted.jpg',
      session: { userId: editor.userId, state: 'aborted' },
    });
    await insertMedia(admin(), {
      workOrderId: orderId,
      createdBy: colleague.userId,
      fileName: 'colleague.jpg',
      session: { userId: colleague.userId },
    });
    const unfinished = await listFor(editor, orderId, '?uploadState=unfinished');
    expect(unfinished.status).toBe(200);
    const items = (unfinished.body as { items: MediaBody[] }).items;
    expect(items.map((entry) => entry.originalFilename).sort()).toEqual(['IMG_0100.JPG', 'aborted.jpg', 'expired.jpg']);
    expect(items.find((entry) => entry.id === mine.mediaAssetId)).toMatchObject({ uploadSession: { id: mine.sessionId } });
    expect(
      items
        .filter((entry) => entry.uploadSession === null)
        .map((entry) => entry.originalFilename)
        .sort(),
    ).toEqual(['aborted.jpg', 'expired.jpg']);
    const other = ((await listFor(colleague, orderId, '?uploadState=unfinished')).body as { items: MediaBody[] }).items;
    expect(other.map((entry) => entry.originalFilename)).toEqual(['colleague.jpg']);
    const plain = (await listFor(editor, orderId)).body as { items: MediaBody[] };
    expect(plain.items.every((entry) => entry.originalFilename === null && entry.uploadSession === null)).toBe(true);
    expect((await listFor(editor, orderId, '?uploadState=bogus')).status).toBe(400);
  });

  it('EVM-044 AC4 a batch interrupted half way is counted whole: pending files without a session count, uploaded ones and the ones of others do not', async () => {
    const editor = await signIn('editor');
    const colleague = await signIn('editor');
    const orderId = await order();
    const base = { workOrderId: orderId, createdBy: editor.userId };
    const withSession = await insertMedia(admin(), { ...base, fileName: 'a.jpg', session: { userId: editor.userId } });
    const noSession = await insertMedia(admin(), { ...base, fileName: 'b.jpg' });
    const never = await insertMedia(admin(), { ...base, fileName: 'c.jpg' });
    const done = await insertMedia(admin(), { ...base, fileName: 'done.jpg' });
    await sql`update media.stored_files set state = 'uploaded', state_changed_at = ${NOW} where media_asset_id = ${done.mediaAssetId}`.execute(
      admin(),
    );
    await insertMedia(admin(), { workOrderId: orderId, createdBy: colleague.userId, fileName: 'theirs.jpg' });
    const first = await listFor(editor, orderId, '?uploadState=unfinished&limit=2');
    const cursor = (first.body as { nextCursor: string }).nextCursor;
    const second = await listFor(editor, orderId, `?uploadState=unfinished&limit=2&cursor=${cursor}`);
    const all = [...(first.body as { items: MediaBody[] }).items, ...(second.body as { items: MediaBody[] }).items];
    expect(all.map((entry) => entry.id).sort()).toEqual([withSession.mediaAssetId, noSession.mediaAssetId, never.mediaAssetId].sort());
    expect(all.every((entry) => entry.originalFilename !== null && entry.declaredSize > 0)).toBe(true);
    expect((second.body as { nextCursor: string | null }).nextCursor).toBeNull();
  });

  it('EVM-044 AC4 choosing the file again resumes the active session of the caller (200, the same id) instead of creating a second one; another user gets 409 id_conflict', async () => {
    const editor = await signIn('editor');
    const colleague = await signIn('editor');
    const orderId = await order();
    const item = itemFor(jpeg());
    await createMedia(editor, orderId, [item]);
    const first = await createSessionFor(editor, orderId, item.id);
    expect(first.status).toBe(201);
    const again = await createSessionFor(editor, orderId, item.id);
    expect(again.status).toBe(200);
    expect((again.body as { id: string }).id).toBe((first.body as { id: string }).id);
    const boss = await signIn('administrator');
    const stranger = await createSessionFor(boss, orderId, item.id);
    expect(stranger.status).toBe(409);
    expect(codeOf(stranger.body)).toBe('id_conflict');
    expect(JSON.stringify(stranger.body)).not.toContain((first.body as { id: string }).id);
    expect((await createSessionFor(colleague, orderId, item.id)).status).toBe(404);
  });

  it('EVM-044 AC6 only the creator of the medium or an Administrator opens its session: a colleague gets 404 and nothing is created (CWE-639, RR-NOC-T1-8)', async () => {
    const editor = await signIn('editor');
    const colleague = await signIn('editor');
    const boss = await signIn('administrator');
    const orderId = await order();
    const [first, second] = [itemFor(jpeg()), itemFor(jpeg())];
    await createMedia(editor, orderId, [first, second]);
    const refused = await createSessionFor(colleague, orderId, first.id);
    expect(refused.status).toBe(404);
    expect(codeOf(refused.body)).toBe('not_found');
    const count = async (): Promise<string | undefined> =>
      (await sql<{ n: string }>`select count(*)::text as n from media.upload_sessions`.execute(admin())).rows[0]?.n;
    expect(await count()).toBe('0');
    expect((await createSessionFor(editor, orderId, first.id)).status).toBe(201);
    expect((await createSessionFor(boss, orderId, second.id)).status).toBe(201);
    expect(await count()).toBe('2');
  });

  it('EVM-044 AC4 repeating a creation whose session is gone (aborted, or expired and not yet swept) is 409 invalid_state_transition, not a 201 with an unusable session', async () => {
    const editor = await signIn('editor');
    const orderId = await order();
    const item = itemFor(jpeg());
    await createMedia(editor, orderId, [item]);
    const key = uuidv7();
    const created = await createSessionFor(editor, orderId, item.id, uuidv7(), key);
    expect(created.status).toBe(201);
    const sessionId = (created.body as { id: string }).id;
    const bodyId = sessionId;
    expect((await createSessionFor(editor, orderId, item.id, bodyId, key)).status).toBe(201);
    await sql`update media.upload_sessions set expires_at = ${new Date('2026-10-26T08:00:00Z')} where id = ${sessionId}`.execute(admin());
    const expired = await createSessionFor(editor, orderId, item.id, bodyId, key);
    expect(expired.status).toBe(409);
    expect(codeOf(expired.body)).toBe('invalid_state_transition');
    const fresh = await createSessionFor(editor, orderId, item.id);
    expect(fresh.status).toBe(201);
    const freshId = (fresh.body as { id: string }).id;
    const freshKey = uuidv7();
    expect((await createSessionFor(editor, orderId, item.id, freshId, freshKey)).status).toBe(200);
    expect((await editor.panel.post(`${sessionPath(orderId, item.id, freshId)}/abort`)).status).toBeLessThan(300);
    const again = await createSessionFor(editor, orderId, item.id, freshId, freshKey);
    expect(again.status).toBe(409);
    expect(codeOf(again.body)).toBe('invalid_state_transition');
  });

  it('EVM-044 AC4 an expired session is closed and a new one is created; the number of active sessions of a user is limited (429 with Retry-After)', async () => {
    const editor = await signIn('editor');
    const orderId = await order();
    const stale = await insertMedia(admin(), {
      workOrderId: orderId,
      createdBy: editor.userId,
      session: { userId: editor.userId, expiresAt: new Date('2026-10-26T08:00:00Z') },
    });
    const renewed = await createSessionFor(editor, orderId, stale.mediaAssetId);
    expect(renewed.status).toBe(201);
    expect(
      (await sql<{ state: string }>`select state from media.upload_sessions where id = ${stale.sessionId}`.execute(admin())).rows[0]?.state,
    ).toBe('expired');
    for (let index = 0; index < 99; index += 1)
      await insertMedia(admin(), { workOrderId: orderId, createdBy: editor.userId, session: { userId: editor.userId } });
    const target = await insertMedia(admin(), { workOrderId: orderId, createdBy: editor.userId });
    const refused = await createSessionFor(editor, orderId, target.mediaAssetId);
    expect(refused.status).toBe(429);
    expect(codeOf(refused.body)).toBe('rate_limited');
    expect(refused.headers['retry-after']).toBe('60');
  });

  it('EVM-044 AC4 abort closes the session and drops the upload; the file may get a new session; "Wstrzymaj" (no abort) keeps the confirmed parts', async () => {
    const editor = await signIn('editor');
    const orderId = await order();
    const item = itemFor(jpeg());
    await createMedia(editor, orderId, [item]);
    const session = (await createSessionFor(editor, orderId, item.id)).body as { id: string };
    current.storage.putPart(await uploadIdOf(session.id), 1, jpeg());
    expect((await editor.panel.get(`${sessionPath(orderId, item.id, session.id)}/parts`)).body).toMatchObject({
      items: [{ partNumber: 1 }],
    });
    const aborted = await editor.panel.post(`${sessionPath(orderId, item.id, session.id)}/abort`);
    expect(aborted.status).toBe(204);
    expect((await editor.panel.post(`${sessionPath(orderId, item.id, session.id)}/abort`)).status).toBe(204);
    expect((await editor.panel.get(`${sessionPath(orderId, item.id, session.id)}/parts`)).status).toBe(409);
    expect((await createSessionFor(editor, orderId, item.id)).status).toBe(201);
  });
});

describe('EVM-044 AC6 AC7 — only the creator continues a session; a medium of another order is not found (SR-AUTHZ-02, CWE-639)', () => {
  async function fixture() {
    const editor = await signIn('editor');
    const colleague = await signIn('editor');
    const orderId = await order();
    const item = itemFor(jpeg());
    await createMedia(editor, orderId, [item]);
    const sessionId = ((await createSessionFor(editor, orderId, item.id)).body as { id: string }).id;
    return { editor, colleague, orderId, item, sessionId };
  }

  it('EVM-044 AC6 another user gets 404 on the parts, the URL of a part, complete and abort — and the session is untouched', async () => {
    const { colleague, orderId, item, sessionId } = await fixture();
    const path = sessionPath(orderId, item.id, sessionId);
    for (const response of [
      await colleague.panel.get(`${path}/parts`),
      await colleague.panel.get(`${path}/parts/1/url`),
      await colleague.panel.post(`${path}/complete`),
      await colleague.panel.post(`${path}/abort`),
    ]) {
      expect(response.status).toBe(404);
      expect(codeOf(response.body)).toBe('not_found');
    }
    expect(
      (await sql<{ state: string }>`select state from media.upload_sessions where id = ${sessionId}`.execute(admin())).rows[0]?.state,
    ).toBe('active');
  });

  it('EVM-044 AC7 the session of a medium of order B reached through the path of order A is 404 on every operation; a deleted or unknown order is 404 too', async () => {
    const { editor, orderId, item, sessionId } = await fixture();
    const orderA = await order();
    const deleted = await order({ deleted: true });
    for (const wrong of [orderA, deleted, uuidv7()]) {
      const path = sessionPath(wrong, item.id, sessionId);
      for (const response of [
        await editor.panel.get(`${path}/parts`),
        await editor.panel.get(`${path}/parts/1/url`),
        await editor.panel.post(`${path}/complete`),
        await editor.panel.post(`${path}/abort`),
        await editor.panel.post(
          `${BASE}/${wrong}/media-assets/${item.id}/upload-sessions`,
          { id: uuidv7() },
          { 'Idempotency-Key': uuidv7() },
        ),
      ]) {
        expect(response.status).toBe(404);
      }
    }
    expect((await listFor(editor, deleted)).status).toBe(404);
    expect((await createMedia(editor, deleted, [itemFor(jpeg())])).status).toBe(404);
    // the right order, a session id that belongs to nobody
    expect((await editor.panel.get(`${sessionPath(orderId, item.id, uuidv7())}/parts`)).status).toBe(404);
  });

  it('EVM-044 AC7 Administrator and Editor upload; Tylko odczyt reads the list but gets 403 on every write and on the URL of a part; anonymous is 401; a mobile token is 403', async () => {
    const { orderId, item, sessionId } = await fixture();
    const path = sessionPath(orderId, item.id, sessionId);
    const reader = await signIn('read_only');
    const administrator = await signIn('administrator');
    const mobile = await signIn('editor', 'mobile');
    expect((await listFor(reader, orderId)).status).toBe(200);
    expect((await listFor(administrator, orderId)).status).toBe(200);
    expect((await createMedia(administrator, orderId, [itemFor(jpeg())])).status).toBe(201);
    for (const response of [
      await createMedia(reader, orderId, [itemFor(jpeg())]),
      await createSessionFor(reader, orderId, item.id),
      await reader.panel.get(`${path}/parts`),
      await reader.panel.get(`${path}/parts/1/url`),
      await reader.panel.post(`${path}/complete`),
      await reader.panel.post(`${path}/abort`),
    ]) {
      expect(response.status).toBe(403);
      expect(codeOf(response.body)).toBe('forbidden');
    }
    expect((await createMedia(reader, orderId, [{ junk: true }])).status).toBe(403);
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    expect((await anonymous.get(`${BASE}/${orderId}/media-assets`)).status).toBe(401);
    expect((await anonymous.post(`${BASE}/${orderId}/media-assets`, { items: [] })).status).toBe(401);
    expect((await anonymous.get(`${path}/parts/1/url`)).status).toBe(401);
    for (const response of [await listFor(mobile, orderId), await createMedia(mobile, orderId, [itemFor(jpeg())])]) {
      expect(response.status).toBe(403);
      expect(codeOf(response.body)).toBe('forbidden');
    }
  });
});

describe('EVM-044 — fail closed without a configured storage, and no signed URL in the log (P5, SR-LOG-02, SR-LOG-03)', () => {
  it('EVM-044 AC3 without the media configuration every operation is 503 media_storage_unavailable while the service stays healthy', async () => {
    const { OBJECT_STORAGE } = await import('../../src/platform/object-storage/object-storage.ts');
    const bare = await createIdentityApp({ configure: (builder) => builder.overrideProvider(OBJECT_STORAGE).useValue(null) });
    try {
      const user = await createUser(bare.database.admin, bare.clock, { role: 'editor' });
      const session = await createSession(bare.database.admin, bare.clock, user, {});
      const panel = new PanelClient(bare.app.getHttpServer(), PANEL_ORIGIN);
      panel.cookie = session.cookie;
      panel.csrfToken = session.csrfToken;
      const customerId = await insertCustomer(bare.database.admin, { email: 'bare@example.invalid' });
      const siteId = await insertSite(bare.database.admin);
      const orderId =
        [...(await insertWorkOrders(bare.database.admin, [{ number: 'ZL-6900-0001', customerId, siteId }])).values()][0] ?? '';
      const stored = await insertMedia(bare.database.admin, { workOrderId: orderId, createdBy: user.id, session: { userId: user.id } });
      const path = sessionPath(orderId, stored.mediaAssetId, stored.sessionId ?? '');
      const key = { 'Idempotency-Key': uuidv7() };
      const responses = [
        await panel.post(`${BASE}/${orderId}/media-assets`, { items: [itemFor(jpeg())] }, key),
        await panel.post(`${BASE}/${orderId}/media-assets/${stored.mediaAssetId}/upload-sessions`, { id: uuidv7() }, key),
        await panel.get(`${path}/parts`),
        await panel.get(`${path}/parts/1/url`),
        await panel.post(`${path}/complete`),
      ];
      for (const response of responses) {
        expect(response.status).toBe(503);
        expect(codeOf(response.body)).toBe('media_storage_unavailable');
        expect(JSON.stringify(response.body)).not.toMatch(/bucket|s3|amazonaws|scw/i);
      }
      expect((await panel.get(`${BASE}/${orderId}/media-assets`)).status).toBe(200);
      expect((await panel.get('/api/health')).status).toBe(200);
    } finally {
      await bare.close();
    }
  });

  it('EVM-044 AC6 an unavailable storage during a call is 503 without detail, and no signed URL, file name or checksum reaches the log', async () => {
    const editor = await signIn('editor');
    const orderId = await order();
    const item = itemFor(jpeg(), { fileName: 'tajne-nazwisko-klienta.jpg' });
    await createMedia(editor, orderId, [item]);
    const session = await createSessionFor(editor, orderId, item.id);
    const sid = (session.body as { id: string }).id;
    const url = await editor.panel.get(`${sessionPath(orderId, item.id, sid)}/parts/1/url`);
    expect((url.body as { url: string }).url).toContain('X-Amz-Signature');
    current.storage.unavailable = true;
    const down = await editor.panel.get(`${sessionPath(orderId, item.id, sid)}/parts/1/url`);
    expect(down.status).toBe(503);
    expect(codeOf(down.body)).toBe('media_storage_unavailable');
    const text = current.logs.text;
    expect(text).not.toContain('X-Amz-');
    expect(text).not.toContain('bucket.invalid');
    expect(text).not.toContain('tajne-nazwisko');
    expect(text).not.toContain(item.sha256);
  });
});

/**
 * The upload session of a medium from the PHONE (EVM-131 AC1, AC2; SR-FILE-01, SR-FILE-02, SR-AUTHZ-02, SR-AUTHZ-05, SR-AUTHZ-12, SR-SYNC-08, SR-API-05, SR-LOG-02, CWE-639, CWE-434, CWE-362)
 * against the real application and PostgreSQL. Synthetic data only: the files are a few bytes of filler behind a signature, the names are UUIDs.
 */
import { sql } from 'kysely';
import request, { type Test } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MediaScanService } from '../../src/modules/media/index.ts';
import { MAX_ACTIVE_SESSIONS_PER_USER, PART_URL_SECONDS } from '../../src/modules/media/domain/upload-plan.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createMobileSession, createSession, createUser, type Role, type UserFixture } from '../support/identity-fixtures.ts';
import { insertDocumentRow } from '../support/document-fixtures.ts';
import { insertMedia, sha256Of } from '../support/media-fixtures.ts';
import { setDeviceState } from '../support/mobile-flows.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

const NOW = '2026-11-14T08:00:00.000Z';
const BASE = '/api/v1/work-orders';
const APP = { 'X-Client-Platform': 'android', 'X-Client-Version': '1.2.0' };

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
const server = () => current.app.getHttpServer();

interface Web {
  readonly user: UserFixture;
  readonly panel: PanelClient;
}
async function web(role: Role = 'editor', user?: UserFixture): Promise<Web> {
  const owner = user ?? (await createUser(admin(), current.clock, { role }));
  const session = await createSession(admin(), current.clock, owner, { channel: 'web' });
  const panel = new PanelClient(server(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { user: owner, panel };
}

interface Phone {
  readonly user: UserFixture;
  readonly bearer: string;
  readonly deviceId: string;
  readonly sessionId: string;
}
async function phone(role: Role = 'editor', user?: UserFixture): Promise<Phone> {
  const owner = user ?? (await createUser(admin(), current.clock, { role }));
  return { user: owner, ...(await createMobileSession(admin(), current.clock, owner)) };
}

/** A call of the phone: Bearer, the headers of the app, no cookie, no Origin. */
function call(who: Phone | undefined, method: 'get' | 'post', path: string, body?: unknown, key?: string): Test {
  let test = request(server())[method](path).set(APP);
  if (who !== undefined) test = test.set('Authorization', `Bearer ${who.bearer}`);
  if (key !== undefined) test = test.set('Idempotency-Key', key);
  return body === undefined ? test : test.set('Content-Type', 'application/json').send(JSON.stringify(body));
}

let numbering = 0;
async function order(options: { deleted?: boolean } = {}): Promise<string> {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `jan${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [
    {
      number: `ZL-7${String(numbering).padStart(3, '0')}-0001`,
      customerId,
      siteId,
      ...(options.deleted === true ? { deletedAt: new Date('2026-11-02T08:00:00Z') } : {}),
    },
  ]);
  return [...ids.values()][0] ?? '';
}

const jpeg = (size = 2048, fill = 7): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), Buffer.alloc(size - 12, fill)]);

/** The declaration of the file the phone sends in the session: a UUID name (no personal data), the size and the checksum it computed. */
const declaration = (body: Buffer, over: Record<string, unknown> = {}) => ({
  fileName: `${uuidv7()}.jpg`,
  declaredSize: body.length,
  contentType: 'image/jpeg',
  sha256: sha256Of(body),
  ...over,
});

/** A medium as `CreateMediaAsset` leaves it: origin mobile, the creator is the user of the session, NO file yet. */
async function phoneMedium(orderId: string, userId: string, mediaType: 'photo' | 'video' = 'photo'): Promise<string> {
  const id = uuidv7();
  await sql`insert into media.media_assets (id, work_order_id, media_type, category, origin, created_at, created_by, updated_at)
    values (${id}, ${orderId}, ${mediaType}, 'before_work', 'mobile', now(), ${userId}, now())`.execute(admin());
  return id;
}

const sessionsPath = (orderId: string, mediaId: string) => `${BASE}/${orderId}/media-assets/${mediaId}/upload-sessions`;
const sessionPath = (orderId: string, mediaId: string, sessionId: string) => `${sessionsPath(orderId, mediaId)}/${sessionId}`;
const openSession = (who: Phone, orderId: string, mediaId: string, body: unknown, key = uuidv7(), sessionId = uuidv7()) =>
  call(who, 'post', sessionsPath(orderId, mediaId), { id: sessionId, ...(body as object) }, key);
const codeOf = (body: unknown): string | undefined => (body as { code?: string }).code;
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;

const fileOf = async (mediaId: string) =>
  (
    await sql<{
      id: string;
      state: string;
      object_key: string;
      declared_size_bytes: string;
      declared_sha256: string;
      original_filename: string | null;
    }>`
      select id, state, object_key, declared_size_bytes, declared_sha256, original_filename from media.stored_files where media_asset_id = ${mediaId}`.execute(
      admin(),
    )
  ).rows;
const uploadIdOf = async (sessionId: string): Promise<string> =>
  (await sql<{ s3_upload_id: string }>`select s3_upload_id from media.upload_sessions where id = ${sessionId}`.execute(admin())).rows[0]
    ?.s3_upload_id ?? '';
const sessionRow = async (sessionId: string) =>
  (
    await sql<{
      user_id: string;
      device_id: string | null;
      state: string;
    }>`select user_id, device_id, state from media.upload_sessions where id = ${sessionId}`.execute(admin())
  ).rows[0];

/** The whole flow on the phone for one file; returns what the tests look at. */
async function phoneUpload(who: Phone, orderId: string, mediaId: string, body: Buffer) {
  const created = await openSession(who, orderId, mediaId, { file: declaration(body) });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const sessionId = (created.body as { id: string }).id;
  const list = await call(who, 'get', `${sessionPath(orderId, mediaId, sessionId)}/parts`);
  const url = await call(who, 'get', `${sessionPath(orderId, mediaId, sessionId)}/parts/1/url`);
  current.storage.putPart(await uploadIdOf(sessionId), 1, body);
  const complete = await call(who, 'post', `${sessionPath(orderId, mediaId, sessionId)}/complete`);
  return { created, sessionId, list, url, complete };
}

describe('EVM-131 AC1 - the five operations of the upload session on the phone, the same answers as the panel (SR-FILE-02, SR-API-05)', () => {
  it.each(['administrator', 'editor'] as const)(
    'EVM-131 AC1 %s on the phone: a medium without a file, the declaration in the session, the parts, the address of a part (60 minutes at most, no-store), complete, the scan - clean',
    async (role) => {
      const orderId = await order();
      const who = await phone(role);
      const mediaId = await phoneMedium(orderId, who.user.id);
      const body = jpeg(3000);
      const { created, sessionId, list, url, complete } = await phoneUpload(who, orderId, mediaId, body);

      expect(created.headers['cache-control']).toBe('no-store');
      expect(created.body).toMatchObject({ id: sessionId, mediaAssetId: mediaId, state: 'active', partCount: 1 });
      expect(Object.keys(created.body as object).sort()).toEqual(['expiresAt', 'id', 'mediaAssetId', 'partCount', 'partSize', 'state']);
      expect(list.status).toBe(200);
      expect(list.body).toEqual({ items: [] });
      expect(url.status).toBe(200);
      expect(url.headers['cache-control']).toBe('no-store');
      expect(url.body).toMatchObject({ contentLength: body.length });
      // the validity of the address is the server's value (SR-FILE-02): at most 60 minutes, the same on the phone as in the panel (the story does not shorten it)
      const lifetime = Date.parse((url.body as { expiresAt: string }).expiresAt) - current.clock.now().getTime();
      expect(PART_URL_SECONDS).toBeLessThanOrEqual(3600);
      expect(lifetime).toBe(PART_URL_SECONDS * 1000);
      expect(complete.status, JSON.stringify(complete.body)).toBe(200);
      expect(complete.body).toMatchObject({ id: mediaId, fileState: 'uploaded' });
      expect(JSON.stringify(complete.body)).not.toMatch(/object_?key|media\/20|upload_?id|sha256/i);

      const [file] = await fileOf(mediaId);
      expect(file).toMatchObject({ state: 'uploaded', declared_size_bytes: String(body.length), declared_sha256: sha256Of(body) });
      expect(await current.app.get(MediaScanService, { strict: false }).runOnce()).toBe(1);
      expect((await fileOf(mediaId))[0]?.state).toBe('clean');
    },
  );

  it('EVM-131 AC1 the answers of the phone have the very shape of the answers of the panel for the same operations (one medium of the panel, one of the phone)', async () => {
    const orderId = await order();
    const editor = await web('editor');
    const who = await phone('editor', editor.user);
    // the panel: a batch, a session, the parts
    const body = jpeg(2500);
    const item = {
      id: uuidv7(),
      category: 'in_progress',
      fileName: 'IMG_1.JPG',
      declaredSize: body.length,
      contentType: 'image/jpeg',
      sha256: sha256Of(body),
    };
    expect((await editor.panel.post(`${BASE}/${orderId}/media-assets`, { items: [item] }, { 'Idempotency-Key': uuidv7() })).status).toBe(
      201,
    );
    const panelSession = await editor.panel.post(sessionsPath(orderId, item.id), { id: uuidv7() }, { 'Idempotency-Key': uuidv7() });
    const panelList = await editor.panel.get(`${sessionPath(orderId, item.id, (panelSession.body as { id: string }).id)}/parts`);
    const panelUrl = await editor.panel.get(`${sessionPath(orderId, item.id, (panelSession.body as { id: string }).id)}/parts/1/url`);
    const mediaId = await phoneMedium(orderId, who.user.id);
    const phoneFlow = await phoneUpload(who, orderId, mediaId, body);
    const shape = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(shape)
        : value !== null && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shape(inner)]))
          : typeof value;
    expect(phoneFlow.created.status).toBe(panelSession.status);
    expect(shape(phoneFlow.created.body)).toEqual(shape(panelSession.body));
    expect(shape(phoneFlow.list.body)).toEqual(shape(panelList.body));
    expect(shape(phoneFlow.url.body)).toEqual(shape(panelUrl.body));
    // the validity of the address is the same on both channels
    const lifetimeOf = (response: { body: unknown }) =>
      Date.parse((response.body as { expiresAt: string }).expiresAt) - current.clock.now().getTime();
    expect(lifetimeOf(phoneFlow.url)).toBe(lifetimeOf(panelUrl));
    expect(phoneFlow.url.headers['cache-control']).toBe(panelUrl.headers['cache-control']);
  });

  it('EVM-131 AC1 an upload that is aborted on the phone is a 204 (and again 204), and the file stays pending for a new session; the repeat of the creation after a lost answer is the same session', async () => {
    const orderId = await order();
    const who = await phone('editor');
    const mediaId = await phoneMedium(orderId, who.user.id);
    const file = declaration(jpeg());
    const key = uuidv7();
    const sessionId = uuidv7();
    const first = await call(who, 'post', sessionsPath(orderId, mediaId), { id: sessionId, file }, key);
    expect(first.status).toBe(201);
    const repeat = await call(who, 'post', sessionsPath(orderId, mediaId), { id: sessionId, file }, key);
    expect(repeat.status).toBe(201);
    expect(repeat.headers['idempotent-replayed']).toBe('true');
    expect(repeat.body).toEqual(first.body);
    expect(await fileOf(mediaId)).toHaveLength(1);
    // another declaration for a medium that has its file is refused; the same key WITHOUT the declaration is another request (the declaration is part of it)
    const other = await call(
      who,
      'post',
      sessionsPath(orderId, mediaId),
      { id: sessionId, file: { ...file, declaredSize: file.declaredSize + 1 } },
      key,
    );
    expect(other.status).toBe(400);
    expect(errorsOf(other.body)).toEqual([{ pointer: '/file', code: 'not_allowed' }]);
    const without = await call(who, 'post', sessionsPath(orderId, mediaId), { id: sessionId }, key);
    expect(without.status).toBe(422);
    expect(codeOf(without.body)).toBe('idempotency_mismatch');

    const abort = await call(who, 'post', `${sessionPath(orderId, mediaId, sessionId)}/abort`);
    expect(abort.status).toBe(204);
    expect((await call(who, 'post', `${sessionPath(orderId, mediaId, sessionId)}/abort`)).status).toBe(204);
    expect((await fileOf(mediaId))[0]?.state).toBe('pending_upload');
  });
});

describe('EVM-131 AC1 - only the creator of the session continues it: the user AND the device (SR-SYNC-08, SR-API-05, CWE-639)', () => {
  async function started() {
    const orderId = await order();
    const owner = await phone('editor');
    const mediaId = await phoneMedium(orderId, owner.user.id);
    const { sessionId } = await phoneUpload(owner, orderId, mediaId, jpeg());
    // the upload was completed: open another medium and keep its session ACTIVE for the attempts
    const second = await phoneMedium(orderId, owner.user.id);
    const created = await openSession(owner, orderId, second, { file: declaration(jpeg(2100)) });
    return { orderId, owner, mediaId: second, sessionId: (created.body as { id: string }).id, doneMedia: mediaId, doneSession: sessionId };
  }
  const operations = (orderId: string, mediaId: string, sessionId: string) =>
    [
      ['listUploadParts', 'get', `${sessionPath(orderId, mediaId, sessionId)}/parts`],
      ['getUploadPartUrl', 'get', `${sessionPath(orderId, mediaId, sessionId)}/parts/1/url`],
      ['completeUploadSession', 'post', `${sessionPath(orderId, mediaId, sessionId)}/complete`],
      ['abortUploadSession', 'post', `${sessionPath(orderId, mediaId, sessionId)}/abort`],
    ] as const;

  it('EVM-131 AC1 the session records the user and the device of the session of the phone - never a value of the request', async () => {
    const { owner, sessionId } = await started();
    expect(await sessionRow(sessionId)).toEqual({ user_id: owner.user.id, device_id: owner.deviceId, state: 'active' });
    const orderId = await order();
    const mediaId = await phoneMedium(orderId, owner.user.id);
    // a device named in a header is ignored: the session is bound to the device of the TOKEN
    const viaHeader = await call(owner, 'post', sessionsPath(orderId, mediaId), { id: uuidv7(), file: declaration(jpeg()) }, uuidv7()).set(
      'X-Device-Id',
      uuidv7(),
    );
    expect(viaHeader.status).toBe(201);
    expect((await sessionRow((viaHeader.body as { id: string }).id))?.device_id).toBe(owner.deviceId);
    // a device named in the body is a field the schema does not know
    const otherMedium = await phoneMedium(orderId, owner.user.id);
    const viaBody = await openSession(owner, orderId, otherMedium, { file: declaration(jpeg()), deviceId: uuidv7() });
    expect(viaBody.status).toBe(400);
    expect(codeOf(viaBody.body)).toBe('validation_failed');
    expect(errorsOf(viaBody.body)).toEqual([{ pointer: '/deviceId', code: 'unknown_field' }]);
    expect(await fileOf(otherMedium)).toEqual([]);
  });

  it('EVM-131 AC1 another DEVICE of the same user, another user and the panel of the same user get the same 404 on the four operations on the session', async () => {
    const { orderId, owner, mediaId, sessionId } = await started();
    const otherDevice = await phone('editor', owner.user);
    const otherUser = await phone('editor');
    const panel = await web('editor', owner.user);
    for (const [name, method, path] of operations(orderId, mediaId, sessionId)) {
      for (const stranger of [otherDevice, otherUser]) {
        const response = await call(stranger, method, path);
        expect(response.status, `${name} ${stranger === otherDevice ? 'device' : 'user'}`).toBe(404);
        expect(codeOf(response.body), name).toBe('not_found');
      }
      const viaPanel = method === 'get' ? await panel.panel.get(path) : await panel.panel.post(path);
      expect(viaPanel.status, `${name} panel`).toBe(404);
    }
    // nothing of it moved: the session is still active and nobody completed the file
    expect((await sessionRow(sessionId))?.state).toBe('active');
    expect((await fileOf(mediaId))[0]?.state).toBe('pending_upload');
    // the creator still can
    expect((await call(owner, 'get', `${sessionPath(orderId, mediaId, sessionId)}/parts`)).status).toBe(200);
  });

  it('EVM-131 AC1 the session of the PANEL is not continued by the phone of the same user either', async () => {
    const orderId = await order();
    const editor = await web('editor');
    const who = await phone('editor', editor.user);
    const body = jpeg();
    const item = {
      id: uuidv7(),
      category: 'other',
      fileName: 'IMG_2.JPG',
      declaredSize: body.length,
      contentType: 'image/jpeg',
      sha256: sha256Of(body),
    };
    await editor.panel.post(`${BASE}/${orderId}/media-assets`, { items: [item] }, { 'Idempotency-Key': uuidv7() });
    const session = await editor.panel.post(sessionsPath(orderId, item.id), { id: uuidv7() }, { 'Idempotency-Key': uuidv7() });
    const sessionId = (session.body as { id: string }).id;
    for (const [name, method, path] of operations(orderId, item.id, sessionId)) {
      expect((await call(who, method, path)).status, name).toBe(404);
    }
    expect((await editor.panel.get(`${sessionPath(orderId, item.id, sessionId)}/parts`)).status).toBe(200);
  });

  it('EVM-131 AC1 the same Idempotency-Key on the panel and on the phone of one user is no replay (the key is bound to the device): the phone does not get the answer of the panel', async () => {
    const orderId = await order();
    const editor = await web('editor');
    const who = await phone('editor', editor.user);
    const body = jpeg();
    const item = {
      id: uuidv7(),
      category: 'other',
      fileName: 'IMG_3.JPG',
      declaredSize: body.length,
      contentType: 'image/jpeg',
      sha256: sha256Of(body),
    };
    await editor.panel.post(`${BASE}/${orderId}/media-assets`, { items: [item] }, { 'Idempotency-Key': uuidv7() });
    const key = uuidv7();
    const sessionId = uuidv7();
    const panel = await editor.panel.post(sessionsPath(orderId, item.id), { id: sessionId }, { 'Idempotency-Key': key });
    expect(panel.status).toBe(201);
    const fromPhone = await call(who, 'post', sessionsPath(orderId, item.id), { id: sessionId }, key);
    expect(fromPhone.headers['idempotent-replayed']).toBeUndefined();
    // it is a new request: the active session of ANOTHER creator (the panel, no device) is a conflict without a detail - never the session of the panel
    expect(fromPhone.status).toBe(409);
    expect(codeOf(fromPhone.body)).toBe('id_conflict');
    expect(JSON.stringify(fromPhone.body)).not.toContain(sessionId);
  });

  it('EVM-131 AC1 another device of the same user cannot open a session on the medium while the first device holds an active one (409 id_conflict, no detail)', async () => {
    const { orderId, owner, mediaId } = await started();
    const otherDevice = await phone('editor', owner.user);
    const response = await call(otherDevice, 'post', sessionsPath(orderId, mediaId), { id: uuidv7() }, uuidv7());
    expect(response.status).toBe(409);
    expect(codeOf(response.body)).toBe('id_conflict');
  });
});

describe('EVM-131 AC2 - the matrix of roles and channels of the five operations (SR-AUTHZ-01, SR-AUTHZ-05, SR-AUTHZ-12; deny by default)', () => {
  const GHOST = '0193a000-0000-7000-8000-00000000dead';
  const OPERATIONS = [
    { name: 'createUploadSession', path: (o: string, m: string) => sessionsPath(o, m), method: 'post' as const },
    { name: 'listUploadParts', path: (o: string, m: string, s: string) => `${sessionPath(o, m, s)}/parts`, method: 'get' as const },
    { name: 'getUploadPartUrl', path: (o: string, m: string, s: string) => `${sessionPath(o, m, s)}/parts/1/url`, method: 'get' as const },
    {
      name: 'completeUploadSession',
      path: (o: string, m: string, s: string) => `${sessionPath(o, m, s)}/complete`,
      method: 'post' as const,
    },
    { name: 'abortUploadSession', path: (o: string, m: string, s: string) => `${sessionPath(o, m, s)}/abort`, method: 'post' as const },
  ];
  /** What each operation answers to an entitled caller on the object of his own, in the order of the flow (a complete without parts is `422 upload_incomplete`). */
  const OWN = {
    createUploadSession: 201,
    listUploadParts: 200,
    getUploadPartUrl: 200,
    completeUploadSession: 422,
    abortUploadSession: 204,
  } as const;

  const send = (
    channel: 'phone' | 'web',
    actor: Phone | Web,
    op: (typeof OPERATIONS)[number],
    orderId: string,
    mediaId: string,
    sessionId: string,
    file?: object,
  ) => {
    const path = op.path(orderId, mediaId, sessionId);
    const body = op.name === 'createUploadSession' ? { id: sessionId, ...(file === undefined ? {} : { file }) } : undefined;
    if (channel === 'phone') return call(actor as Phone, op.method, path, body, op.method === 'post' ? uuidv7() : undefined);
    const panel = (actor as Web).panel;
    return op.method === 'get' ? panel.get(path) : panel.post(path, body, { 'Idempotency-Key': uuidv7() });
  };

  it.each([
    ['administrator', 'phone'],
    ['editor', 'phone'],
    ['administrator', 'web'],
    ['editor', 'web'],
  ] as const)(
    'EVM-131 AC2 %s on the %s channel: every operation answers as it does for the panel on the object of his own',
    async (role, channel) => {
      const orderId = await order();
      const actor = channel === 'phone' ? await phone(role) : await web(role);
      const mediaId = await phoneMedium(orderId, actor.user.id);
      const sessionId = uuidv7();
      for (const op of OPERATIONS) {
        const response = await send(channel, actor, op, orderId, mediaId, sessionId, declaration(jpeg()));
        expect(response.status, `${op.name} ${role} ${channel} ${JSON.stringify(response.body)}`).toBe(OWN[op.name as keyof typeof OWN]);
      }
    },
  );

  it('EVM-131 AC2 Tylko odczyt: 403 forbidden on the web and 403 channel_not_allowed on the phone - BEFORE the object is looked at (a missing medium answers the same)', async () => {
    const orderId = await order();
    const reader = await createUser(admin(), current.clock, { role: 'read_only' });
    const readerPhone = await phone('read_only', reader);
    const readerWeb = await web('read_only', reader);
    for (const op of OPERATIONS) {
      for (const [mediaId, sessionId] of [
        [GHOST, GHOST],
        [await phoneMedium(orderId, reader.id), uuidv7()],
      ] as const) {
        const onPhone = await send('phone', readerPhone, op, orderId, mediaId, sessionId, declaration(jpeg()));
        expect(onPhone.status, `${op.name} phone`).toBe(403);
        expect(codeOf(onPhone.body), `${op.name} phone`).toBe('channel_not_allowed');
        const onWeb = await send('web', readerWeb, op, orderId, mediaId, sessionId, declaration(jpeg()));
        expect(onWeb.status, `${op.name} web`).toBe(403);
        expect(codeOf(onWeb.body), `${op.name} web`).toBe('forbidden');
      }
    }
    // nothing was created for him
    const files = await sql<{ n: string }>`select count(*)::text as n from media.stored_files where created_by = ${reader.id}`.execute(
      admin(),
    );
    expect(files.rows[0]?.n).toBe('0');
  });

  it('EVM-131 AC2 no credentials is 401 unauthenticated (before the headers and the body), an unknown token is 401, a revoked session is 401 session_revoked, a phone ordered to wipe is 401 device_wipe_required', async () => {
    const orderId = await order();
    const mediaId = await phoneMedium(orderId, (await createUser(admin(), current.clock, { role: 'editor' })).id);
    const revoked = await phone('editor');
    await sql`update identity.sessions set revoked_at = ${current.clock.now()}, revoke_reason = 'logout' where id = ${revoked.sessionId}`.execute(
      admin(),
    );
    const wiped = await phone('editor');
    await setDeviceState(current, wiped.deviceId, 'wipe_required');
    for (const op of OPERATIONS) {
      const path = op.path(orderId, mediaId, GHOST);
      current.clock.advance(61_000);
      const anonymous = await call(undefined, op.method, path);
      expect([anonymous.status, codeOf(anonymous.body)], `${op.name} anonymous`).toEqual([401, 'unauthenticated']);
      const unknown = await call({ bearer: `evia_at_${'A'.repeat(43)}` } as Phone, op.method, path);
      expect(unknown.status, `${op.name} unknown`).toBe(401);
      const gone = await send('phone', revoked, op, orderId, mediaId, GHOST);
      expect([gone.status, codeOf(gone.body)], `${op.name} revoked`).toEqual([401, 'session_revoked']);
      const wipe = await send('phone', wiped, op, orderId, mediaId, GHOST);
      expect([wipe.status, codeOf(wipe.body)], `${op.name} wipe`).toEqual([401, 'device_wipe_required']);
    }
  });

  it('EVM-131 AC2 a session of the phone in a cookie is not a credential of the panel; the cookie of the panel wins over a token in the same request (the credentials of one channel never mix)', async () => {
    const orderId = await order();
    const user = await createUser(admin(), current.clock, { role: 'editor' });
    const mediaId = await phoneMedium(orderId, user.id);
    const phoneCookie = await createSession(admin(), current.clock, user, { channel: 'mobile' });
    const forPhone = await phone('editor', user);
    for (const op of OPERATIONS) {
      current.clock.advance(61_000);
      const path = op.path(orderId, mediaId, GHOST);
      const asCookie = await request(server())[op.method](path).set('Cookie', phoneCookie.cookie).set(APP);
      expect([401, 403], `${op.name} cookie of a phone session`).toContain(asCookie.status);
      expect(codeOf(asCookie.body)).not.toBe('channel_not_allowed');
    }
    // both credentials in one request: the cookie of the panel counts first - the request acts as the user of the COOKIE, never as the one of the token
    const owner = await phone('editor');
    const ownerMedium = await phoneMedium(orderId, owner.user.id);
    const started = await openSession(owner, orderId, ownerMedium, { file: declaration(jpeg()) });
    const ownerSession = (started.body as { id: string }).id;
    const partsPath = `${sessionPath(orderId, ownerMedium, ownerSession)}/parts`;
    expect((await call(owner, 'get', partsPath)).status).toBe(200);
    const panel = await web('editor');
    const both = await request(server())
      .get(partsPath)
      .set(APP)
      .set('Cookie', panel.panel.cookieHeader() ?? '')
      .set('Authorization', `Bearer ${owner.bearer}`);
    expect([both.status, codeOf(both.body)]).toEqual([404, 'not_found']);
    // and the token alone is the user of the token
    expect(forPhone.user.id).toBe(user.id);
  });

  it('EVM-131 AC2 the web keeps its rules: a mutation without X-CSRF-Token is 403 csrf_failed; the version of the app is checked for a Bearer token only (426), never for the cookie', async () => {
    const orderId = await order();
    const editor = await web('editor');
    const mediaId = await phoneMedium(orderId, editor.user.id);
    const sessionId = uuidv7();
    for (const op of OPERATIONS.filter((candidate) => candidate.method === 'post')) {
      const withoutToken = new PanelClient(server(), PANEL_ORIGIN);
      withoutToken.cookie = editor.panel.cookie;
      const response = await withoutToken.post(
        op.path(orderId, mediaId, sessionId),
        op.name === 'createUploadSession' ? { id: sessionId } : undefined,
        {
          'Idempotency-Key': uuidv7(),
        },
      );
      expect([response.status, codeOf(response.body)], op.name).toEqual([403, 'csrf_failed']);
    }
    const old = await phone('editor');
    for (const op of OPERATIONS) {
      const path = op.path(orderId, mediaId, sessionId);
      const stale = await call(old, op.method, path, undefined, uuidv7()).set('X-Client-Version', '1.0.0');
      expect(stale.status, `${op.name} old app`).toBe(426);
    }
    const panelOnly = await editor.panel.get(`${sessionPath(orderId, mediaId, sessionId)}/parts`);
    expect(panelOnly.status).toBe(404);
  });

  it('EVM-131 AC2 the phone must send the Idempotency-Key on the creation of a session (400 validation_failed, nothing written)', async () => {
    const orderId = await order();
    const who = await phone('editor');
    const mediaId = await phoneMedium(orderId, who.user.id);
    const response = await call(who, 'post', sessionsPath(orderId, mediaId), { id: uuidv7(), file: declaration(jpeg()) });
    expect(response.status).toBe(400);
    expect(errorsOf(response.body)).toEqual([{ pointer: '/headers/Idempotency-Key', code: 'required' }]);
    expect(await fileOf(mediaId)).toEqual([]);
  });

  it('EVM-131 AC2 the object: a medium of another order, of another creator (an Editor), of a deleted order and a missing one are the same 404 on the five operations', async () => {
    const orderA = await order();
    const orderB = await order();
    const alice = await phone('editor');
    const bob = await phone('editor');
    const mediaOfAlice = await phoneMedium(orderA, alice.user.id);
    const mediaOfB = await phoneMedium(orderB, alice.user.id);
    const deletedOrder = await order({ deleted: true });
    const deletedMedium = await phoneMedium(deletedOrder, alice.user.id);
    for (const op of OPERATIONS) {
      const file = declaration(jpeg());
      const cases: Array<[string, Phone, string, string]> = [
        ['another creator', bob, orderA, mediaOfAlice],
        ['another order in the path', alice, orderA, mediaOfB],
        ['a deleted order', alice, deletedOrder, deletedMedium],
        ['a missing medium', alice, orderA, GHOST],
        ['a missing order', alice, GHOST, mediaOfAlice],
      ];
      for (const [label, actor, orderId, mediaId] of cases) {
        const response = await send('phone', actor, op, orderId, mediaId, uuidv7(), file);
        expect([response.status, codeOf(response.body)], `${op.name} ${label}`).toEqual([404, 'not_found']);
      }
    }
    expect(await fileOf(mediaOfAlice)).toEqual([]);
    expect(await fileOf(mediaOfB)).toEqual([]);
    // an Administrator is not the creator of a medium of the phone: no takeover of somebody else's medium (404, nothing written)
    const boss = await phone('administrator');
    const takeover = await openSession(boss, orderA, mediaOfAlice, { file: declaration(jpeg()) });
    expect([takeover.status, codeOf(takeover.body)]).toEqual([404, 'not_found']);
    expect(await fileOf(mediaOfAlice)).toEqual([]);
  });
});

describe('EVM-131 AC1 - the declaration of the file in the session of a medium that has none (SR-FILE-01, SR-FILE-03, CWE-434)', () => {
  it('EVM-131 AC1 a medium without a file needs `file`: 400 validation_failed at /file, nothing is written', async () => {
    const orderId = await order();
    const who = await phone('editor');
    const mediaId = await phoneMedium(orderId, who.user.id);
    const response = await openSession(who, orderId, mediaId, {});
    expect([response.status, codeOf(response.body)]).toEqual([400, 'validation_failed']);
    expect(errorsOf(response.body)).toEqual([{ pointer: '/file', code: 'required' }]);
    expect(await fileOf(mediaId)).toEqual([]);
  });

  it('EVM-131 AC1 the declaration is judged like the batch of the panel: type, extension, size per kind, the kind of the medium, the checksum - 400 with pointers, never a value, nothing written', async () => {
    const orderId = await order();
    const who = await phone('editor');
    const photo = await phoneMedium(orderId, who.user.id, 'photo');
    const video = await phoneMedium(orderId, who.user.id, 'video');
    const body = jpeg();
    type Case = [string, string, Record<string, unknown>, Array<{ pointer: string; code: string }> | undefined];
    const bad: Case[] = [
      ['an SVG', photo, { contentType: 'image/svg+xml', fileName: 'x.svg' }, [{ pointer: '/file/contentType', code: 'unsupported_type' }]],
      [
        'an extension that does not match the type',
        photo,
        { fileName: 'x.png' },
        [{ pointer: '/file/fileName', code: 'unsupported_type' }],
      ],
      ['a photo above 50 MB', photo, { declaredSize: 52_428_801 }, [{ pointer: '/file/declaredSize', code: 'file_too_large' }]],
      ['a video above 4 GiB', video, { contentType: 'video/mp4', fileName: 'x.mp4', declaredSize: 4_294_967_297 }, undefined],
      [
        'a video as a photo',
        photo,
        { contentType: 'video/mp4', fileName: 'x.mp4' },
        [{ pointer: '/file/contentType', code: 'unsupported_type' }],
      ],
      ['a photo as a video', video, {}, [{ pointer: '/file/contentType', code: 'unsupported_type' }]],
      ['a checksum of the wrong shape', photo, { sha256: 'A'.repeat(64) }, undefined],
      ['a checksum that is too short', photo, { sha256: 'a'.repeat(63) }, undefined],
      ['an empty file', photo, { declaredSize: 0 }, undefined],
      ['an unknown field of the file', photo, { objectKey: 'media/2026/11/x/original' }, undefined],
    ];
    for (const [label, mediaId, over, errors] of bad) {
      const response = await openSession(who, orderId, mediaId, { file: declaration(body, over) });
      expect(response.status, label).toBe(400);
      expect(['validation_failed', 'unknown_field'], label).toContain(codeOf(response.body));
      if (errors !== undefined) expect(errorsOf(response.body), label).toEqual(errors);
      expect(await fileOf(mediaId), label).toEqual([]);
    }
  });

  it("EVM-131 AC1 the key of the object is the server's and the name is cleaned: no path, no control characters, never in the key, the logs or the answer", async () => {
    const orderId = await order();
    const who = await phone('editor');
    const mediaId = await phoneMedium(orderId, who.user.id);
    const secretName = 'Jan-Kowalski-dom.jpg';
    const response = await openSession(who, orderId, mediaId, { file: declaration(jpeg(), { fileName: `../../etc/${secretName}` }) });
    expect(response.status).toBe(201);
    const [file] = await fileOf(mediaId);
    expect(file?.original_filename).toBe(secretName);
    expect(file?.object_key).toMatch(/^media\/\d{4}\/\d{2}\/[0-9a-f-]{36}\/original$/);
    expect(file?.object_key).not.toContain('Kowalski');
    expect(JSON.stringify(response.body)).not.toContain('Kowalski');
    expect(current.logs.text).not.toContain('Kowalski');
  });

  it("EVM-131 AC1 a medium that has its file takes a declaration only when it is the very one it has (a repeat after a lost answer); another one never replaces it - also not for the panel's own media", async () => {
    const orderId = await order();
    const who = await phone('editor');
    const mediaId = await phoneMedium(orderId, who.user.id);
    const body = jpeg();
    const file = declaration(body);
    const first = await openSession(who, orderId, mediaId, { file });
    expect(first.status).toBe(201);
    // a repeat with the very same declaration (a new key and session id, as after a lost answer): the active session of the creator is resumed
    const again = await openSession(who, orderId, mediaId, { file });
    expect([again.status, (again.body as { id: string }).id]).toEqual([200, (first.body as { id: string }).id]);
    for (const over of [
      { declaredSize: body.length + 1 },
      { sha256: 'b'.repeat(64) },
      { fileName: `${uuidv7()}.png`, contentType: 'image/png' },
    ]) {
      const other = await openSession(who, orderId, mediaId, { file: { ...file, ...over } });
      expect([other.status, codeOf(other.body)], JSON.stringify(over)).toEqual([400, 'validation_failed']);
    }
    expect(await fileOf(mediaId)).toHaveLength(1);
    expect((await fileOf(mediaId))[0]).toMatchObject({ declared_sha256: sha256Of(body), original_filename: file.fileName });

    // a medium of the PANEL: its declaration is never overwritten by the phone of the creator
    const editor = await web('editor');
    const panelPhone = await phone('editor', editor.user);
    const item = {
      id: uuidv7(),
      category: 'other',
      fileName: 'IMG_9.JPG',
      declaredSize: body.length,
      contentType: 'image/jpeg',
      sha256: sha256Of(body),
    };
    await editor.panel.post(`${BASE}/${orderId}/media-assets`, { items: [item] }, { 'Idempotency-Key': uuidv7() });
    const overwrite = await openSession(panelPhone, orderId, item.id, { file: declaration(jpeg(4000), { fileName: 'IMG_9.JPG' }) });
    expect([overwrite.status, codeOf(overwrite.body)]).toEqual([400, 'validation_failed']);
    expect(errorsOf(overwrite.body)).toEqual([{ pointer: '/file', code: 'not_allowed' }]);
    expect((await fileOf(item.id))[0]).toMatchObject({ declared_sha256: sha256Of(body), declared_size_bytes: String(body.length) });
  });

  it('EVM-131 AC1 a document takes no declaration of a file: `file` is an unknown field (400)', async () => {
    const orderId = await order();
    const editor = await web('editor');
    const who = await phone('editor', editor.user);
    const document = await insertDocumentRow(admin(), { workOrderId: orderId, createdBy: editor.user.id });
    const path = `${BASE}/${orderId}/documents/${document.documentId}/upload-sessions`;
    const response = await call(who, 'post', path, { id: uuidv7(), file: declaration(jpeg()) }, uuidv7());
    // a document is not part of the phone's operations: the media path never serves it, and the panel's schema refuses the field
    expect([401, 403, 400, 404]).toContain(response.status);
    const viaPanel = await editor.panel.post(path, { id: uuidv7(), file: declaration(jpeg()) }, { 'Idempotency-Key': uuidv7() });
    expect([viaPanel.status, codeOf(viaPanel.body)]).toEqual([400, 'validation_failed']);
    expect(errorsOf(viaPanel.body)).toEqual([{ pointer: '/file', code: 'unknown_field' }]);
  });

  it('EVM-131 AC1 two parallel declarations of one medium give ONE file and never a 500; a parallel declaration that differs is refused', async () => {
    const orderId = await order();
    const who = await phone('editor');
    const mediaId = await phoneMedium(orderId, who.user.id);
    const file = declaration(jpeg());
    const same = await Promise.all([openSession(who, orderId, mediaId, { file }), openSession(who, orderId, mediaId, { file })]);
    for (const response of same) expect([200, 201], JSON.stringify(response.body)).toContain(response.status);
    expect(await fileOf(mediaId)).toHaveLength(1);

    const second = await phoneMedium(orderId, who.user.id);
    const differing = await Promise.all([
      openSession(who, orderId, second, { file: declaration(jpeg(2048, 1)) }),
      openSession(who, orderId, second, { file: declaration(jpeg(2048, 2)) }),
    ]);
    const statuses = differing.map((response) => response.status).sort();
    expect(Math.max(...statuses), JSON.stringify(differing.map((response) => response.body as unknown))).toBeLessThan(500);
    expect(statuses).toContain(201);
    expect(await fileOf(second)).toHaveLength(1);
  });

  it('EVM-131 AC1 after the sweeper gave the file up (failed, abandoned) the phone opens a new session on the same medium, as the panel does; the file returns to pending', async () => {
    const orderId = await order();
    const who = await phone('editor');
    const mediaId = await phoneMedium(orderId, who.user.id);
    const file = declaration(jpeg());
    const first = await openSession(who, orderId, mediaId, { file });
    expect(first.status).toBe(201);
    await sql`update media.upload_sessions set state = 'expired' where id = ${(first.body as { id: string }).id}`.execute(admin());
    await sql`update media.stored_files set state = 'failed', state_reason_code = 'abandoned', state_changed_at = now() where media_asset_id = ${mediaId}`.execute(
      admin(),
    );
    const revisionOf = async (): Promise<number> =>
      (await sql<{ r: number }>`select file_state_revision as r from media.media_assets where id = ${mediaId}`.execute(admin())).rows[0]
        ?.r ?? 0;
    const before = await revisionOf();
    const again = await openSession(who, orderId, mediaId, { file });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect((await fileOf(mediaId))[0]?.state).toBe('pending_upload');
    // the change of the state counted for the phone: failed, then pending again
    expect(await revisionOf()).toBeGreaterThan(before);
  });

  it('EVM-131 AC1 the limit of 100 active sessions of a user is the same on the phone and on the panel (429 with Retry-After); the limit of unfinished media of the panel applies to the declaration of the phone too', async () => {
    const orderId = await order();
    const editor = await web('editor');
    const who = await phone('editor', editor.user);
    for (let index = 0; index < MAX_ACTIVE_SESSIONS_PER_USER; index += 1) {
      await insertMedia(admin(), {
        workOrderId: orderId,
        createdBy: editor.user.id,
        session: { userId: editor.user.id, expiresAt: new Date('2026-12-01T00:00:00Z') },
      });
    }
    const mediaId = await phoneMedium(orderId, editor.user.id);
    const onPhone = await openSession(who, orderId, mediaId, { file: declaration(jpeg()) });
    expect(onPhone.status).toBe(429);
    expect(onPhone.headers['retry-after']).toBeDefined();
    const onWeb = await editor.panel.post(
      sessionsPath(orderId, mediaId),
      { id: uuidv7(), file: declaration(jpeg()) },
      { 'Idempotency-Key': uuidv7() },
    );
    expect(onWeb.status).toBe(429);

    // 200 unfinished files of one user: the 201st is refused (the same limit as the batch of the panel)
    const other = await phone('editor');
    await sql`
      with a as (
        insert into media.media_assets (id, work_order_id, media_type, category, origin, created_at, created_by, updated_at)
        select uuidv7(), ${orderId}, 'photo', 'other', 'web', now(), ${other.user.id}, now() from generate_series(1, 200) returning id
      ), f as (
        select id as medium, uuidv7() as id from a
      )
      insert into media.stored_files (id, purpose, media_asset_id, object_key, state, state_changed_at, declared_size_bytes, declared_content_type, declared_sha256, original_filename, created_at, created_by)
      select f.id, 'media_original', f.medium, 'media/2026/11/' || f.id || '/original', 'pending_upload', now(), 1000, 'image/jpeg', repeat('a', 64), 'x.jpg', now(), ${other.user.id}
      from f`.execute(admin());
    const extra = await phoneMedium(orderId, other.user.id);
    const refused = await openSession(other, orderId, extra, { file: declaration(jpeg()) });
    expect([refused.status, codeOf(refused.body)]).toEqual([422, 'limit_exceeded']);
    expect(errorsOf(refused.body)).toEqual([{ pointer: '/items', code: 'too_many_unfinished_for_user' }]);
    expect(await fileOf(extra)).toEqual([]);
  });
});

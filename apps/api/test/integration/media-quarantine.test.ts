import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AbandonedUploadsJob, MediaScanService, QuarantineRetentionJob, SignatureMonitorJob } from '../../src/modules/media/index.ts';
import { alertText } from '../../src/modules/identity/domain/email-templates.ts';
import { PART_SIZE_BYTES } from '../../src/modules/media/domain/upload-plan.ts';
import type { Database } from '../../src/platform/database/database.ts';
import type { EventBus } from '../../src/platform/events/event-bus.ts';
import type { Logger } from '../../src/platform/logging/logger.ts';
import { EICAR } from '../../src/platform/malware-scan/fake-malware-scanner.ts';
import { DATABASE, EVENT_BUS, LOGGER } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { insertMedia, sha256Of } from '../support/media-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';
import type { Kysely } from 'kysely';

const NOW = '2026-10-27T08:00:00.000Z';
const BASE = '/api/v1/work-orders';
const MINUTE = 60_000;
const DAY = 24 * 3_600_000;

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
  current.scanner.signatures = new Date(NOW);
  await clearWorkOrderCreation(current.database.admin);
});

const admin = () => current.database.admin;

/** `fresh`: the window of a step-up is open (a passkey just now). */
async function signIn(role: Role, options: { fresh?: boolean; channel?: 'web' | 'mobile' } = {}) {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, {
    channel: options.channel ?? 'web',
    ...(options.fresh === true ? { passkeyAuthenticatedAt: current.clock.now() } : {}),
  });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;

let numbering = 0;
async function order(deleted = false): Promise<string> {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `quarantine${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [
    {
      number: `ZL-7${String(numbering).padStart(3, '0')}-0001`,
      customerId,
      siteId,
      ...(deleted ? { deletedAt: new Date('2026-10-02T08:00:00Z') } : {}),
    },
  ]);
  return [...ids.values()][0] ?? '';
}

const jpeg = (size = 2048, fill = 7): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), Buffer.alloc(size - 12, fill)]);

interface MediaBody {
  id: string;
  fileState: string;
  needsAttention: boolean;
  quarantine: { state: string; expiresAt: string; purgedAt: string | null } | null;
  quarantineReasonCode?: string;
  stateReasonCode: string | null;
}
interface ListBody {
  items: MediaBody[];
  nextCursor: string | null;
  needsAttentionCount: number;
}
const listFor = (browser: Browser, orderId: string, query = '') => browser.panel.get(`${BASE}/${orderId}/media-assets${query}`);
const rescan = (browser: Browser, orderId: string, mediaAssetId: string, key: string | null = uuidv7()) =>
  browser.panel.post(`${BASE}/${orderId}/media-assets/${mediaAssetId}/rescan`, undefined, key === null ? {} : { 'Idempotency-Key': key });

const file = async (mediaAssetId: string) =>
  (
    await sql<{
      id: string;
      state: string;
      state_reason_code: string | null;
      quarantined_at: Date | null;
      purged_at: Date | null;
      object_key: string;
    }>`select id, state, state_reason_code, quarantined_at, purged_at, object_key from media.stored_files where media_asset_id = ${mediaAssetId}`.execute(
      admin(),
    )
  ).rows[0];
const count = async (query: Promise<{ rows: Array<{ n: string }> }>): Promise<number> => Number((await query).rows[0]?.n);
const auditRows = (action: string, objectId: string) =>
  sql<Record<string, unknown>>`select * from audit.events where action = ${action} and object_id = ${objectId} order by occurred_at, id`
    .execute(admin())
    .then((result) => result.rows);

/** A file in quarantine whose object is in the storage (a clean body unless `body` says otherwise). */
async function held(
  orderId: string,
  userId: string,
  options: {
    body?: Buffer;
    reason?: 'malware_detected' | 'type_mismatch';
    quarantinedAt?: string;
    state?: 'quarantined' | 'scanning';
    declaredSha?: string;
  } = {},
) {
  const body = options.body ?? jpeg();
  const state = options.state ?? 'quarantined';
  const media = await insertMedia(admin(), {
    workOrderId: orderId,
    createdBy: userId,
    state,
    ...(state === 'quarantined' ? { reason: options.reason ?? 'malware_detected' } : {}),
    size: body.length,
    sha256: options.declaredSha ?? sha256Of(body),
    quarantinedAt: new Date(options.quarantinedAt ?? NOW),
  });
  const put = current.storage.putObject(media.objectKey, body);
  await sql`update media.stored_files set s3_version_id = ${put.versionId}, s3_etag = ${put.etag} where id = ${media.storedFileId}`.execute(
    admin(),
  );
  return media;
}

const scan = () => current.app.get(MediaScanService, { strict: false });
const retention = () => current.app.get(QuarantineRetentionJob, { strict: false });
const abandoned = () => current.app.get(AbandonedUploadsJob, { strict: false });
const monitor = () => current.app.get(SignatureMonitorJob, { strict: false });
const alertCount = async (code: string): Promise<number> =>
  count(sql<{ n: string }>`select count(*)::text as n from platform.security_alert_outbox where alert_code = ${code}`.execute(admin()));

describe('EVM-049 AC1 AC6 the reason is the Administrator\'s alone; the filter "Wymaga uwagi" and its counter', () => {
  it('EVM-049 AC1 the Administrator sees the held state and the reason; the Editor and the Read-only user see "Wymaga uwagi" and NO reason - the field is absent, in the list as in the text of the answer', async () => {
    const orderId = await order();
    const administrator = await signIn('administrator');
    const owner = await signIn('editor');
    const a = await held(orderId, owner.userId, { reason: 'malware_detected' });
    const b = await held(orderId, owner.userId, { reason: 'type_mismatch' });

    const asAdmin = ((await listFor(administrator, orderId)).body as ListBody).items;
    expect(asAdmin.find((entry) => entry.id === a.mediaAssetId)).toMatchObject({
      fileState: 'quarantined',
      needsAttention: true,
      quarantine: { state: 'held', purgedAt: null },
      quarantineReasonCode: 'malware_detected',
    });
    expect(asAdmin.find((entry) => entry.id === b.mediaAssetId)?.quarantineReasonCode).toBe('type_mismatch');

    for (const role of ['editor', 'read_only'] as const) {
      const viewer = await signIn(role);
      const response = await listFor(viewer, orderId);
      const items = (response.body as ListBody).items;
      expect(items).toHaveLength(2);
      for (const entry of items) {
        expect(entry).toMatchObject({
          fileState: 'quarantined',
          needsAttention: true,
          quarantine: { state: 'held' },
          stateReasonCode: null,
        });
        expect('quarantineReasonCode' in entry, role).toBe(false);
      }
      expect(JSON.stringify(response.body), role).not.toMatch(/malware|type_mismatch|quarantineReasonCode|eicar/i);
    }
  });

  it('EVM-049 AC1 a file that is not held (or purged) has no reason even for the Administrator', async () => {
    const orderId = await order();
    const administrator = await signIn('administrator');
    const owner = await signIn('editor');
    const purged = await held(orderId, owner.userId, { quarantinedAt: '2026-08-01T10:00:00.000Z' });
    await sql`update media.stored_files set purged_at = ${NOW} where id = ${purged.storedFileId}`.execute(admin());
    const items = ((await listFor(administrator, orderId)).body as ListBody).items;
    expect(items[0]).toMatchObject({ needsAttention: false, quarantine: { state: 'purged', purgedAt: NOW } });
    expect('quarantineReasonCode' in (items[0] as object)).toBe(false);
  });

  it('EVM-049 AC6 needsAttention=true lists only the held files, the counter is the same for every role, false lists all, any other value is 400, a cursor of another filter is invalid_cursor', async () => {
    const orderId = await order();
    const other = await order();
    const owner = await signIn('editor');
    await held(orderId, owner.userId);
    await held(orderId, owner.userId);
    await insertMedia(admin(), { workOrderId: orderId, createdBy: owner.userId, state: 'ready' });
    await held(other, owner.userId);
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const viewer = await signIn(role);
      const all = (await listFor(viewer, orderId)).body as ListBody;
      expect(all.items).toHaveLength(3);
      expect(all.needsAttentionCount, role).toBe(2);
      const filtered = (await listFor(viewer, orderId, '?needsAttention=true')).body as ListBody;
      expect(
        filtered.items.map((entry) => entry.needsAttention),
        role,
      ).toEqual([true, true]);
      expect(filtered.needsAttentionCount).toBe(2);
      expect(((await listFor(viewer, orderId, '?needsAttention=false')).body as ListBody).items).toHaveLength(3);
      for (const bad of ['yes', '1', 'TRUE', '']) expect((await listFor(viewer, orderId, `?needsAttention=${bad}`)).status, bad).toBe(400);
    }
    const viewer = await signIn('editor');
    const first = (await listFor(viewer, orderId, '?limit=1')).body as ListBody;
    expect(first.nextCursor).not.toBeNull();
    const crossed = await listFor(viewer, orderId, `?limit=1&needsAttention=true&cursor=${first.nextCursor ?? ''}`);
    expect(crossed.status).toBe(400);
    expect(crossed.body).toMatchObject({ code: 'invalid_cursor' });
    // the cursor of the Administrator (a variant with the reason) is not valid for an Editor
    const administrator = await signIn('administrator');
    const adminPage = (await listFor(administrator, orderId, '?limit=1')).body as ListBody;
    expect((await listFor(viewer, orderId, `?limit=1&cursor=${adminPage.nextCursor ?? ''}`)).status).toBe(400);
    // an order with no held files: an empty page and a zero counter
    const clean = await order();
    expect((await listFor(viewer, clean, '?needsAttention=true')).body).toEqual({ items: [], nextCursor: null, needsAttentionCount: 0 });
  });
});

describe('EVM-049 AC2 the alert: an e-mail with a link per active Administrator and a security alert', () => {
  async function activeAdministrators(): Promise<string[]> {
    const rows = await sql<{
      id: string;
    }>`select id from identity.users where role = 'administrator' and status = 'active' and deleted_at is null order by id`.execute(
      admin(),
    );
    return rows.rows.map((row) => row.id);
  }

  async function infected(orderId: string, owner: Browser): Promise<string> {
    const body = Buffer.concat([jpeg(512), Buffer.from(EICAR)]);
    const id = uuidv7();
    const created = await owner.panel.post(
      `${BASE}/${orderId}/media-assets`,
      {
        items: [
          {
            id,
            category: 'in_progress',
            fileName: 'foto-klienta.jpg',
            declaredSize: body.length,
            contentType: 'image/jpeg',
            sha256: sha256Of(body),
          },
        ],
      },
      { 'Idempotency-Key': uuidv7() },
    );
    expect(created.status).toBe(201);
    const session = await owner.panel.post(
      `${BASE}/${orderId}/media-assets/${id}/upload-sessions`,
      { id: uuidv7() },
      { 'Idempotency-Key': uuidv7() },
    );
    const sessionId = (session.body as { id: string }).id;
    const uploadId =
      (await sql<{ s3_upload_id: string }>`select s3_upload_id from media.upload_sessions where id = ${sessionId}`.execute(admin())).rows[0]
        ?.s3_upload_id ?? '';
    current.storage.putPart(uploadId, 1, body);
    expect((await owner.panel.post(`${BASE}/${orderId}/media-assets/${id}/upload-sessions/${sessionId}/complete`)).status).toBe(200);
    return id;
  }

  it('EVM-049 AC2 SR-FILE-05 SR-LOG-07 a file stopped by the scan: one e-mail per ACTIVE Administrator (not a deactivated, not an Editor), a security alert, the audit event; a second file of the same order adds an alert but no second pending e-mail', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    await createUser(admin(), current.clock, { role: 'administrator', status: 'deactivated' });
    await createUser(admin(), current.clock, { role: 'administrator', status: 'invited' });
    const recipients = await activeAdministrators();
    expect(recipients.length).toBeGreaterThan(0);
    const alerts = await alertCount('media_quarantined');

    const first = await infected(orderId, owner);
    expect(await scan().runOnce()).toBe(1);
    const row = await file(first);
    expect(row).toMatchObject({ state: 'quarantined', state_reason_code: 'malware_detected' });
    expect(row?.quarantined_at?.toISOString()).toBe(NOW);

    const mails = (
      await sql<{ recipient_user_id: string; kind: string; variant: string; subject_id: string }>`
        select recipient_user_id, kind, variant, subject_id from platform.email_outbox
        where variant = 'administrator_media_quarantined' and subject_id = ${orderId} and state = 'pending' order by recipient_user_id`.execute(
        admin(),
      )
    ).rows;
    expect(mails.map((mail) => mail.recipient_user_id)).toEqual(recipients);
    expect(mails.every((mail) => mail.kind === 'administrator_alert')).toBe(true);
    expect((await alertCount('media_quarantined')) - alerts).toBe(1);
    expect(await auditRows('media_file.quarantined', first)).toHaveLength(1);

    await infected(orderId, owner);
    expect(await scan().runOnce()).toBe(1);
    expect(
      await count(
        sql<{
          n: string;
        }>`select count(*)::text as n from platform.email_outbox where variant = 'administrator_media_quarantined' and subject_id = ${orderId} and state = 'pending'`.execute(
          admin(),
        ),
      ),
    ).toBe(recipients.length);
    expect((await alertCount('media_quarantined')) - alerts).toBe(2);
  });

  it('EVM-049 AC2 SR-LOG-02 the e-mail is only a link to the order made of the configured origin: no file name, customer, address or reason - in the subject and the text', () => {
    const orderId = uuidv7();
    const { subject, text } = alertText({
      panelOrigin: PANEL_ORIGIN,
      variant: 'administrator_media_quarantined',
      occurredAt: new Date(NOW),
      subjectId: orderId,
    });
    expect(text).toContain(`${PANEL_ORIGIN}/work-orders/${orderId}`);
    for (const part of [subject, text]) {
      expect(part).not.toMatch(/foto-klienta|jpg|malware|eicar|type_mismatch|ZL-\d|@|ul\.|Kowalski/i);
    }
  });

  it('EVM-049 AC2 the alert is part of the transition: when the recipients cannot be chosen the transition rolls back (the file stays in scanning, no e-mail, no alert, no audit) and is scanned again', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const body = Buffer.concat([jpeg(512), Buffer.from(EICAR)]);
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
    const real = current.app.get(MediaScanService, { strict: false });
    const failing = new (real.constructor as new (deps: unknown) => MediaScanService)({
      db: current.app.get<Kysely<Database>>(DATABASE, { strict: false }),
      clock: current.clock,
      events: current.app.get<EventBus>(EVENT_BUS, { strict: false }),
      logger: current.app.get<Logger>(LOGGER, { strict: false }),
      storage: current.storage,
      scanner: current.scanner,
      administrators: () => Promise.reject(new Error('directory down')),
    });
    const alerts = await alertCount('media_quarantined');
    await expect(failing.scanFile(media.storedFileId)).rejects.toThrow('directory down');
    expect((await file(media.mediaAssetId))?.state).toBe('scanning');
    expect(await alertCount('media_quarantined')).toBe(alerts);
    expect(await auditRows('media_file.quarantined', media.mediaAssetId)).toHaveLength(0);
  });
});

describe('EVM-049 AC3 AC8 the new scan: Administrator with a fresh step-up, the same pipeline, the clock of the retention does not move', () => {
  it('EVM-049 AC3 a file that is still infected: 202 scanning (no reason in the answer), audit rescan_requested, then quarantined again with NO new e-mail and NO new alert, audit rescanned (toCode quarantined), quarantined_at unchanged', async () => {
    const orderId = await order();
    const administrator = await signIn('administrator', { fresh: true });
    const owner = await signIn('editor');
    const infected = await held(orderId, owner.userId, {
      body: Buffer.concat([jpeg(512), Buffer.from(EICAR)]),
      quarantinedAt: '2026-10-20T08:00:00.000Z',
    });
    const alerts = await alertCount('media_quarantined');
    const mails = await count(
      sql<{ n: string }>`select count(*)::text as n from platform.email_outbox where variant = 'administrator_media_quarantined'`.execute(
        admin(),
      ),
    );

    const response = await rescan(administrator, orderId, infected.mediaAssetId);
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      id: infected.mediaAssetId,
      fileState: 'scanning',
      needsAttention: true,
      quarantine: { state: 'held' },
    });
    expect('quarantineReasonCode' in (response.body as object)).toBe(false);
    expect((await file(infected.mediaAssetId))?.state_reason_code).toBeNull();
    expect(await auditRows('media_file.rescan_requested', infected.mediaAssetId)).toHaveLength(1);
    expect((await auditRows('media_file.rescan_requested', infected.mediaAssetId))[0]).toMatchObject({
      actor_user_id: administrator.userId,
      outcome: 'success',
    });

    expect(await scan().runOnce()).toBe(1);
    const after = await file(infected.mediaAssetId);
    expect(after).toMatchObject({ state: 'quarantined', state_reason_code: 'malware_detected' });
    expect(after?.quarantined_at?.toISOString()).toBe('2026-10-20T08:00:00.000Z');
    expect(await alertCount('media_quarantined')).toBe(alerts);
    expect(
      await count(
        sql<{ n: string }>`select count(*)::text as n from platform.email_outbox where variant = 'administrator_media_quarantined'`.execute(
          admin(),
        ),
      ),
    ).toBe(mails);
    const rescanned = await auditRows('media_file.rescanned', infected.mediaAssetId);
    expect(rescanned).toHaveLength(1);
    expect(rescanned[0]).toMatchObject({ actor_type: 'system', from_code: 'quarantined', to_code: 'quarantined' });
    expect(JSON.stringify(rescanned)).not.toMatch(/malware|eicar/i);
  });

  it('EVM-049 AC3 after an update of the signatures the file is clean: the same pipeline (checksum, type, ClamAV) returns it to the flow, the quarantine is gone, the clock stayed, audit rescanned (toCode clean)', async () => {
    const orderId = await order();
    const administrator = await signIn('administrator', { fresh: true });
    const owner = await signIn('editor');
    const media = await held(orderId, owner.userId, { quarantinedAt: '2026-10-20T08:00:00.000Z' });
    expect((await rescan(administrator, orderId, media.mediaAssetId)).status).toBe(202);
    expect(await scan().runOnce()).toBe(1);
    const after = await file(media.mediaAssetId);
    expect(after).toMatchObject({ state: 'clean', state_reason_code: null });
    expect(after?.quarantined_at?.toISOString()).toBe('2026-10-20T08:00:00.000Z');
    const entry = ((await listFor(administrator, orderId)).body as ListBody).items.find((item) => item.id === media.mediaAssetId);
    expect(entry).toMatchObject({ fileState: 'clean', needsAttention: false, quarantine: null });
    expect((await auditRows('media_file.rescanned', media.mediaAssetId))[0]).toMatchObject({ to_code: 'clean' });
  });

  it('EVM-049 AC3 the new scan is the FULL pipeline: a file whose checksum no longer matches is failed, never clean, and a type that does not match stays in quarantine (type_mismatch)', async () => {
    const orderId = await order();
    const administrator = await signIn('administrator', { fresh: true });
    const owner = await signIn('editor');
    const damaged = await held(orderId, owner.userId, { declaredSha: 'f'.repeat(64) });
    expect((await rescan(administrator, orderId, damaged.mediaAssetId)).status).toBe(202);
    await scan().runOnce();
    expect(await file(damaged.mediaAssetId)).toMatchObject({ state: 'failed', state_reason_code: 'checksum_mismatch' });

    const wrong = await held(orderId, owner.userId, { body: Buffer.from('not an image at all, just text'), reason: 'type_mismatch' });
    expect((await rescan(administrator, orderId, wrong.mediaAssetId)).status).toBe(202);
    await scan().runOnce();
    expect(await file(wrong.mediaAssetId)).toMatchObject({ state: 'quarantined', state_reason_code: 'type_mismatch' });
  });

  it('EVM-049 AC8 SR-API-07 only a quarantined file can be scanned again: scanning, clean, ready, uploaded and purged are 409 invalid_state_transition; a repeat of the same key is 202 replayed with no second event', async () => {
    const orderId = await order();
    const administrator = await signIn('administrator', { fresh: true });
    const owner = await signIn('editor');
    const media = await held(orderId, owner.userId);
    const key = uuidv7();
    expect((await rescan(administrator, orderId, media.mediaAssetId, key)).status).toBe(202);
    const replay = await rescan(administrator, orderId, media.mediaAssetId, key);
    expect(replay.status).toBe(202);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(await auditRows('media_file.rescan_requested', media.mediaAssetId)).toHaveLength(1);
    // now it is scanning: another key is refused
    const again = await rescan(administrator, orderId, media.mediaAssetId);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'invalid_state_transition' });
    for (const state of ['clean', 'ready', 'uploaded', 'pending_upload', 'processing'] as const) {
      const other = await insertMedia(admin(), { workOrderId: orderId, createdBy: owner.userId, state });
      expect((await rescan(administrator, orderId, other.mediaAssetId)).status, state).toBe(409);
    }
    const purged = await held(orderId, owner.userId);
    await sql`update media.stored_files set purged_at = ${NOW} where id = ${purged.storedFileId}`.execute(admin());
    expect((await rescan(administrator, orderId, purged.mediaAssetId)).status).toBe(409);
    // the key is required (a UUIDv7)
    const fresh = await held(orderId, owner.userId);
    expect((await rescan(administrator, orderId, fresh.mediaAssetId, null)).status).toBe(400);
    expect((await rescan(administrator, orderId, fresh.mediaAssetId, 'not-a-uuid')).status).toBe(400);
    expect((await file(fresh.mediaAssetId))?.state).toBe('quarantined');
  });

  it('EVM-049 AC8 SR-AUTHZ-05 SR-SESS-08 the roles: the Administrator with a fresh step-up 202; with an old one 403 step_up_required; the Editor and the Read-only user 403 forbidden (also for a medium that does not exist); no session 401; the mobile channel 403', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const media = await held(orderId, owner.userId);
    const ghost = uuidv7();

    const editor = await signIn('editor', { fresh: true });
    const reader = await signIn('read_only', { fresh: true });
    for (const [name, browser] of [
      ['editor', editor],
      ['read_only', reader],
    ] as const) {
      for (const target of [media.mediaAssetId, ghost]) {
        const response = await rescan(browser, orderId, target);
        expect(response.status, `${name} ${target === ghost ? 'ghost' : 'real'}`).toBe(403);
        expect(response.body).toMatchObject({ code: 'forbidden' });
      }
    }
    expect((await file(media.mediaAssetId))?.state).toBe('quarantined');

    const stale = await signIn('administrator');
    const staleResponse = await rescan(stale, orderId, media.mediaAssetId);
    expect(staleResponse.status).toBe(403);
    expect(staleResponse.body).toMatchObject({ code: 'step_up_required' });
    expect((await file(media.mediaAssetId))?.state).toBe('quarantined');

    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    expect((await rescan({ userId: '', panel: anonymous }, orderId, media.mediaAssetId)).status).toBe(401);

    const mobile = await signIn('administrator', { fresh: true, channel: 'mobile' });
    expect((await rescan(mobile, orderId, media.mediaAssetId)).status).toBe(403);

    const noCsrf = await signIn('administrator', { fresh: true });
    noCsrf.panel.csrfToken = undefined;
    expect((await rescan(noCsrf, orderId, media.mediaAssetId)).status).toBe(403);
    expect((await file(media.mediaAssetId))?.state).toBe('quarantined');

    const administrator = await signIn('administrator', { fresh: true });
    expect((await rescan(administrator, orderId, media.mediaAssetId)).status).toBe(202);
  });

  it('EVM-049 AC8 SR-AUTHZ-02 IDOR: a medium of another order, a missing one and a deleted order are the same 404', async () => {
    const orderId = await order();
    const other = await order();
    const owner = await signIn('editor');
    const foreign = await held(other, owner.userId);
    const administrator = await signIn('administrator', { fresh: true });
    const a = await rescan(administrator, orderId, foreign.mediaAssetId);
    const b = await rescan(administrator, orderId, uuidv7());
    expect([a.status, b.status]).toEqual([404, 404]);
    expect(a.body).toMatchObject({ code: 'not_found' });
    expect(b.body).toMatchObject({ code: 'not_found' });
    const gone = await order(true);
    const inGone = await held(gone, owner.userId);
    expect((await rescan(administrator, gone, inGone.mediaAssetId)).status).toBe(404);
    expect((await file(inGone.mediaAssetId))?.state).toBe('quarantined');
  });
});

describe('EVM-049 AC5 the retention: 30 days from the first entry, counted in the business zone (the clock is controlled)', () => {
  const quarantinedOn = '2026-09-01T10:00:00.000Z';

  it('EVM-049 AC5 the database function: 2026-09-01 gives 2026-10-01 00:00 Warsaw (CEST); across the change of the clock (2026-09-27 + 30 days) 2026-10-26 00:00 Warsaw is CET', async () => {
    const rows = await sql<{ a: Date; b: Date }>`
      select media.quarantine_expires_at('2026-09-01T10:00:00Z'::timestamptz, 30) as a,
             media.quarantine_expires_at('2026-09-27T10:00:00Z'::timestamptz, 30) as b`.execute(admin());
    expect(rows.rows[0]?.a.toISOString()).toBe('2026-09-30T22:00:00.000Z');
    expect(rows.rows[0]?.b.toISOString()).toBe('2026-10-26T23:00:00.000Z');
  });

  it('EVM-049 AC5 at 23:59 of 30.09 nothing is removed; at 00:00 of 1.10 the object is gone (a delete marker), purged_at is set, one audit event, the tile "purged" has no reason and no action', async () => {
    const orderId = await order();
    current.clock.set('2026-09-30T21:59:00.000Z'); // the sessions are made at the instant of the test (the step-up window and the idle time follow the clock)
    const owner = await signIn('editor');
    const administrator = await signIn('administrator', { fresh: true });
    const media = await held(orderId, owner.userId, { quarantinedAt: quarantinedOn });

    current.clock.set('2026-09-30T21:59:00.000Z'); // 23:59 in Warsaw
    expect(await retention().run()).toEqual({ purged: 0, failed: 0 });
    expect(current.storage.isDeleted(media.objectKey)).toBe(false);
    expect((await file(media.mediaAssetId))?.purged_at).toBeNull();

    current.clock.set('2026-09-30T22:00:00.000Z'); // 00:00 on 2026-10-01 in Warsaw
    expect(await retention().run()).toEqual({ purged: 1, failed: 0 });
    expect(current.storage.isDeleted(media.objectKey)).toBe(true);
    await expect(current.storage.head(media.objectKey)).resolves.toBeUndefined();
    const row = await file(media.mediaAssetId);
    expect(row?.purged_at?.toISOString()).toBe('2026-09-30T22:00:00.000Z');
    expect(row?.state).toBe('quarantined');
    expect(await auditRows('media_file.quarantine_purged', media.mediaAssetId)).toHaveLength(1);

    // a second run removes nothing and adds no event
    expect(await retention().run()).toEqual({ purged: 0, failed: 0 });
    expect(await auditRows('media_file.quarantine_purged', media.mediaAssetId)).toHaveLength(1);

    for (const browser of [administrator, owner]) {
      const entry = ((await listFor(browser, orderId)).body as ListBody).items[0];
      expect(entry).toMatchObject({
        needsAttention: false,
        quarantine: { state: 'purged', expiresAt: '2026-09-30T22:00:00.000Z', purgedAt: '2026-09-30T22:00:00.000Z' },
      });
      expect('quarantineReasonCode' in (entry as object)).toBe(false);
    }
    expect(((await listFor(owner, orderId, '?needsAttention=true')).body as ListBody).items).toEqual([]);
    expect((await rescan(administrator, orderId, media.mediaAssetId)).status).toBe(409);
  });

  it('EVM-049 AC5 29 days leave the file untouched; a new scan with a positive result does not move the deadline', async () => {
    const orderId = await order();
    current.clock.set('2026-09-30T20:00:00.000Z'); // the sessions are made at the instant of the test (the step-up window and the idle time follow the clock)
    const owner = await signIn('editor');
    const administrator = await signIn('administrator', { fresh: true });
    const media = await held(orderId, owner.userId, { body: Buffer.concat([jpeg(512), Buffer.from(EICAR)]), quarantinedAt: quarantinedOn });
    current.clock.set('2026-09-30T20:00:00.000Z'); // 29 days and 10 hours after the entry
    expect(await retention().run()).toEqual({ purged: 0, failed: 0 });
    expect((await rescan(administrator, orderId, media.mediaAssetId)).status).toBe(202);
    await scan().runOnce();
    expect((await file(media.mediaAssetId))?.quarantined_at?.toISOString()).toBe(quarantinedOn);
    const entry = ((await listFor(administrator, orderId)).body as ListBody).items[0];
    expect(entry?.quarantine?.expiresAt).toBe('2026-09-30T22:00:00.000Z');
  });

  it('EVM-049 AC5 SR-ERR-01 a storage that fails leaves the file NOT purged and the next run removes it; a request for a new scan after the deadline is 409', async () => {
    const orderId = await order();
    current.clock.set('2026-10-01T06:00:00.000Z'); // the sessions are made at the instant of the test (the step-up window and the idle time follow the clock)
    const owner = await signIn('editor');
    const administrator = await signIn('administrator', { fresh: true });
    const media = await held(orderId, owner.userId, { quarantinedAt: quarantinedOn });
    current.clock.set('2026-10-01T06:00:00.000Z');
    current.storage.unavailable = true;
    expect(await retention().run()).toEqual({ purged: 0, failed: 1 });
    expect((await file(media.mediaAssetId))?.purged_at).toBeNull();
    expect(await auditRows('media_file.quarantine_purged', media.mediaAssetId)).toHaveLength(0);
    // the deadline has passed: a new scan can no longer be asked for (it must not race the retention)
    const late = await rescan(administrator, orderId, media.mediaAssetId);
    expect(late.status).toBe(409);
    expect((await file(media.mediaAssetId))?.state).toBe('quarantined');
    current.storage.unavailable = false;
    expect(await retention().run()).toEqual({ purged: 1, failed: 0 });
    expect(current.storage.isDeleted(media.objectKey)).toBe(true);
  });

  it('EVM-049 AC5 races: a file held in a new scan past its deadline is returned to quarantine and removed, and the late verdict of the scan finds nothing to move', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const media = await held(orderId, owner.userId, { quarantinedAt: quarantinedOn, state: 'scanning' });
    current.clock.set('2026-10-02T06:00:00.000Z');
    expect(await retention().run()).toEqual({ purged: 1, failed: 0 });
    const row = await file(media.mediaAssetId);
    expect(row).toMatchObject({ state: 'quarantined' });
    expect(row?.purged_at).not.toBeNull();
    expect(await scan().scanFile(media.storedFileId)).toBe(false);
    expect((await file(media.mediaAssetId))?.state).toBe('quarantined');
  });
});

describe('EVM-049 AC7 the monitor of the signatures (fail closed, the deduplication is in the database)', () => {
  const HOURS = 3_600_000;

  beforeEach(async () => {
    await sql`delete from platform.security_alert_outbox where alert_code in ('signature_stale', 'signature_stale_72h')`
      .execute(admin())
      .catch(() => undefined);
  });

  it('EVM-049 AC7 fresh signatures raise nothing; older than 24 h one signature_stale per episode; the scan goes on', async () => {
    const before = await alertCount('signature_stale');
    current.scanner.signatures = new Date(current.clock.now().getTime() - 23 * HOURS);
    expect(await monitor().run()).toMatchObject({ alerts: 0 });
    current.clock.advance(2 * HOURS);
    expect(await monitor().run()).toMatchObject({ alerts: 1 });
    current.clock.advance(15 * MINUTE);
    expect(await monitor().run()).toMatchObject({ alerts: 0 });
    expect((await alertCount('signature_stale')) - before).toBe(1);
    // a new build of the signatures starts a new episode
    current.scanner.signatures = new Date(current.clock.now());
    current.clock.advance(25 * HOURS);
    expect(await monitor().run()).toMatchObject({ alerts: 1 });
    expect((await alertCount('signature_stale')) - before).toBe(2);
  });

  it('EVM-049 AC7 older than 72 h signature_stale_72h every day, not more often', async () => {
    current.scanner.signatures = new Date(current.clock.now().getTime() - 73 * HOURS);
    const result = await monitor().run();
    expect(result).toMatchObject({ alerts: 2 });
    current.clock.advance(23 * HOURS);
    expect(await monitor().run()).toMatchObject({ alerts: 0 });
    current.clock.advance(HOURS + MINUTE);
    expect(await monitor().run()).toMatchObject({ alerts: 1 });
    expect(await alertCount('signature_stale_72h')).toBe(2);
  });

  it('EVM-049 AC7 SR-ERR-01 an age that is not known (no answer, garbage, a date from the future) counts as old once it has lasted 24 h - a broken monitor does not hide old signatures', async () => {
    current.scanner.signatures = 'unknown';
    expect(await monitor().run()).toMatchObject({ alerts: 0 });
    current.clock.advance(12 * HOURS);
    expect(await monitor().run()).toMatchObject({ alerts: 0 });
    current.clock.advance(13 * HOURS);
    expect(await monitor().run()).toMatchObject({ alerts: 1 });
    // the answer returns with a date from the future: still not a known age, the episode goes on without a second alert
    current.scanner.signatures = new Date(current.clock.now().getTime() + HOURS);
    current.clock.advance(15 * MINUTE);
    expect(await monitor().run()).toMatchObject({ alerts: 0 });
    // a good answer ends the unknown age
    current.scanner.signatures = new Date(current.clock.now());
    expect(await monitor().run()).toMatchObject({ alerts: 0, ageHours: 0 });
  });
});

describe('EVM-049 D9 abandoned uploads and the limits of unfinished media (RR-NOC-T1-4)', () => {
  it('EVM-049 D9 a file that waited 7 days with no active session becomes failed/abandoned, its expired session is closed and aborted; one with a live session or younger than 7 days stays', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const old = new Date(current.clock.now().getTime() - 8 * DAY);
    const stale = await insertMedia(admin(), {
      workOrderId: orderId,
      createdBy: owner.userId,
      createdAt: old,
      session: { userId: owner.userId, state: 'active', expiresAt: new Date(old.getTime() + DAY) },
    });
    const alive = await insertMedia(admin(), {
      workOrderId: orderId,
      createdBy: owner.userId,
      createdAt: old,
      session: { userId: owner.userId, state: 'active', expiresAt: new Date(current.clock.now().getTime() + DAY) },
    });
    const young = await insertMedia(admin(), { workOrderId: orderId, createdBy: owner.userId });
    await sql`update media.stored_files set state_changed_at = ${old} where id in (${stale.storedFileId}, ${alive.storedFileId})`.execute(
      admin(),
    );
    await sql`update media.stored_files set state_changed_at = ${current.clock.now()} where id = ${young.storedFileId}`.execute(admin());

    const result = await abandoned().run();
    expect(result).toMatchObject({ abandoned: 1, aborted: 1, abortFailed: 0 });
    expect(await file(stale.mediaAssetId)).toMatchObject({ state: 'failed', state_reason_code: 'abandoned' });
    expect((await file(alive.mediaAssetId))?.state).toBe('pending_upload');
    expect((await file(young.mediaAssetId))?.state).toBe('pending_upload');
    const session = await sql<{ state: string }>`select state from media.upload_sessions where id = ${stale.sessionId}`.execute(admin());
    expect(session.rows[0]?.state).toBe('expired');
    expect(await abandoned().run()).toMatchObject({ abandoned: 0 });
  });

  it('EVM-049 D9 zero loss of data: the owner resumes an abandoned medium with the SAME identifier and key - a new session, the file is pending_upload again', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const old = new Date(current.clock.now().getTime() - 9 * DAY);
    const stale = await insertMedia(admin(), { workOrderId: orderId, createdBy: owner.userId, createdAt: old });
    await sql`update media.stored_files set state_changed_at = ${old} where id = ${stale.storedFileId}`.execute(admin());
    await abandoned().run();
    expect((await file(stale.mediaAssetId))?.state).toBe('failed');
    const listed = (await listFor(owner, orderId, '?uploadState=unfinished')).body as ListBody;
    expect(listed.items.map((entry) => entry.id)).toContain(stale.mediaAssetId);
    const resumed = await owner.panel.post(
      `${BASE}/${orderId}/media-assets/${stale.mediaAssetId}/upload-sessions`,
      { id: uuidv7() },
      { 'Idempotency-Key': uuidv7() },
    );
    expect(resumed.status).toBe(201);
    expect(await file(stale.mediaAssetId)).toMatchObject({ state: 'pending_upload', state_reason_code: null, object_key: stale.objectKey });
  });

  it('EVM-049 D9 the limits: a batch that would pass the limit per user or per order is 422 limit_exceeded with no value; the limit counts unfinished media only; parallel batches cannot both pass', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const body = jpeg();
    const item = () => ({
      id: uuidv7(),
      category: 'in_progress',
      fileName: 'a.jpg',
      declaredSize: body.length,
      contentType: 'image/jpeg',
      sha256: sha256Of(body),
    });
    const post = (browser: Browser, target: string, items: unknown[]) =>
      browser.panel.post(`${BASE}/${target}/media-assets`, { items }, { 'Idempotency-Key': uuidv7() });
    // fill the order up to its limit of 500 with unfinished media of other users (fixtures), then one more
    for (let index = 0; index < 499; index += 1)
      await insertMedia(admin(), { workOrderId: orderId, createdBy: (await signIn('editor')).userId });
    expect((await post(owner, orderId, [item()])).status).toBe(201);
    const over = await post(owner, orderId, [item()]);
    expect(over.status).toBe(422);
    expect(over.body).toMatchObject({ code: 'limit_exceeded', errors: [{ pointer: '/items', code: 'too_many_unfinished_for_order' }] });
    expect(JSON.stringify(over.body)).not.toMatch(/\b500\b|\b200\b/);
    // finished media do not count: the order has room again
    await sql`update media.stored_files set state = 'ready' where media_asset_id in (select id from media.media_assets where work_order_id = ${orderId}) and state = 'pending_upload'`.execute(
      admin(),
    );
    const parallel = await Promise.all([post(owner, orderId, [item()]), post(owner, orderId, [item()])]);
    expect(parallel.map((response) => response.status)).toEqual([201, 201]);
  }, 120_000);

  it('EVM-049 D9 the limit per creator is counted under a lock: two parallel batches of the creator cannot both pass', async () => {
    const orderId = await order();
    const other = await order();
    const owner = await signIn('editor');
    for (let index = 0; index < 199; index += 1)
      await insertMedia(admin(), { workOrderId: index % 2 === 0 ? orderId : other, createdBy: owner.userId });
    const body = jpeg();
    const batch = (target: string) =>
      owner.panel.post(
        `${BASE}/${target}/media-assets`,
        {
          items: [
            {
              id: uuidv7(),
              category: 'in_progress',
              fileName: 'a.jpg',
              declaredSize: body.length,
              contentType: 'image/jpeg',
              sha256: sha256Of(body),
            },
          ],
        },
        { 'Idempotency-Key': uuidv7() },
      );
    const results = await Promise.all([batch(orderId), batch(other)]);
    expect(results.map((response) => response.status).sort()).toEqual([201, 422]);
    expect(PART_SIZE_BYTES).toBeGreaterThan(0);
  }, 120_000);
});

describe('EVM-049 the e-mail composer turns the alert into one link and refuses a subject that is not an identifier', () => {
  it('EVM-049 AC2 a recipient who is no longer an active Administrator gets nothing (obsolete); a subject that is not a UUID is a permanent refusal', async () => {
    const { InvitationEmailComposer } = await import('../../src/modules/identity/index.ts');
    const composer = current.app.get(InvitationEmailComposer, { strict: false });
    const db = current.app.get<Kysely<Database>>(DATABASE, { strict: false });
    const active = await createUser(admin(), current.clock, { role: 'administrator' });
    const message = (subjectId: string | null, recipientUserId: string) => ({
      id: uuidv7(),
      kind: 'administrator_alert' as const,
      variant: 'administrator_media_quarantined',
      recipientUserId,
      subjectId,
      state: 'pending' as const,
      attempts: 0,
      createdAt: new Date(NOW),
    });
    const ready = await composer.compose(db, message(uuidv7(), active.id));
    expect(ready.status).toBe('ready');
    await expect(composer.compose(db, message('not-a-uuid', active.id))).rejects.toThrow();
    await expect(composer.compose(db, message(null, active.id))).rejects.toThrow();
    const editor = await createUser(admin(), current.clock, { role: 'editor' });
    expect((await composer.compose(db, message(uuidv7(), editor.id))).status).toBe('obsolete');
  });
});

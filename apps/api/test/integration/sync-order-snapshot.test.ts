import { zSyncWorkOrderSnapshot } from '@evia/contracts/zod';
import { assertSyncProjectionStrict } from '@evia/contracts/sync';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import type { IdentityApp } from '../support/identity-app.ts';
import { createUser } from '../support/identity-fixtures.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { insertEntries } from '../support/timeline-fixtures.ts';
import { MOBILE, newPhone, setDeviceState, signedInPhone, type Phone } from '../support/mobile-flows.ts';
import { insertParty, insertSite } from '../support/site-fixtures.ts';
import {
  adminDb,
  ago,
  bootSync,
  counter,
  drain,
  editor,
  keysOf,
  scenario,
  setWaitingParty,
  softDelete,
  restore,
  type Scenario,
  type SyncApp,
} from '../support/sync-harness.ts';
import { addTotp, totpAccount, type TotpAccount } from '../support/totp-flows.ts';
import { enrolledAccount } from '../support/login-flows.ts';
import { insertWorkOrders, numberOf } from '../support/work-order-fixtures.ts';

let current: SyncApp;
afterEach(async () => {
  await current.app.close();
});
const app = (): IdentityApp => current.app;
const db = () => adminDb(current.app);
const path = (id: string): string => `/api/v1/sync/work-orders/${id}`;
const snapshot = (phone: Phone, id: string) => phone.get(path(id), phone.authorised());
const problemOf = (response: { body: unknown }): string => (response.body as { code: string }).code;
const noStore = (response: { headers: Record<string, unknown> }): void => {
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['etag']).toBeUndefined();
};

async function boot(env: Record<string, string | undefined> = {}): Promise<void> {
  current = await bootSync(env);
}

/** The clock moves an hour on (the access token of the phone is short: it is renewed, as the app does). */
async function nextHour(phone: Phone): Promise<void> {
  app().clock.advance(3_600_000);
  const renewed = await phone.refresh();
  expect(renewed.status).toBe(200);
  phone.adopt(renewed);
}

interface SnapshotBody {
  serverTime: string;
  entities: Array<Record<string, unknown>>;
}
const keyOf = (entity: Record<string, unknown>): string => `${String(entity['type'])}:${String(entity['id'])}`;

/** Every reference the phone follows from an entity must resolve to an entity the phone holds. */
function unresolved(entities: readonly Record<string, unknown>[]): string[] {
  const have = new Set(entities.map(keyOf));
  const follows: Array<[string, string]> = [
    ['customerId', 'customer'],
    ['siteId', 'site'],
    ['coordinatorUserId', 'user'],
    ['managerPartyId', 'party'],
    ['distributionSystemOperatorPartyId', 'party'],
    ['waitingPartyId', 'party'],
    ['responsibleUserId', 'user'],
    ['authorUserId', 'user'],
    ['procedureStageId', 'procedure_stage'],
    ['workOrderId', 'work_order'],
  ];
  return entities.flatMap((entity) =>
    follows.flatMap(([field, type]) => {
      const value = entity[field];
      return typeof value === 'string' && !have.has(`${type}:${value}`) ? [`${keyOf(entity)}.${field}`] : [];
    }),
  );
}

describe('the snapshot of one order (EVM-097 AC3; ADR-0021 D3)', () => {
  it('EVM-097 AC3 an Editor gets 200, no-store, the aggregate of the order - the same entities at the same versions as the first download; schema of the contract and the strict projection', async () => {
    await boot();
    const { phone } = await editor(app());
    const s = await scenario(app());
    const response = await snapshot(phone, s.orderId);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    noStore(response);
    expect(response.headers['set-cookie']).toBeUndefined();
    const body = response.body as SnapshotBody;
    expect(zSyncWorkOrderSnapshot.safeParse(body).success).toBe(true);
    expect(Number.isNaN(Date.parse(body.serverTime))).toBe(false);
    for (const entity of body.entities)
      expect(assertSyncProjectionStrict({ op: 'upsert', entity }), JSON.stringify(entity)).toEqual({ ok: true });
    expect(unresolved(body.entities)).toEqual([]);

    const types = new Set(body.entities.map((entity) => entity['type']));
    expect([...types].sort()).toEqual([
      'customer',
      'party',
      'procedure_stage',
      'scope_item',
      'site',
      'timeline_entry',
      'user',
      'work_order',
    ]);
    expect(
      body.entities
        .filter((entity) => entity['type'] === 'party')
        .map((entity) => entity['id'])
        .sort(),
    ).toEqual([s.managerPartyId, s.waitedPartyId].sort());
    // the same reader as the first download: the same entities at the same versions
    const download = await drain(phone);
    const versions = (entities: Array<Record<string, unknown>>) =>
      entities.map((entity) => `${keyOf(entity)}@${String(entity['version'])}`).sort();
    expect(versions(body.entities)).toEqual(
      versions(download.changes.flatMap((change) => (change['op'] === 'upsert' ? [change['entity'] as Record<string, unknown>] : []))),
    );
    // nothing that must stay in the office
    const raw = JSON.stringify(body);
    for (const forbidden of [
      'party-email@example.invalid',
      'SENTINEL',
      's.stranger',
      'payment_milestone',
      s.paymentEntryId,
      s.stranger.id,
      s.strayPartyId,
    ])
      expect(raw, forbidden).not.toContain(forbidden);
  });

  it("EVM-097 AC3 an order that does not exist, is deleted (soft or for good), is closed over N days ago or is not the caller's is ONE answer: 404 not_found, the same body and the same headers", async () => {
    await boot();
    const { phone } = await editor(app());
    const alive = await scenario(app());
    const softDeleted = await scenario(app());
    await softDelete(app(), 'orders', softDeleted.orderId);
    const old = await scenario(app(), { status: 'settled', closedAt: ago(app(), 31) });
    const missing = '0193a000-0000-7000-8000-00000000dead';
    const answers = [];
    for (const id of [missing, softDeleted.orderId, old.orderId]) {
      const response = await snapshot(phone, id);
      expect(response.status, id).toBe(404);
      noStore(response);
      answers.push({ body: JSON.stringify({ ...(response.body as object), traceId: 'x' }), type: response.headers['content-type'] });
    }
    expect(new Set(answers.map((answer) => answer.body)).size).toBe(1);
    expect(new Set(answers.map((answer) => answer.type)).size).toBe(1);
    expect(answers[0]?.body).toContain('not_found');
    expect(answers[0]?.body).not.toContain(softDeleted.orderId);
    expect((await snapshot(phone, alive.orderId)).status).toBe(200);
    // a closed order within N days is served
    const recent = await scenario(app(), { status: 'settled', closedAt: ago(app(), 29) });
    expect((await snapshot(phone, recent.orderId)).status).toBe(200);
  });

  it('EVM-097 AC3 an identifier in a wrong format is 400 validation_failed from the contract - never a 500 from a cast of the database - and it is not counted as a probe', async () => {
    await boot();
    const { phone } = await editor(app());
    for (const id of ['not-a-uuid', '123', '0193a000-0000-7000-8000-00000000000z', "x'%20or%201=1", 'a'.repeat(200)]) {
      const response = await snapshot(phone, id);
      expect(response.status, id).toBe(400);
      expect(problemOf(response)).toBe('validation_failed');
      noStore(response);
    }
    const rows = await sql<{ n: number }>`select count(*)::int as n from sync.snapshot_requests`.execute(db());
    expect(rows.rows[0]?.n).toBe(0);
  });

  it('EVM-097 AC3 an aggregate over 1 MB raises the counter and is served unchanged; a small one does not', async () => {
    await boot();
    const { phone } = await editor(app());
    const small = await scenario(app());
    expect((await snapshot(phone, small.orderId)).status).toBe(200);
    expect(counter(app(), 'sync_snapshot_oversize_total')).toBe(0);
    const big = await scenario(app());
    const text = 'x'.repeat(9_900);
    await insertEntries(
      db(),
      big.orderId,
      big.author.id,
      Array.from({ length: 110 }, () => ({ body: text })),
    );
    const response = await snapshot(phone, big.orderId);
    expect(response.status).toBe(200);
    expect((response.body as SnapshotBody).entities.length).toBeGreaterThan(110);
    expect(counter(app(), 'sync_snapshot_oversize_total')).toBe(1);
    // the snapshot does not feed the metric of the identifiers
    expect(counter(app(), 'sync_snapshot_requests_total', { result: 'served' })).toBe(2);
  });
});

describe('who may take a snapshot (EVM-097 AC7; SR-AUTHZ-02, SR-AUTHZ-06, SR-SYNC-01, ASVS V8.2)', () => {
  it('EVM-097 AC7 Administrator and Editor: 200; Read-only: 403 (the code is the one of EVM-096); no token, a panel cookie and a foreign token: 401; with no data in the refusals', async () => {
    await boot();
    const s = await scenario(app());
    const enrolled = await enrolledAccount(app(), { role: 'administrator' });
    const secret = await addTotp(app(), enrolled);
    const adminPhone = await signedInPhone(app(), { ...enrolled, secret } as unknown as TotpAccount);
    const { phone: editorPhone } = await editor(app());
    const readOnly = await totpAccount(app(), { role: 'editor' });
    const readOnlyPhone = await signedInPhone(app(), readOnly);
    await sql`update identity.users set role = 'read_only' where id = ${readOnly.user.id}`.execute(db());

    for (const phone of [adminPhone, editorPhone]) {
      const response = await snapshot(phone, s.orderId);
      expect(response.status).toBe(200);
      noStore(response);
    }
    const denied = await snapshot(readOnlyPhone, s.orderId);
    expect(denied.status).toBe(403);
    noStore(denied);
    expect(problemOf(denied)).toBe('forbidden');
    expect(JSON.stringify(denied.body)).not.toContain('entities');

    const anonymous = newPhone(app());
    const credentials: Array<Record<string, string>> = [
      {},
      { Authorization: `Bearer evia_at_${'A'.repeat(43)}` },
      { Authorization: 'Basic abc' },
    ];
    for (const headers of credentials) {
      const response = await anonymous.get(path(s.orderId), headers);
      expect(response.status).toBe(401);
      noStore(response);
    }
    // the cookie of a session of the panel is not a credential of this channel
    const viaCookie = await enrolled.panel.get(path(s.orderId));
    expect(viaCookie.status).toBe(401);
    noStore(viaCookie);
    expect(JSON.stringify(viaCookie.body)).not.toContain('entities');
  });

  it('EVM-097 AC7 a revoked session is 401 session_revoked, a device to wipe is 401 device_wipe_required (it wins), a deactivated user is 401, an old app is 426 - before any data and before the limit is touched', async () => {
    await boot();
    const s = await scenario(app());
    const gone = await editor(app());
    expect((await gone.phone.post(MOBILE.logout, undefined, gone.phone.authorised())).status).toBe(204);
    const revoked = await snapshot(gone.phone, s.orderId);
    expect(revoked.status).toBe(401);
    expect(problemOf(revoked)).toBe('session_revoked');
    noStore(revoked);

    const wiped = await editor(app());
    await setDeviceState(app(), wiped.phone.deviceId ?? '', 'wipe_required');
    const wipe = await snapshot(wiped.phone, s.orderId);
    expect(wipe.status).toBe(401);
    expect(problemOf(wipe)).toBe('device_wipe_required');

    const deactivated = await editor(app());
    await sql`update identity.users set status = 'deactivated' where id = ${deactivated.account.user.id}`.execute(db());
    expect((await snapshot(deactivated.phone, s.orderId)).status).toBe(401);

    const old = await editor(app());
    const refused = await old.phone.get(path(s.orderId), { ...old.phone.authorised(), 'X-Client-Version': '0.0.1' });
    expect(refused.status).toBe(426);
    const counted = await sql<{ n: number }>`select count(*)::int as n from sync.snapshot_requests`.execute(db());
    expect(counted.rows[0]?.n).toBe(0);
  });

  it('EVM-097 AC7 the device is taken from the session: a header or a query that names another device or user changes nothing', async () => {
    await boot();
    const s = await scenario(app());
    const { phone } = await editor(app());
    const response = await phone.get(`${path(s.orderId)}?deviceId=0193a000-0000-7000-8000-000000000001`, phone.authorised());
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain('entities');
    const own = await phone.get(path(s.orderId), { ...phone.authorised(), 'X-Device-Id': '0193a000-0000-7000-8000-000000000001' });
    expect(own.status).toBe(200);
    const row = await sql<{ device_id: string }>`select device_id from sync.snapshot_requests`.execute(db());
    expect(row.rows.map((item) => item.device_id)).toEqual([phone.deviceId]);
  });
});

describe('the limit and the alert (EVM-097 AC7; SR-API-02, P10, CWE-770)', () => {
  it('EVM-097 AC7 the 4th request in an hour is 429 with Retry-After (a 404 counts too), the limit is per device, the hour resets it; the counter lives in the database', async () => {
    await boot({ SYNC_SNAPSHOTS_PER_HOUR: '3' });
    const s = await scenario(app());
    const first = await editor(app());
    const second = await editor(app());
    expect((await snapshot(first.phone, s.orderId)).status).toBe(200);
    expect((await snapshot(first.phone, '0193a000-0000-7000-8000-00000000dead')).status).toBe(404);
    expect((await snapshot(first.phone, s.orderId)).status).toBe(200);
    const limited = await snapshot(first.phone, s.orderId);
    expect(limited.status).toBe(429);
    noStore(limited);
    expect(problemOf(limited)).toBe('rate_limited');
    const now = app().clock.now().getTime();
    const hour = 3_600_000;
    expect(Number(limited.headers['retry-after'])).toBe(Math.ceil((Math.floor(now / hour) * hour + hour - now) / 1000));
    expect(JSON.stringify(limited.body)).not.toContain('entities');
    // a refused request of an unknown order is a 429 as well: nothing tells the two apart
    expect((await snapshot(first.phone, '0193a000-0000-7000-8000-00000000dead')).status).toBe(429);
    // another device has its own count
    expect((await snapshot(second.phone, s.orderId)).status).toBe(200);
    // the count is a row of the database (shared by every process of the API)
    const rows = await sql<{
      n: number;
    }>`select request_count as n from sync.snapshot_requests where device_id = ${first.phone.deviceId}`.execute(db());
    expect(rows.rows.map((row) => row.n)).toEqual([5]);
    await nextHour(first.phone);
    expect((await snapshot(first.phone, s.orderId)).status).toBe(200);
  });

  it('EVM-097 AC7 the limit holds under concurrency: 10 requests at once with room for 3 serve exactly 3', async () => {
    await boot({ SYNC_SNAPSHOTS_PER_HOUR: '3' });
    const s = await scenario(app());
    const { phone } = await editor(app());
    const answers = await Promise.all(Array.from({ length: 10 }, () => snapshot(phone, s.orderId)));
    expect(answers.filter((answer) => answer.status === 200)).toHaveLength(3);
    expect(answers.filter((answer) => answer.status === 429)).toHaveLength(7);
  });

  it('EVM-097 AC7 the first refusal in the hour raises ONE alert and ONE audit event of the device; the next refusals repeat neither; a served snapshot is audited with the NUMBER of entities only', async () => {
    await boot({ SYNC_SNAPSHOTS_PER_HOUR: '2' });
    const s = await scenario(app());
    const { account, phone } = await editor(app());
    const served = await snapshot(phone, s.orderId);
    expect(served.status).toBe(200);
    expect((await snapshot(phone, s.orderId)).status).toBe(200);
    for (let index = 0; index < 4; index += 1) expect((await snapshot(phone, s.orderId)).status).toBe(429);

    const alerts = await sql<
      Record<string, unknown>
    >`select * from platform.security_alert_outbox where alert_code = 'sync_snapshot_rate_exceeded'`.execute(db());
    expect(alerts.rows).toHaveLength(1);
    expect(Object.keys(alerts.rows[0] ?? {}).sort()).toEqual(['alert_code', 'emitted_at', 'id', 'occurred_at', 'trace_id']);
    const events = await sql<Record<string, unknown>>`
      select actor_user_id, outcome, object_type, object_id, entity_count, work_order_count, from_code, to_code
      from audit.events where action = 'sync.work_order_snapshot' order by occurred_at, id`.execute(db());
    const count = (served.body as SnapshotBody).entities.length;
    const served2 = events.rows.filter((row) => row['outcome'] === 'success');
    expect(served2).toHaveLength(2);
    for (const row of served2)
      expect(row).toMatchObject({
        actor_user_id: account.user.id,
        object_type: 'device',
        object_id: phone.deviceId,
        entity_count: count,
        work_order_count: null,
      });
    expect(events.rows.filter((row) => row['outcome'] === 'denied')).toEqual([
      expect.objectContaining({ actor_user_id: account.user.id, object_id: phone.deviceId, entity_count: null }),
    ]);
    // no identifier of an order or a person in the trail of the snapshots
    const everything = JSON.stringify((await sql`select * from audit.events where action = 'sync.work_order_snapshot'`.execute(db())).rows);
    expect(everything).not.toContain(s.orderId);
    expect(everything).not.toContain(s.coordinator.id);
    expect(counter(app(), 'sync_snapshot_requests_total', { result: 'limited' })).toBe(4);
    // the next hour: the device alerts again if it exceeds again
    await nextHour(phone);
    for (let index = 0; index < 3; index += 1) await snapshot(phone, s.orderId);
    const later = await sql<{
      n: number;
    }>`select count(*)::int as n from platform.security_alert_outbox where alert_code = 'sync_snapshot_rate_exceeded'`.execute(db());
    expect(later.rows[0]?.n).toBe(2);
  });
});

describe('entering the scope - the four events of scenario 5 (EVM-097 AC4; ADR-0021 D3)', () => {
  /** A phone that is current: a download done, the cursor in hand. */
  async function currentPhone(): Promise<{ phone: Phone; cursor: string; known: Scenario }> {
    const { phone } = await editor(app());
    const known = await scenario(app());
    const first = await drain(phone);
    return { phone, cursor: first.cursor, known };
  }

  /** The page of changes holds the changed object only; the snapshot holds the whole aggregate with every reference resolved. */
  async function expectEntry(phone: Phone, cursor: string, orderId: string, changed: string[]): Promise<void> {
    const page = await drain(phone, '', cursor);
    expect(keysOf(page.changes).sort()).toEqual(changed.sort());
    const response = await snapshot(phone, orderId);
    expect(response.status).toBe(200);
    const entities = (response.body as SnapshotBody).entities;
    expect(entities.map(keyOf)).toContain(`work_order:${orderId}`);
    expect(unresolved(entities)).toEqual([]);
    for (const entity of entities) expect(assertSyncProjectionStrict({ op: 'upsert', entity })).toEqual({ ok: true });
  }

  it('EVM-097 AC4 a new order for an existing customer and site that the phone does not hold: the page has the order only, the snapshot the customer, the site and the party of the site', async () => {
    await boot();
    // the customer, the site and the party EXIST already but no order of the phone names them
    const party = await insertParty(db(), { kind: 'property_manager', displayName: 'Zarzadca Nowy' });
    const customer = await insertCustomer(db(), { firstName: 'Ewa', lastName: 'Nowa' });
    const site = await insertSite(db(), { managerPartyId: party });
    const coordinator = await createUser(db(), app().clock, { role: 'editor' });
    const { phone, cursor } = await currentPhone();
    const ids = await insertWorkOrders(db(), [
      { number: numberOf(2026, 801), customerId: customer, siteId: site, coordinatorId: coordinator.id },
    ]);
    const orderId = ids.get(numberOf(2026, 801)) ?? '';
    await expectEntry(phone, cursor, orderId, [`work_order:${orderId}`]);
    const entities = ((await snapshot(phone, orderId)).body as SnapshotBody).entities.map(keyOf);
    expect(entities).toEqual(expect.arrayContaining([`customer:${customer}`, `site:${site}`, `party:${party}`, `user:${coordinator.id}`]));
  });

  it('EVM-097 AC4 an order restored after a soft delete (by an Administrator): the page has the order only, the snapshot all its entities', async () => {
    await boot();
    const { phone, cursor } = await currentPhone();
    const deleted = await scenario(app());
    await softDelete(app(), 'orders', deleted.orderId);
    const afterDelete = await drain(phone, '', cursor);
    await restore(app(), 'orders', deleted.orderId);
    await expectEntry(phone, afterDelete.cursor, deleted.orderId, [`work_order:${deleted.orderId}`]);
    const entities = ((await snapshot(phone, deleted.orderId)).body as SnapshotBody).entities;
    expect(entities.filter((entity) => entity['type'] === 'timeline_entry')).toHaveLength(deleted.entryIds.length);
    expect(entities.filter((entity) => entity['type'] === 'scope_item')).toHaveLength(2);
  });

  it.each([
    ['settled', 'completed'],
    ['cancelled', 'on_hold'],
  ] as const)(
    'EVM-097 AC4 an order closed over N days ago and reopened (%s to %s): the page has the order only, the snapshot all its entities',
    async (from, to) => {
      await boot();
      const { phone } = await editor(app());
      const old = await scenario(app(), { status: from, closedAt: ago(app(), 40) });
      const first = await drain(phone);
      expect(keysOf(first.changes)).not.toContain(`work_order:${old.orderId}`);
      await sql`update work_orders.work_orders set status = ${to}, closed_at = null, version = version + 1 where id = ${old.orderId}`.execute(
        db(),
      );
      await expectEntry(phone, first.cursor, old.orderId, [`work_order:${old.orderId}`]);
      const entities = ((await snapshot(phone, old.orderId)).body as SnapshotBody).entities;
      expect(entities.filter((entity) => entity['type'] === 'procedure_stage')).toHaveLength(old.stageIds.length);
    },
  );

  it('EVM-097 AC4 a new party named in a stage: the page has the stage only, the snapshot the party', async () => {
    await boot();
    const { phone } = await editor(app());
    const known = await scenario(app());
    const newcomer = await insertParty(db(), { kind: 'designer', displayName: 'Projektant Nowy', email: 'newcomer@example.invalid' });
    const first = await drain(phone);
    await setWaitingParty(app(), known.stageIds[0] ?? '', newcomer);
    await expectEntry(phone, first.cursor, known.orderId, [`procedure_stage:${known.stageIds[0]}`]);
    const entities = ((await snapshot(phone, known.orderId)).body as SnapshotBody).entities;
    expect(entities.map(keyOf)).toContain(`party:${newcomer}`);
    expect(JSON.stringify(entities)).not.toContain('newcomer@example.invalid');
  });
});

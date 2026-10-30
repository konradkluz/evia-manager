import { assertSyncProjectionStrict } from '@evia/contracts/sync';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { KeyRingCursorCodec } from '../../src/platform/crypto/key-ring-cursor.ts';
import { effectiveScopeRuleVersion } from '../../src/platform/sync/scope-rule.ts';
import type { AppConfig } from '../../src/platform/config/config.ts';
import { createPool, type Database } from '../../src/platform/database/database.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import type { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { APP_CONFIG, DATABASE, LOGGER, METRICS } from '../../src/platform/tokens.ts';
import { FixedClock } from '../support/clock.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { enrolledAccount } from '../support/login-flows.ts';
import { MOBILE, newPhone, setDeviceState, signedInPhone, type Phone } from '../support/mobile-flows.ts';
import { auditActions } from '../support/invitation-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { addTotp, totpAccount, type TotpAccount } from '../support/totp-flows.ts';
import { insertWorkOrders, numberOf, type WorkOrderSpec } from '../support/work-order-fixtures.ts';

const PATH = '/api/v1/sync/changes';
const OPERATION = 'getSyncChanges';
const DAY = 24 * 3_600_000;

let current: IdentityApp;
const statements: string[] = [];
afterEach(async () => {
  await current.close();
});

async function boot(env: Record<string, string | undefined> = {}): Promise<IdentityApp> {
  statements.length = 0;
  current = await createIdentityApp({
    env: { SYNC_FULL_DOWNLOADS_PER_DAY: '50', ...env },
    configure: (builder) =>
      builder.overrideProvider(DATABASE).useFactory({
        inject: [APP_CONFIG, LOGGER],
        factory: (config: AppConfig, logger: ReturnType<typeof createLogger>) =>
          new Kysely<Database>({
            dialect: new PostgresDialect({ pool: createPool({ url: config.databaseUrl, logger }) }),
            log: (event) => {
              if (event.level === 'query') statements.push(event.query.sql);
            },
          }),
      }),
  });
  return current;
}

const admin = () => current.database.admin;
const problemOf = (response: { body: unknown }): string => (response.body as { code: string }).code;
const noStore = (response: { headers: Record<string, unknown> }): void => {
  expect(response.headers['cache-control']).toBe('no-store');
};

interface Body {
  result: string;
  phase?: string;
  changes?: Array<Record<string, unknown>>;
  cursor?: string;
  hasMore?: boolean;
  reason?: string;
  serverTime?: string;
}

function pull(phone: Phone, query = '') {
  return phone.get(`${PATH}${query === '' ? '' : `?${query}`}`, phone.authorised());
}

/** Pulls page after page (no cursor first = a full download) until `hasMore` is false; every page must pass the strict projection check. */
async function drain(
  phone: Phone,
  query = '',
  from?: string,
): Promise<{ changes: Array<Record<string, unknown>>; pages: Body[]; cursor: string }> {
  const changes: Array<Record<string, unknown>> = [];
  const pages: Body[] = [];
  let cursor = from;
  for (let guard = 0; guard < 60; guard += 1) {
    const response = await pull(phone, [cursor === undefined ? '' : `cursor=${cursor}`, query].filter(Boolean).join('&'));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    noStore(response);
    const body = response.body as Body;
    expect(body.result).toBe('changes');
    for (const change of body.changes ?? []) expect(assertSyncProjectionStrict(change), JSON.stringify(change)).toEqual({ ok: true });
    pages.push(body);
    changes.push(...(body.changes ?? []));
    cursor = body.cursor;
    if (body.hasMore !== true) return { changes, pages, cursor: cursor ?? '' };
  }
  throw new Error('the pull did not end');
}

const idsOf = (changes: Array<Record<string, unknown>>, type: string): string[] =>
  changes.flatMap((change) => {
    if (change['op'] === 'delete') return change['type'] === type ? [`delete:${String(change['id'])}`] : [];
    const entity = change['entity'] as Record<string, unknown>;
    return entity['type'] === type ? [String(entity['id'])] : [];
  });

async function editor(): Promise<{ account: TotpAccount; phone: Phone }> {
  const account = await totpAccount(current, { role: 'editor' });
  return { account, phone: await signedInPhone(current, account) };
}

async function order(spec: Partial<WorkOrderSpec> & { number: string }): Promise<string> {
  const ids = await insertWorkOrders(admin(), [spec]);
  return ids.get(spec.number) ?? '';
}

const ago = (days: number, extraMs = 0): Date => new Date(current.clock.now().getTime() - days * DAY - extraMs);

async function markSynced(deviceId: string, at: Date, reason: string | null = null): Promise<void> {
  await sql`insert into sync.device_sync_state (device_id, last_full_sync_at, resync_requested_reason, updated_at)
    values (${deviceId}, ${at}, ${reason}, ${at})
    on conflict (device_id) do update set last_full_sync_at = excluded.last_full_sync_at, resync_requested_reason = excluded.resync_requested_reason`.execute(
    admin(),
  );
}

const syncRing = () => current.app.get<AppConfig>(APP_CONFIG, { strict: false }).sync.cursorKeys;
const forge = (claims: object, at: Date = current.clock.now(), keys = syncRing()): string =>
  new KeyRingCursorCodec(keys, new FixedClock(at)).seal(OPERATION, claims);
/** The version of the rule of scope the server in the test derives (EVM-097 AC6: from N, the counter of the operator and the set of types). */
const scopeVersion = (): number => {
  const { sync } = current.app.get<AppConfig>(APP_CONFIG, { strict: false });
  return effectiveScopeRuleVersion({ configured: sync.scopeRuleVersion, closedDays: sync.closedOrdersInScopeDays });
};
const changesClaims = (account: TotpAccount, phone: Phone, extra: Record<string, unknown> = {}) => ({
  ph: 'changes',
  tx: '1',
  sq: '0',
  u: account.user.id,
  d: phone.deviceId,
  sv: scopeVersion(),
  r: 'editor',
  ...extra,
});
const counter = (name: string, labels: Record<string, string> = {}): number =>
  current.app
    .get<MetricsRegistry>(METRICS, { strict: false })
    .snapshot()
    .filter((sample) => sample.name === name && Object.entries(labels).every(([key, value]) => sample.labels[key] === value))
    .reduce((sum, sample) => sum + sample.value, 0);

describe('the snapshot: the first pull (EVM-096 AC2; SR-SYNC-04, SR-AUTHZ-03, CWE-213)', () => {
  it('EVM-096 AC2 an Editor gets the open orders and the closed ones within N days with the current customer and site; nothing outside the scope or the projection', async () => {
    await boot();
    const { phone } = await editor();
    const customer = await insertCustomer(admin(), {
      kind: 'person',
      firstName: 'Jan',
      lastName: 'Testowy',
      phone: '+48600000123',
      email: 'sentinel-mail@example.test',
      notes: 'SENTINEL-CUSTOMER-NOTE',
      city: 'SentinelCity',
    });
    await sql`update customers.customers set street = 'SENTINEL-STREET' where id = ${customer}`.execute(admin());
    const company = await insertCustomer(admin(), { kind: 'company', companyName: 'Firma Wartownik', taxId: '1234567890' });
    const site = await insertSite(admin(), { meteringPointId: 'SENTINEL-PPE-0001', notes: 'notatka lokalizacji', connectionPowerKw: 11 });
    const unused = await insertCustomer(admin(), { firstName: 'Nikt', lastName: 'Nieuzywany' });
    const unusedSite = await insertSite(admin(), { street: 'ul. Nieuzywana' });
    const open = await order({ number: numberOf(2026, 1), customerId: customer, siteId: site });
    const recent = await order({ number: numberOf(2026, 2), status: 'settled', closedAt: ago(29), customerId: company, siteId: site });
    const old = await order({ number: numberOf(2026, 3), status: 'settled', closedAt: ago(31) });
    const deleted = await order({ number: numberOf(2026, 4), deletedAt: ago(1) });
    const bare = await order({ number: numberOf(2026, 5) });
    await sql`update work_orders.work_orders set status_reason = 'SENTINEL-REASON', description = 'Opis zlecenia' where id = ${open}`.execute(
      admin(),
    );

    const result = await drain(phone);
    expect(idsOf(result.changes, 'work_order').sort()).toEqual([open, recent, bare].sort());
    expect(idsOf(result.changes, 'work_order')).not.toContain(old);
    expect(idsOf(result.changes, 'work_order')).not.toContain(deleted);
    expect([...new Set(idsOf(result.changes, 'customer'))].sort()).toEqual([customer, company].sort());
    expect(idsOf(result.changes, 'customer')).not.toContain(unused);
    expect([...new Set(idsOf(result.changes, 'site'))]).toEqual([site]);
    expect(idsOf(result.changes, 'site')).not.toContain(unusedSite);
    const raw = JSON.stringify(result.pages);
    for (const sentinel of [
      'sentinel-mail',
      'SENTINEL-CUSTOMER-NOTE',
      'SentinelCity',
      'SENTINEL-STREET',
      '1234567890',
      'SENTINEL-PPE-0001',
      'SENTINEL-REASON',
      'search_text',
    ])
      expect(raw, sentinel).not.toContain(sentinel);
    const entity = (id: string) =>
      result.changes.map((change) => change['entity'] as Record<string, unknown>).find((item) => item['id'] === id);
    expect(entity(open)).toMatchObject({
      type: 'work_order',
      number: numberOf(2026, 1),
      customerId: customer,
      siteId: site,
      description: 'Opis zlecenia',
      closedAt: null,
    });
    expect(entity(customer)).toMatchObject({ kind: 'person', displayName: 'Jan Testowy', phone: '+48600000123' });
    expect(entity(site)).toMatchObject({ connectionPowerKw: 11, notes: 'notatka lokalizacji' });
    // the last page of the snapshot hands over to the phase of changes
    expect(result.pages.at(-2)).toMatchObject({ phase: 'changes', hasMore: true });
    expect(result.pages.at(-1)).toMatchObject({ phase: 'changes', hasMore: false, changes: [] });
  });

  it('EVM-096 AC2 the snapshot is paged by the orders: every order exactly once, a customer and a site with the page of their orders, the phase changes at the end', async () => {
    await boot();
    const { phone } = await editor();
    const customer = await insertCustomer(admin());
    const site = await insertSite(admin());
    const created: string[] = [];
    for (let index = 1; index <= 7; index += 1)
      created.push(await order({ number: numberOf(2026, index), customerId: customer, siteId: site }));
    const result = await drain(phone, 'limit=3');
    const orders = idsOf(result.changes, 'work_order');
    expect([...orders].sort()).toEqual([...created].sort());
    expect(new Set(orders).size).toBe(7);
    expect(result.pages.map((page) => page.phase)).toEqual(['snapshot', 'snapshot', 'changes', 'changes']);
    // the orders come in the order of the identifier, so a resumed snapshot continues after the last one
    expect(orders).toEqual([...created].sort());
    for (const page of result.pages.slice(0, -1)) expect(idsOf(page.changes ?? [], 'customer')).toEqual([customer]);
    // after the snapshot: the phase of changes is empty (the horizon was taken before the snapshot)
    const next = await drain(phone, '', result.cursor);
    expect(next.changes).toEqual([]);
    expect(next.pages).toHaveLength(1);
  });

  it('EVM-096 AC2 the rule of N days is on the server: a closing exactly N days ago is in scope, a second earlier is not; an open order is always in', async () => {
    await boot();
    const { phone } = await editor();
    const boundary = await order({ number: numberOf(2026, 1), status: 'settled', closedAt: ago(30) });
    const before = await order({ number: numberOf(2026, 2), status: 'cancelled', closedAt: ago(30, 1000) });
    const open = await order({ number: numberOf(2026, 3), status: 'on_hold' });
    const orders = idsOf((await drain(phone)).changes, 'work_order');
    expect(orders.sort()).toEqual([boundary, open].sort());
    expect(orders).not.toContain(before);
  });

  it('EVM-096 AC2 the pages are read in batches: the number of statements of a page does not depend on the number of orders', async () => {
    await boot();
    const { phone } = await editor();
    const customer = await insertCustomer(admin());
    const site = await insertSite(admin());
    for (let index = 1; index <= 40; index += 1) await order({ number: numberOf(2026, index), customerId: customer, siteId: site });
    const measure = async (query: string): Promise<number> => {
      statements.length = 0;
      expect((await pull(phone, query)).status).toBe(200);
      return statements.filter((text) => !/identity\./.test(text)).length;
    };
    // the first call of a device also creates its state; the third full download of a day also raises an alert (one more statement, once)
    for (let warm = 0; warm < 3; warm += 1) await measure('limit=1');
    const small = await measure('limit=2');
    const large = await measure('limit=30');
    expect(large).toBe(small);
    // the phase of changes too: 2 or 30 rows named by the log, the same statements
    const done = await drain(phone);
    await sql`update work_orders.work_orders set title = 'zmiana', version = version + 1`.execute(admin());
    const changed = async (limit: number): Promise<number> => {
      statements.length = 0;
      const response = await pull(phone, `cursor=${done.cursor}&limit=${limit}`);
      expect(response.status).toBe(200);
      expect((response.body as Body).changes).toHaveLength(Math.min(limit, 40));
      return statements.filter((text) => !/identity./.test(text)).length;
    };
    expect(await changed(30)).toBe(await changed(2));
  });
});

describe('the phase of changes (EVM-096 AC3, AC4; ADR-0021 D3, D4)', () => {
  it('EVM-096 AC3 after the snapshot only the later changes come, each entity at its current state, an update without a change gives nothing', async () => {
    await boot();
    const { phone } = await editor();
    const customer = await insertCustomer(admin());
    const site = await insertSite(admin());
    const first = await order({ number: numberOf(2026, 1), customerId: customer, siteId: site });
    const second = await order({ number: numberOf(2026, 2) });
    const snapshot = await drain(phone);
    await sql`update work_orders.work_orders set title = 'Nowy tytul', version = version + 1 where id = ${first}`.execute(admin());
    await sql`update work_orders.work_orders set title = 'Jeszcze nowszy', version = version + 1 where id = ${first}`.execute(admin());
    await sql`update work_orders.work_orders set title = title where id = ${second}`.execute(admin());
    const changes = await drain(phone, '', snapshot.cursor);
    expect(changes.changes).toHaveLength(1);
    expect(changes.changes[0]).toMatchObject({
      op: 'upsert',
      entity: { type: 'work_order', id: first, title: 'Jeszcze nowszy', version: 3 },
    });
    expect((await drain(phone, '', changes.cursor)).changes).toEqual([]);
    // the customer used by an order in scope comes when it changes; a site too
    await sql`update customers.customers set last_name = 'Zmieniony', version = version + 1 where id = ${customer}`.execute(admin());
    await sql`update sites.sites set city = 'Gdynia', version = version + 1 where id = ${site}`.execute(admin());
    const later = await drain(phone, '', changes.cursor);
    expect(later.changes.map((change) => (change['entity'] as Record<string, unknown>)['type']).sort()).toEqual(['customer', 'site']);
    expect(JSON.stringify(later.changes)).toContain('Zmieniony');
  });

  it('EVM-096 AC4 interleaved transactions: a transaction that commits later but began earlier is not skipped; with limit 1 nothing is lost and nothing is doubled (scenario 6)', async () => {
    await boot();
    const { phone } = await editor();
    const a = await order({ number: numberOf(2026, 1) });
    const b = await order({ number: numberOf(2026, 2) });
    const c = await order({ number: numberOf(2026, 3) });
    const start = await drain(phone);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let opened: () => void = () => undefined;
    const began = new Promise<void>((resolve) => {
      opened = resolve;
    });
    // transaction 1 takes its id first and commits last
    const slow = admin()
      .transaction()
      .execute(async (trx) => {
        await sql`update work_orders.work_orders set title = 'wolna', version = version + 1 where id = ${a}`.execute(trx);
        await sql`update work_orders.work_orders set title = 'wolna', version = version + 1 where id = ${b}`.execute(trx);
        opened();
        await gate;
      });
    await began;
    // transaction 2 has a LATER id, and commits first
    await sql`update work_orders.work_orders set title = 'szybka', version = version + 1 where id = ${c}`.execute(admin());
    const early = await drain(phone, 'limit=1', start.cursor);
    expect(early.changes).toEqual([]); // the horizon is held by the open transaction: the later commit is not shown before the earlier one
    release();
    await slow;
    const late = await drain(phone, 'limit=1', early.cursor);
    const seen = idsOf(late.changes, 'work_order');
    expect(seen.sort()).toEqual([a, b, c].sort());
    expect(new Set(seen).size).toBe(3);
    expect(late.pages.length).toBeGreaterThanOrEqual(3);
  });

  it('EVM-096 AC4 several changes of one transaction, a soft delete among them, come through limit 1 exactly once each', async () => {
    await boot();
    const { phone } = await editor();
    const keep = await order({ number: numberOf(2026, 1) });
    const drop = await order({ number: numberOf(2026, 2) });
    const start = await drain(phone);
    await admin()
      .transaction()
      .execute(async (trx) => {
        await sql`update work_orders.work_orders set title = 'nowy', version = version + 1 where id = ${keep}`.execute(trx);
        await sql`update work_orders.work_orders set deleted_at = now(), version = version + 1 where id = ${drop}`.execute(trx);
        await sql`update work_orders.work_orders set description = 'opis', version = version + 1 where id = ${keep}`.execute(trx);
      });
    const result = await drain(phone, 'limit=1', start.cursor);
    expect(result.changes).toHaveLength(2);
    expect(idsOf(result.changes, 'work_order').sort()).toEqual([keep, `delete:${drop}`].sort());
    expect(result.changes.find((change) => change['op'] === 'delete')).toEqual({ op: 'delete', type: 'work_order', id: drop });
  });

  it('EVM-096 AC7 the page closes before the byte budget and the cursor stays on the last included row: a long page is split, nothing is lost', async () => {
    await boot({ SYNC_PAGE_MAX_BYTES: '12000' });
    const { phone } = await editor();
    const start = await drain(phone);
    const ids: string[] = [];
    for (let index = 1; index <= 12; index += 1) ids.push(await order({ number: numberOf(2026, index) }));
    await sql`update work_orders.work_orders set description = ${'x'.repeat(1900)}, version = version + 1`.execute(admin());
    const result = await drain(phone, 'limit=500', start.cursor);
    expect(result.pages.length).toBeGreaterThan(2);
    for (const page of result.pages) expect(Buffer.byteLength(JSON.stringify(page.changes), 'utf8')).toBeLessThan(12_000);
    expect(idsOf(result.changes, 'work_order').sort()).toEqual([...ids].sort());
  });

  it('EVM-096 AC7 the same budget closes a page of the snapshot; a limit above 500 is lowered to 500, a bad limit is a validation error, with no data', async () => {
    await boot({ SYNC_PAGE_MAX_BYTES: '12000' });
    const { phone } = await editor();
    for (let index = 1; index <= 8; index += 1) await order({ number: numberOf(2026, index) });
    await sql`update work_orders.work_orders set description = ${'x'.repeat(1900)}, version = version + 1`.execute(admin());
    const result = await drain(phone, 'limit=500');
    expect(result.pages.length).toBeGreaterThan(2);
    expect(idsOf(result.changes, 'work_order')).toHaveLength(8);
    for (const bad of [
      'limit=0',
      'limit=-1',
      'limit=1.5',
      'limit=abc',
      'limit=',
      'limit=1&limit=2',
      'unknown=1',
      'pendingItems=-1',
      'pendingItems=1000001',
    ]) {
      const response = await pull(phone, bad);
      expect(response.status, bad).toBe(400);
      noStore(response);
      if (!bad.includes('&')) expect(problemOf(response)).toBe(bad === 'unknown=1' ? 'unknown_parameter' : 'validation_failed');
      expect(JSON.stringify(response.body)).not.toContain('"changes"');
    }
    expect((await pull(phone, 'limit=100000&pendingItems=5')).status).toBe(200);
  });
});

describe('the markers of deletion (EVM-096 AC1, AC5; ADR-0021 D1; CWE-200)', () => {
  it('EVM-096 AC5 a delete marker is sent for an object that was in scope; deleting one that never was in scope (closed over N days ago) leaves no trace', async () => {
    await boot();
    const { phone } = await editor();
    const inScope = await order({ number: numberOf(2026, 1) });
    const closed = await order({ number: numberOf(2026, 2), status: 'settled', closedAt: ago(40) });
    const purged = await order({ number: numberOf(2026, 3) });
    const start = await drain(phone);
    await sql`update work_orders.work_orders set deleted_at = now(), version = version + 1 where id in (${inScope}, ${closed})`.execute(
      admin(),
    );
    await sql`delete from work_orders.work_order_assignments where work_order_id = ${purged}`.execute(admin());
    await sql`delete from work_orders.work_orders where id = ${purged}`.execute(admin());
    const result = await drain(phone, '', start.cursor);
    expect(result.changes.sort((x, y) => String(x['id']).localeCompare(String(y['id'])))).toEqual(
      [
        { op: 'delete', type: 'work_order', id: inScope },
        { op: 'delete', type: 'work_order', id: purged },
      ].sort((x, y) => x.id.localeCompare(y.id)),
    );
    expect(JSON.stringify(result.changes)).not.toContain(closed);
  });

  it('EVM-096 AC5 a customer or a site: deletion of one used by an order in scope gives a marker, of one that no order of the device uses gives nothing, a purge gives a marker with type and id only', async () => {
    await boot();
    const { phone } = await editor();
    const usedCustomer = await insertCustomer(admin());
    const freeCustomer = await insertCustomer(admin());
    const usedSite = await insertSite(admin());
    const freeSite = await insertSite(admin());
    const purgedCustomer = await insertCustomer(admin());
    await order({ number: numberOf(2026, 1), customerId: usedCustomer, siteId: usedSite });
    const start = await drain(phone);
    await sql`update customers.customers set deleted_at = now(), version = version + 1 where id in (${usedCustomer}, ${freeCustomer})`.execute(
      admin(),
    );
    await sql`update sites.sites set deleted_at = now(), version = version + 1 where id in (${usedSite}, ${freeSite})`.execute(admin());
    await sql`delete from customers.customers where id = ${purgedCustomer}`.execute(admin());
    const result = await drain(phone, '', start.cursor);
    expect(idsOf(result.changes, 'customer').sort()).toEqual([`delete:${usedCustomer}`, `delete:${purgedCustomer}`].sort());
    expect(idsOf(result.changes, 'site')).toEqual([`delete:${usedSite}`]);
    for (const change of result.changes) expect(Object.keys(change).sort()).toEqual(['id', 'op', 'type']);
  });

  it('EVM-096 AC1 anonymisation of a customer reaches the phone as an upsert with the values after it; the restoration of a deleted order is an upsert', async () => {
    await boot();
    const { account, phone } = await editor();
    const customer = await insertCustomer(admin(), { firstName: 'Anna', lastName: 'Prawdziwa', phone: '+48601000111' });
    const mine = await order({ number: numberOf(2026, 1), customerId: customer });
    const start = await drain(phone);
    await sql`update customers.customers set first_name = 'Klient', last_name = 'zanonimizowany', phone = '+48000000000', email = null, street = null, building_number = null,
      postal_code = null, city = null, notes = null, version = version + 1, anonymized_at = now(), anonymized_by = ${account.user.id} where id = ${customer}`.execute(
      admin(),
    );
    const anonymised = await drain(phone, '', start.cursor);
    expect(JSON.stringify(anonymised.changes)).toContain('Klient zanonimizowany');
    expect(JSON.stringify(anonymised.changes)).not.toContain('Prawdziwa');
    await sql`update work_orders.work_orders set deleted_at = now(), version = version + 1 where id = ${mine}`.execute(admin());
    const first = await drain(phone, '', anonymised.cursor);
    expect(first.changes).toContainEqual({ op: 'delete', type: 'work_order', id: mine });
    await sql`update work_orders.work_orders set deleted_at = null, version = version + 1 where id = ${mine}`.execute(admin());
    const second = await drain(phone, '', first.cursor);
    expect(idsOf(second.changes, 'work_order')).toEqual([mine]);
  });
});

describe('who may pull (EVM-096 AC5; SR-AUTHZ-06, SR-SYNC-01, ASVS V8.2)', () => {
  it('EVM-096 AC5 Administrator and Editor: 200 no-store; Read-only: 403; no token, a cookie of the panel, a foreign token: 401 — with no data', async () => {
    await boot();
    await order({ number: numberOf(2026, 1) });
    const enrolled = await enrolledAccount(current, { role: 'administrator' });
    const secret = await addTotp(current, enrolled);
    const adminPhone = await signedInPhone(current, { ...enrolled, secret } as unknown as TotpAccount);
    const { phone: editorPhone } = await editor();
    const readOnly = await totpAccount(current, { role: 'editor' });
    const readOnlyPhone = await signedInPhone(current, readOnly);
    await sql`update identity.users set role = 'read_only' where id = ${readOnly.user.id}`.execute(admin());
    for (const phone of [adminPhone, editorPhone]) {
      const response = await pull(phone);
      expect(response.status).toBe(200);
      noStore(response);
      expect(response.headers['set-cookie']).toBeUndefined();
    }
    const denied = await pull(readOnlyPhone);
    expect(denied.status).toBe(403);
    noStore(denied);
    expect(problemOf(denied)).toBe('forbidden');
    expect(JSON.stringify(denied.body)).not.toContain('changes');
    const anonymous = newPhone(current);
    const credentials: Array<Record<string, string>> = [
      {},
      { Authorization: `Bearer evia_at_${'A'.repeat(43)}` },
      { Authorization: 'Basic abc' },
    ];
    for (const headers of credentials) {
      const response = await anonymous.get(PATH, headers);
      expect(response.status).toBe(401);
      noStore(response);
    }
    // the cookie of a session of the panel is not a credential of this channel
    const panel = enrolled.panel;
    const viaCookie = await panel.get(PATH);
    expect(viaCookie.status).toBe(401);
    noStore(viaCookie);
  });

  it('EVM-096 AC5 a revoked session is 401 session_revoked, a device to wipe is 401 device_wipe_required (it wins), a deactivated user is 401 — and a device revoked between two pages gets no second page', async () => {
    await boot();
    for (let index = 1; index <= 5; index += 1) await order({ number: numberOf(2026, index) });
    const { account, phone } = await editor();
    const midway = await pull(phone, 'limit=2');
    expect((midway.body as Body).hasMore).toBe(true);
    const cursor = (midway.body as Body).cursor ?? '';
    expect((await phone.post(MOBILE.logout, undefined, phone.authorised())).status).toBe(204);
    const revoked = await pull(phone, `cursor=${cursor}&limit=2`);
    expect(revoked.status).toBe(401);
    noStore(revoked);
    expect(problemOf(revoked)).toBe('session_revoked');
    expect(JSON.stringify(revoked.body)).not.toContain('changes');

    const wiped = await editor();
    await setDeviceState(current, wiped.phone.deviceId ?? '', 'wipe_required');
    const wipe = await pull(wiped.phone);
    expect(wipe.status).toBe(401);
    expect(problemOf(wipe)).toBe('device_wipe_required');
    expect(account.user.id).not.toBe(wiped.account.user.id);

    const gone = await editor();
    await sql`update identity.users set status = 'deactivated' where id = ${gone.account.user.id}`.execute(admin());
    expect((await pull(gone.phone)).status).toBe(401);
  });

  it('EVM-096 AC5 an old app is refused with 426 before any data; the user and the device are never read from the request', async () => {
    await boot();
    const { phone } = await editor();
    const old = await phone.get(PATH, { ...phone.authorised(), 'X-Client-Version': '0.0.1' });
    expect(old.status).toBe(426);
    const spoof = await pull(phone, `userId=${'0'.repeat(8)}-0000-7000-8000-000000000000`);
    expect(spoof.status).toBe(400);
  });
});

describe('the cursor: every way it can be unusable (EVM-096 AC3, AC6; ADR-0021 D2, D6; SR-SYNC-07, CWE-639, CWE-345)', () => {
  it('EVM-096 AC3 AC6 table of cases: the answer, the reason, the metric — and a resync carries no data', async () => {
    await boot();
    const { account, phone } = await editor();
    const other = await editor();
    await markSynced(phone.deviceId ?? '', current.clock.now());
    const good = (await pull(phone, 'limit=1')).body as Body; // a snapshot cursor of this device
    const synced = forge(changesClaims(account, phone));
    expect((await pull(phone, `cursor=${synced}`)).status).toBe(200);

    const raw = Buffer.from(synced, 'base64url');
    raw[raw.length - 20] = (raw[raw.length - 20] ?? 0) ^ 1;
    const foreignKey = [{ id: 'zz', key: Buffer.alloc(32, 7) }];
    const cases: Array<{ name: string; cursor: string; status: number; code?: string; reason?: string; rejected?: string }> = [
      {
        name: 'modified (known key, bad tag)',
        cursor: raw.toString('base64url'),
        status: 400,
        code: 'invalid_cursor',
        rejected: 'tampered',
      },
      {
        name: 'of another user',
        cursor: forge(changesClaims(other.account, phone)),
        status: 400,
        code: 'invalid_cursor',
        rejected: 'identity_mismatch',
      },
      {
        name: 'of another device',
        cursor: forge(changesClaims(account, other.phone)),
        status: 400,
        code: 'invalid_cursor',
        rejected: 'identity_mismatch',
      },
      {
        name: 'of another key outside the ring (rotation)',
        cursor: forge(changesClaims(account, phone), current.clock.now(), foreignKey),
        status: 200,
        reason: 'cursor_invalid',
      },
      { name: 'expired', cursor: forge(changesClaims(account, phone), ago(91)), status: 200, reason: 'cursor_expired' },
      {
        name: 'another version of the rule of scope',
        cursor: forge(changesClaims(account, phone, { sv: 2 })),
        status: 200,
        reason: 'scope_changed',
      },
      { name: 'claims of no known shape', cursor: forge({ nonsense: true }), status: 200, reason: 'cursor_invalid' },
      { name: 'not ours at all', cursor: 'A'.repeat(40), status: 200, reason: 'cursor_invalid' },
      {
        name: 'of the snapshot that no download of this device started',
        cursor: forge({
          ph: 'snapshot',
          tx: '1',
          after: null,
          dl: '0193a000-0000-7000-8000-000000000001',
          u: account.user.id,
          d: phone.deviceId,
          sv: scopeVersion(),
          r: 'editor',
        }),
        status: 200,
        reason: 'cursor_invalid',
      },
    ];
    for (const item of cases) {
      const before = {
        rejected: counter('sync_cursor_rejected_total', item.rejected === undefined ? {} : { reason: item.rejected }),
        resync: counter('sync_resync_required_total', item.reason === undefined ? {} : { reason: item.reason }),
      };
      const response = await pull(phone, `cursor=${item.cursor}`);
      expect(response.status, item.name).toBe(item.status);
      noStore(response);
      if (item.code !== undefined) {
        expect(problemOf(response), item.name).toBe(item.code);
        expect(counter('sync_cursor_rejected_total', { reason: item.rejected ?? '' }), item.name).toBe(before.rejected + 1);
        expect(JSON.stringify(response.body)).not.toContain(item.cursor);
      } else {
        expect(Object.keys(response.body as object).sort(), item.name).toEqual(['reason', 'result', 'serverTime']);
        expect(response.body).toMatchObject({ result: 'resync_required', reason: item.reason });
        expect(counter('sync_resync_required_total', { reason: item.reason ?? '' }), item.name).toBe(before.resync + 1);
      }
    }
    expect(good.hasMore).toBeDefined();
    // a cursor too short, too long or of other characters is a validation error, not a resync
    for (const cursor of ['short', 'A'.repeat(1025), `${'A'.repeat(20)}!`]) {
      const response = await pull(phone, `cursor=${encodeURIComponent(cursor)}`);
      expect(response.status, cursor.slice(0, 6)).toBe(400);
      expect(problemOf(response)).toBe('validation_failed');
    }
  });

  it('EVM-096 AC6 a periodic control (7 days since the last full download) and a flag of the device give resync_required with the reason, in the phase of changes only', async () => {
    await boot();
    const { account, phone } = await editor();
    const cursor = forge(changesClaims(account, phone));
    await markSynced(phone.deviceId ?? '', ago(7, -60_000));
    expect((await pull(phone, `cursor=${cursor}`)).status).toBe(200);
    await markSynced(phone.deviceId ?? '', ago(7));
    expect((await pull(phone, `cursor=${cursor}`)).body).toMatchObject({ result: 'resync_required', reason: 'periodic' });
    await markSynced(phone.deviceId ?? '', current.clock.now(), 'access_changed');
    expect((await pull(phone, `cursor=${cursor}`)).body).toMatchObject({ result: 'resync_required', reason: 'access_changed' });
    // a device that never finished a snapshot has nothing to continue from
    await sql`delete from sync.device_sync_state where device_id = ${phone.deviceId ?? ''}`.execute(admin());
    expect((await pull(phone, `cursor=${cursor}`)).body).toMatchObject({ result: 'resync_required', reason: 'periodic' });
    // the resync: a full download starts again, finishes, and the flag is spent
    await markSynced(phone.deviceId ?? '', current.clock.now(), 'scope_changed');
    const again = await drain(phone);
    expect(again.pages.at(-1)).toMatchObject({ phase: 'changes' });
    const state = await sql<{
      resync_requested_reason: string | null;
    }>`select resync_requested_reason from sync.device_sync_state where device_id = ${phone.deviceId ?? ''}`.execute(admin());
    expect(state.rows[0]?.resync_requested_reason).toBeNull();
    const downloads = await sql<{
      reason: string;
    }>`select reason from sync.full_downloads where device_id = ${phone.deviceId ?? ''}`.execute(admin());
    expect(downloads.rows.map((row) => row.reason)).toEqual(['scope_changed']);
  });

  it('EVM-096 AC3 a valid cursor does not skip the policy: an order deleted after the cursor was issued is not shown again', async () => {
    await boot();
    const { phone } = await editor();
    const doomed = await order({ number: numberOf(2026, 1) });
    const start = await drain(phone);
    await sql`update work_orders.work_orders set title = 'tytul', version = version + 1 where id = ${doomed}`.execute(admin());
    await sql`update work_orders.work_orders set deleted_at = now(), version = version + 1 where id = ${doomed}`.execute(admin());
    const result = await drain(phone, '', start.cursor);
    expect(result.changes).toEqual([{ op: 'delete', type: 'work_order', id: doomed }]);
  });
});

describe('the mass read: full downloads (EVM-096 AC8; AB-08, SR-API-02, SR-LOG-03)', () => {
  it('EVM-096 AC8 the 4th full download in a rolling day is 429 with Retry-After; ordinary pulls with a cursor are not counted; it is audited, and the end of each download carries the counts by type in the trail; after the day it works again', async () => {
    await boot({ SYNC_FULL_DOWNLOADS_PER_DAY: '3' });
    const { phone } = await editor();
    const customer = await insertCustomer(admin());
    const site = await insertSite(admin());
    await order({ number: numberOf(2026, 1), customerId: customer, siteId: site });
    await order({ number: numberOf(2026, 2) });
    let cursor = '';
    for (let round = 0; round < 3; round += 1) {
      const result = await drain(phone);
      cursor = result.cursor;
      current.clock.advance(60_000);
    }
    for (let index = 0; index < 5; index += 1) expect((await pull(phone, `cursor=${cursor}`)).status).toBe(200);
    const limited = await pull(phone);
    expect(limited.status).toBe(429);
    noStore(limited);
    expect(problemOf(limited)).toBe('rate_limited');
    const retry = Number(limited.headers['retry-after']);
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(86_400);
    expect(JSON.stringify(limited.body)).not.toContain('changes');
    expect(counter('sync_full_downloads_limited_total')).toBe(1);
    expect(counter('sync_full_downloads_total')).toBe(3);

    const audit = (await auditActions(current)).filter((event) => event.action === 'sync.full_download');
    expect(audit.map((event) => event.outcome)).toEqual(['success', 'success', 'success', 'denied']);
    expect(audit.every((event) => event.object_id === phone.deviceId)).toBe(true);
    const trail = await sql<{ work_order_count: number; customer_count: number; site_count: number; object_id: string }>`
      select work_order_count, customer_count, site_count, object_id from audit.events where action = 'sync.full_download_completed' order by occurred_at, id`.execute(
      admin(),
    );
    expect(trail.rows).toEqual(
      Array.from({ length: 3 }, () => ({ work_order_count: 2, customer_count: 1, site_count: 1, object_id: phone.deviceId })),
    );
    const counts = await sql<{ work_order_count: number; customer_count: number; site_count: number; reason: string }>`
      select work_order_count, customer_count, site_count, reason from sync.full_downloads where device_id = ${phone.deviceId ?? ''} order by started_at`.execute(
      admin(),
    );
    expect(counts.rows).toEqual([
      { work_order_count: 2, customer_count: 1, site_count: 1, reason: 'initial' },
      { work_order_count: 2, customer_count: 1, site_count: 1, reason: 'requested' },
      { work_order_count: 2, customer_count: 1, site_count: 1, reason: 'requested' },
    ]);
    // the rolling window: the oldest download older than a day frees one place
    await sql`update sync.full_downloads set started_at = ${ago(1, 1000)} where id = (select id from sync.full_downloads order by started_at limit 1)`.execute(
      admin(),
    );
    expect((await pull(phone)).status).toBe(200);
    expect((await pull(phone)).status).toBe(429);
  });

  it('EVM-096 AC8 two full downloads at the same moment with one place left: exactly one is served (the check and the count are one step under a lock)', async () => {
    await boot({ SYNC_FULL_DOWNLOADS_PER_DAY: '3' });
    const { phone } = await editor();
    await order({ number: numberOf(2026, 1) });
    await markSynced(phone.deviceId ?? '', current.clock.now());
    for (let index = 0; index < 2; index += 1) {
      await sql`insert into sync.full_downloads (device_id, user_id, reason, started_at) values (${phone.deviceId ?? ''}, (select user_id from identity.devices where id = ${phone.deviceId ?? ''}), 'requested', ${current.clock.now()})`.execute(
        admin(),
      );
    }
    const [one, two] = await Promise.all([pull(phone), pull(phone)]);
    expect([one.status, two.status].sort()).toEqual([200, 429]);
  });

  it('EVM-096 AC8 a download is counted once, not per page; the continuation of a snapshot does not start another', async () => {
    await boot({ SYNC_FULL_DOWNLOADS_PER_DAY: '3' });
    const { phone } = await editor();
    for (let index = 1; index <= 6; index += 1) await order({ number: numberOf(2026, index) });
    const result = await drain(phone, 'limit=1');
    expect(result.pages.length).toBeGreaterThanOrEqual(6);
    const rows = await sql<{ count: string }>`select count(*)::text as count from sync.full_downloads`.execute(admin());
    expect(rows.rows[0]?.count).toBe('1');
    expect((await auditActions(current)).filter((event) => event.action === 'sync.full_download')).toHaveLength(1);
  });
});

describe('the cursor of a snapshot is tied to the life of its download (EVM-096 AC8; AB-08, CWE-799)', () => {
  const pageOf = async (phone: Phone, query: string): Promise<Body> => {
    const response = await pull(phone, query);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as Body;
  };
  const totals = async (): Promise<string> => {
    const rows = await sql<{ total: string }>`select coalesce(sum(work_order_count), 0)::text as total from sync.full_downloads`.execute(
      admin(),
    );
    return rows.rows[0]?.total ?? '';
  };

  it('EVM-096 AC8 a cursor of the snapshot replayed after the download ended is a resync, is counted and adds nothing to the register', async () => {
    await boot();
    const { phone } = await editor();
    for (let index = 1; index <= 4; index += 1) await order({ number: numberOf(2026, index) });
    const first = await pageOf(phone, 'limit=1');
    const middle = await pageOf(phone, `limit=1&cursor=${first.cursor}`);
    const rest = await drain(phone, 'limit=2', middle.cursor);
    expect(rest.pages.at(-1)).toMatchObject({ phase: 'changes' });
    const before = await totals();
    for (let round = 0; round < 3; round += 1) {
      expect((await pull(phone, `limit=1&cursor=${middle.cursor}`)).body).toMatchObject({
        result: 'resync_required',
        reason: 'cursor_invalid',
      });
    }
    expect(counter('sync_cursor_rejected_total', { reason: 'snapshot_replay' })).toBe(3);
    expect(await totals()).toBe(before);
  });

  it('EVM-096 AC8 a page asked again (the answer was lost) is served and not counted twice; going back further is a replay', async () => {
    await boot();
    const { phone } = await editor();
    for (let index = 1; index <= 5; index += 1) await order({ number: numberOf(2026, index) });
    const first = await pageOf(phone, 'limit=1');
    const second = await pageOf(phone, `limit=1&cursor=${first.cursor}`);
    const third = await pageOf(phone, `limit=1&cursor=${second.cursor}`);
    const repeat = await pageOf(phone, `limit=1&cursor=${second.cursor}`);
    expect(repeat.changes).toEqual(third.changes);
    expect(await totals()).toBe('3');
    expect((await pull(phone, `limit=1&cursor=${first.cursor}`)).body).toMatchObject({
      result: 'resync_required',
      reason: 'cursor_invalid',
    });
  });

  it('EVM-096 AC8 a cursor of a download begun over a day ago is a resync', async () => {
    await boot();
    const { phone } = await editor();
    for (let index = 1; index <= 3; index += 1) await order({ number: numberOf(2026, index) });
    const first = await pageOf(phone, 'limit=1');
    await sql`update sync.full_downloads set started_at = ${ago(1, 1000)}`.execute(admin());
    expect((await pull(phone, `limit=1&cursor=${first.cursor}`)).body).toMatchObject({
      result: 'resync_required',
      reason: 'cursor_invalid',
    });
  });
});

describe('the alerts of the mass read (EVM-096 AC8; AB-08, SR-LOG-07)', () => {
  const alerts = async (): Promise<number> => {
    const rows = await sql<{
      count: string;
    }>`select count(*)::text as count from platform.security_alert_outbox where alert_code = 'sync_full_downloads_excess'`.execute(admin());
    return Number(rows.rows[0]?.count);
  };

  it('EVM-096 AC8 the third full download in a day raises exactly one alert of the operator, the refused fourth does not repeat it; the trail names the device', async () => {
    await boot({ SYNC_FULL_DOWNLOADS_PER_DAY: '3' });
    const { phone } = await editor();
    await order({ number: numberOf(2026, 1) });
    for (let round = 0; round < 2; round += 1) {
      await drain(phone);
      expect(await alerts()).toBe(0);
      current.clock.advance(60_000);
    }
    await drain(phone);
    expect(await alerts()).toBe(1);
    expect((await pull(phone)).status).toBe(429);
    expect(await alerts()).toBe(1);
    const trace = await sql<{ object_id: string }>`
      select e.object_id from audit.events e join platform.security_alert_outbox a on a.trace_id = e.trace_id
      where a.alert_code = 'sync_full_downloads_excess' and e.action = 'sync.full_download'`.execute(admin());
    expect(trace.rows.map((row) => row.object_id)).toEqual([phone.deviceId]);
  });

  it('EVM-096 AC8 the device that pulls is noted at most once an hour (the base measure of the alert "pulls and sends nothing", EVM-098)', async () => {
    await boot();
    const { phone } = await editor();
    await order({ number: numberOf(2026, 1) });
    const result = await drain(phone);
    const noted = async (): Promise<Date | null> => {
      const rows = await sql<{
        last_pulled_at: Date | null;
      }>`select last_pulled_at from sync.device_sync_state where device_id = ${phone.deviceId ?? ''}`.execute(admin());
      return rows.rows[0]?.last_pulled_at ?? null;
    };
    const firstNote = await noted();
    expect(firstNote).toEqual(current.clock.now());
    current.clock.advance(10 * 60_000);
    await pull(phone, `cursor=${result.cursor}`);
    expect(await noted()).toEqual(firstNote);
    await sql`update sync.device_sync_state set last_pulled_at = ${new Date(current.clock.now().getTime() - 61 * 60_000)}`.execute(admin());
    await pull(phone, `cursor=${result.cursor}`);
    expect(await noted()).toEqual(current.clock.now());
  });
});

describe('the pool and the metrics (EVM-096 AC4, AC7; ADR-0021 D5)', () => {
  it('EVM-096 AC4 a session ended by transaction_timeout is discarded by the pool: the next request gets a working connection', async () => {
    await boot();
    const pool = createPool({
      url: current.database.appUrl,
      logger: createLogger({ level: 'fatal' }),
      pool: { max: 1, options: '-c transaction_timeout=400' },
    });
    const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
    try {
      await expect(
        db.transaction().execute(async (trx) => {
          await sql`select 1`.execute(trx);
          await new Promise((resolve) => setTimeout(resolve, 900));
          await sql`select 2`.execute(trx);
        }),
      ).rejects.toThrow();
      const next = await sql<{ one: number }>`select 1 as one`.execute(db);
      expect(next.rows[0]?.one).toBe(1);
    } finally {
      await db.destroy();
    }
  });

  it('EVM-096 AC7 the operator has the lag of the horizon, the duration of a page, the resyncs and the rejected cursors — with labels of closed sets only', async () => {
    await boot();
    const { phone } = await editor();
    const done = await drain(phone);
    await drain(phone, '', done.cursor);
    const samples = current.app.get<MetricsRegistry>(METRICS, { strict: false }).snapshot();
    const names = new Set(samples.map((sample) => sample.name));
    for (const name of [
      'sync_horizon_lag_seconds',
      'sync_changes_page_duration_seconds_count',
      'sync_changes_page_duration_seconds_sum',
      'sync_changes_requests_total',
      'sync_full_downloads_total',
    ])
      expect(names.has(name), name).toBe(true);
    expect(counter('sync_changes_page_duration_seconds_count')).toBeGreaterThan(1);
    for (const sample of samples.filter((item) => item.name.startsWith('sync_')))
      expect(
        Object.keys(sample.labels).every((key) => ['phase', 'reason'].includes(key)),
        sample.name,
      ).toBe(true);
    // a long transaction holds the horizon: the commit after it waits, and the lag of the oldest waiting row grows
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let opened: () => void = () => undefined;
    const began = new Promise<void>((resolve) => {
      opened = resolve;
    });
    const held = admin()
      .transaction()
      .execute(async (trx) => {
        await sql`select pg_current_xact_id()`.execute(trx);
        opened();
        await gate;
      });
    await began;
    await insertSite(admin());
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await drain(phone, '', done.cursor);
    expect(counter('sync_horizon_lag_seconds')).toBeGreaterThanOrEqual(1);
    release();
    await held;
  });
});

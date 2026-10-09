import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { clearSitesAndParties, insertParty, insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  await clearSitesAndParties(current.database.admin);
});

const CREATE = '/api/v1/sites';
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

const house = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  siteType: 'single_family_house',
  street: 'ul. Testowa',
  buildingNumber: '7',
  postalCode: '00-001',
  city: 'Warszawa',
  ...overrides,
});
const garage = (overrides: Record<string, unknown> = {}) =>
  house({ siteType: 'multi_family_garage', parkingSpotNumber: '15', garageLevel: '-1', ...overrides });
const create = (browser: Browser, body: unknown, key?: string) => {
  const call = browser.panel.post(CREATE, body);
  return key === undefined ? call : call.set('Idempotency-Key', key);
};
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;
const count = async (table: 'sites.sites' | 'platform.idempotency_records') => {
  const { rows } =
    table === 'sites.sites'
      ? await sql<{ n: string }>`select count(*)::text as n from sites.sites`.execute(admin())
      : await sql<{ n: string }>`select count(*)::text as n from platform.idempotency_records`.execute(admin());
  return Number(rows[0]?.n);
};
const auditOf = async (objectId: string) =>
  (await sql<Record<string, unknown>>`select * from audit.events where object_id = ${objectId}`.execute(admin())).rows;

describe('adding a site (EVM-021 AC2; SR-INPUT-01, SR-DATA-02)', () => {
  it('EVM-021 AC2 a garage with the spot 15 and the level -1, the power, the PPE, the OSD, the manager and notes: 201 with the site as the contract has it, ETag, no-store', async () => {
    const osd = await insertParty(admin(), { kind: 'distribution_system_operator' });
    const manager = await insertParty(admin(), { kind: 'property_manager', displayName: 'Zarządca Testowy' });
    const browser = await signIn('editor');
    const body = garage({
      apartmentNumber: '5',
      connectionPowerKw: 11.5,
      meteringPointId: 'PL0000000000000001',
      distributionSystemOperatorPartyId: osd,
      managerPartyId: manager,
      notes: 'Wjazd od ul. Bocznej\nPoziom -1',
    });
    const response = await create(browser, body, uuidv7());
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body).toEqual({
      ...body,
      version: 1,
      createdAt: expect.stringMatching(/^2026-10-01T08:00:00\.000Z$/) as unknown,
      updatedAt: expect.stringMatching(/^2026-10-01T08:00:00\.000Z$/) as unknown,
    });
    expect(response.headers['etag']).toBe('"1"');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['idempotent-replayed']).toBeUndefined();
    expect(response.headers['location']).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toMatch(/searchText|createdBy|updatedBy|deleted/);
    const { rows } = await sql<Record<string, unknown>>`select * from sites.sites where id = ${body.id}`.execute(admin());
    expect(rows[0]).toMatchObject({
      created_by: browser.userId,
      updated_by: browser.userId,
      version: 1,
      deleted_at: null,
      connection_power_kw: '11.50',
      distribution_system_operator_party_id: osd,
      manager_party_id: manager,
    });
  });

  it('EVM-021 AC2 a house with the address only, added by the Administrator, independent of any customer', async () => {
    const response = await create(await signIn('administrator'), house());
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body).toMatchObject({
      siteType: 'single_family_house',
      street: 'ul. Testowa',
      buildingNumber: '7',
      postalCode: '00-001',
      city: 'Warszawa',
    });
    for (const field of [
      'apartmentNumber',
      'parkingSpotNumber',
      'garageLevel',
      'connectionPowerKw',
      'meteringPointId',
      'managerPartyId',
      'notes',
    ])
      expect(response.body).not.toHaveProperty(field);
  });

  it('EVM-021 AC1 the new site is found at once with its parking spot (the form selects it after the save)', async () => {
    const browser = await signIn('editor');
    expect((await create(browser, garage())).status).toBe(201);
    const found = await browser.panel.post('/api/v1/sites/search', { query: 'testowa 7' });
    expect(found.body).toMatchObject({
      items: [{ street: 'ul. Testowa', buildingNumber: '7', city: 'Warszawa', parkingSpotNumber: '15' }],
    });
  });

  it('EVM-021 AC2 text is NFC and trimmed, the power keeps two decimals', async () => {
    const response = await create(await signIn('editor'), house({ street: '  ul. Łódzká  ', city: ' Łódź ', connectionPowerKw: 7.4 }));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body).toMatchObject({ street: 'ul. Łódzká'.normalize('NFC'), city: 'Łódź', connectionPowerKw: 7.4 });
  });

  it('EVM-021 AC2 the errors of the fields are pointers and codes (every wrong field at once); the values never come back', async () => {
    const browser = await signIn('editor');
    const response = await create(
      browser,
      house({
        siteType: 'commercial',
        parkingSpotNumber: '15',
        garageLevel: '-1',
        connectionPowerKw: 7.123,
        notes: 'zły\u0000znak',
        street: '   ',
      }),
    );
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'validation_failed' });
    expect(errorsOf(response.body)).toEqual([
      { pointer: '/street', code: 'required' },
      { pointer: '/parkingSpotNumber', code: 'not_allowed_for_site_type' },
      { pointer: '/garageLevel', code: 'not_allowed_for_site_type' },
      { pointer: '/connectionPowerKw', code: 'invalid_format' },
      { pointer: '/notes', code: 'invalid_characters' },
    ]);
    expect(JSON.stringify(response.body)).not.toMatch(/zły|7\.123|Testowa/);
    expect(await count('sites.sites')).toBe(0);
  });

  it('EVM-021 AC2 the postal code is NN-NNN and the connection power is in (0, 1000] kW: others are 400 invalid_format / out_of_range', async () => {
    const browser = await signIn('editor');
    for (const postalCode of ['00001', '0-0001', 'ab-cde'])
      expect(errorsOf((await create(browser, house({ postalCode }))).body), postalCode).toEqual([
        { pointer: '/postalCode', code: 'invalid_format' },
      ]);
    expect(errorsOf((await create(browser, house({ connectionPowerKw: 0 }))).body)).toEqual([
      { pointer: '/connectionPowerKw', code: 'out_of_range' },
    ]);
    expect(errorsOf((await create(browser, house({ connectionPowerKw: -3 }))).body)).toEqual([
      { pointer: '/connectionPowerKw', code: 'out_of_range' },
    ]);
    expect(errorsOf((await create(browser, house({ connectionPowerKw: 1000.5 }))).body)).toEqual([
      { pointer: '/connectionPowerKw', code: 'out_of_range' },
    ]);
    expect(errorsOf((await create(browser, house({ connectionPowerKw: '11' }))).body)).toEqual([
      { pointer: '/connectionPowerKw', code: 'invalid_type' },
    ]);
    expect((await create(browser, house({ connectionPowerKw: 1000 }))).status).toBe(201);
    expect((await create(browser, house({ connectionPowerKw: 0.01 }))).status).toBe(201);
    expect((await create(browser, house({ postalCode: '00-001' }))).status).toBe(201);
  });

  it('EVM-021 AC2 the PPE has at most 40 characters: 41 is 400 too_long, 40 passes', async () => {
    const browser = await signIn('editor');
    expect(errorsOf((await create(browser, house({ meteringPointId: 'P'.repeat(41) }))).body)).toEqual([
      { pointer: '/meteringPointId', code: 'too_long' },
    ]);
    expect((await create(browser, house({ meteringPointId: 'P'.repeat(40) }))).status).toBe(201);
  });

  it('EVM-021 AC2 the type is one of four: another value (or none) is 400 invalid_value', async () => {
    const browser = await signIn('editor');
    expect(errorsOf((await create(browser, house({ siteType: 'garage' }))).body)).toEqual([
      { pointer: '/siteType', code: 'invalid_value' },
    ]);
    expect(errorsOf((await create(browser, house({ siteType: undefined }))).body)).toEqual([
      { pointer: '/siteType', code: 'invalid_value' },
    ]);
  });

  it('EVM-021 AC2 the audit trail has ONE event site.created with the actor, the site id, the trace and no address, PPE or notes', async () => {
    const browser = await signIn('editor');
    const body = garage({ street: 'ul. Sekretna', meteringPointId: 'PPE-SEKRET-1', notes: 'notatka-poufna' });
    expect((await create(browser, body, uuidv7())).status).toBe(201);
    const events = await auditOf(body.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'site.created',
      outcome: 'success',
      actor_type: 'user',
      actor_user_id: browser.userId,
      object_type: 'site',
      object_id: body.id,
      origin: 'web',
    });
    expect(String(events[0]?.['trace_id'])).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(events)).not.toMatch(/Sekretna|Testowa|Warszawa|PPE-SEKRET|notatka-poufna|00-001/);
  });

  it('EVM-021 AC2 nothing about the site reaches the log of the API', async () => {
    const browser = await signIn('editor');
    const before = current.logs.lines.length;
    await create(browser, house({ street: 'ul. Logowana', meteringPointId: 'PPE-DO-LOGU', notes: 'notatka-do-logu' }), uuidv7());
    await create(browser, house({ street: 'ul. Zla', postalCode: 'zly' }));
    const lines = current.logs.lines.slice(before).join('\n');
    expect(lines).toContain(CREATE);
    expect(lines).not.toMatch(/Logowana|PPE-DO-LOGU|notatka-do-logu|ul\. Zla|Warszawa/);
  });
});

describe('the kind of the parties of a site (EVM-021 AC3; SR-INPUT-02)', () => {
  it('EVM-021 AC3 the OSD field takes the OSD kind; the manager field the administration, the property manager and the housing community', async () => {
    const browser = await signIn('editor');
    const osd = await insertParty(admin(), { kind: 'distribution_system_operator' });
    for (const kind of ['building_administration', 'property_manager', 'housing_community']) {
      const manager = await insertParty(admin(), { kind });
      const response = await create(browser, house({ distributionSystemOperatorPartyId: osd, managerPartyId: manager }));
      expect(response.status, `${kind}: ${JSON.stringify(response.body)}`).toBe(201);
    }
    expect(await count('sites.sites')).toBe(3);
  });

  it('EVM-021 AC3 a party of another kind in …PartyId is 400 validation_failed with wrong_party_kind and the pointer of the field — the kind found is not named; nothing is stored', async () => {
    const browser = await signIn('editor');
    const supplier = await insertParty(admin(), { kind: 'supplier' });
    const osd = await insertParty(admin(), { kind: 'distribution_system_operator' });
    const manager = await insertParty(admin(), { kind: 'property_manager' });
    const wrongOsd = await create(browser, house({ distributionSystemOperatorPartyId: manager }), uuidv7());
    expect(wrongOsd.status).toBe(400);
    expect(wrongOsd.body).toMatchObject({ code: 'validation_failed' });
    expect(errorsOf(wrongOsd.body)).toEqual([{ pointer: '/distributionSystemOperatorPartyId', code: 'wrong_party_kind' }]);
    expect(JSON.stringify(wrongOsd.body)).not.toMatch(/property_manager|distribution_system_operator|supplier/);
    expect(errorsOf((await create(browser, house({ managerPartyId: osd }))).body)).toEqual([
      { pointer: '/managerPartyId', code: 'wrong_party_kind' },
    ]);
    expect(errorsOf((await create(browser, house({ managerPartyId: supplier }))).body)).toEqual([
      { pointer: '/managerPartyId', code: 'wrong_party_kind' },
    ]);
    expect(errorsOf((await create(browser, house({ distributionSystemOperatorPartyId: manager, managerPartyId: osd }))).body)).toEqual([
      { pointer: '/distributionSystemOperatorPartyId', code: 'wrong_party_kind' },
      { pointer: '/managerPartyId', code: 'wrong_party_kind' },
    ]);
    expect(await count('sites.sites')).toBe(0);
  });

  it('EVM-021 AC3 a party that does not exist and one that is deleted are the same answer — 400 unknown_party — for every role', async () => {
    const deleted = await insertParty(admin(), { kind: 'distribution_system_operator', deletedAt: '2026-10-07T09:00:00Z' });
    for (const role of ['administrator', 'editor'] as const) {
      const browser = await signIn(role);
      const missing = await create(browser, house({ distributionSystemOperatorPartyId: uuidv7() }));
      const gone = await create(browser, house({ distributionSystemOperatorPartyId: deleted }));
      for (const response of [missing, gone]) {
        expect(response.status, role).toBe(400);
        expect(response.body, role).toMatchObject({ code: 'validation_failed' });
        expect(errorsOf(response.body), role).toEqual([{ pointer: '/distributionSystemOperatorPartyId', code: 'unknown_party' }]);
      }
      expect(JSON.stringify(gone.body).replace(/"traceId":"[0-9a-f]+"/, '')).toBe(
        JSON.stringify(missing.body).replace(/"traceId":"[0-9a-f]+"/, ''),
      );
    }
    expect(await count('sites.sites')).toBe(0);
  });

  it('EVM-021 AC3 a failed check leaves no idempotency record: the same key serves the corrected request', async () => {
    const browser = await signIn('editor');
    const manager = await insertParty(admin(), { kind: 'property_manager' });
    const key = uuidv7();
    expect((await create(browser, house({ distributionSystemOperatorPartyId: manager }), key)).status).toBe(400);
    expect((await create(browser, house({ managerPartyId: uuidv7() }), key)).status).toBe(400);
    expect(await count('platform.idempotency_records')).toBe(0);
    const fixed = await create(browser, house({ managerPartyId: manager }), key);
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(201);
    expect(await count('platform.idempotency_records')).toBe(1);
  });

  it('EVM-021 AC3 a party id that is not a UUID is 400 (the schema), not a database error', async () => {
    const browser = await signIn('editor');
    const response = await create(browser, house({ managerPartyId: "1' or '1'='1" }));
    expect(response.status).toBe(400);
    expect(errorsOf(response.body)).toEqual(expect.arrayContaining([{ pointer: '/managerPartyId', code: 'invalid_format' }]));
  });
});

describe('validation of the server (EVM-021 AC5; SR-AUTHZ-04, SR-INPUT-01, CWE-915)', () => {
  it('EVM-021 AC5 a field of the server is 400 validation_failed with the code read_only_field — searchText, createdAt, version and the rest; nothing is stored', async () => {
    const browser = await signIn('editor');
    const fields = ['createdAt', 'createdBy', 'deletedAt', 'deletedBy', 'searchText', 'updatedAt', 'updatedBy', 'version'];
    const response = await create(
      browser,
      house({
        searchText: 'x',
        createdAt: '2026-01-01T00:00:00Z',
        version: 9,
        createdBy: uuidv7(),
        updatedAt: '2026-01-01T00:00:00Z',
        updatedBy: uuidv7(),
        deletedAt: '2026-01-01T00:00:00Z',
        deletedBy: uuidv7(),
      }),
    );
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'validation_failed' });
    expect([...(errorsOf(response.body) ?? [])].sort((a, b) => a.pointer.localeCompare(b.pointer))).toEqual(
      fields.map((field) => ({ pointer: `/${field}`, code: 'read_only_field' })),
    );
    expect(await count('sites.sites')).toBe(0);
  });

  it('EVM-021 AC5 customerId (a site belongs to no customer) and any other field outside the schema is unknown_field, also __proto__; nothing is stored', async () => {
    const browser = await signIn('editor');
    const response = await create(browser, house({ customerId: uuidv7(), vip: true }));
    expect(response.status).toBe(400);
    expect(errorsOf(response.body)).toEqual(
      expect.arrayContaining([
        { pointer: '/customerId', code: 'unknown_field' },
        { pointer: '/vip', code: 'unknown_field' },
      ]),
    );
    const proto = await browser.panel.post(
      CREATE,
      JSON.parse(
        `{"id":"${uuidv7()}","siteType":"other","street":"ul. T","buildingNumber":"1","postalCode":"00-001","city":"W","__proto__":{"role":"administrator"}}`,
      ),
    );
    expect(proto.status).toBe(400);
    expect(await count('sites.sites')).toBe(0);
  });

  it('EVM-021 AC5 a text over its limit is 400 too_long (street 200, building 20, city 100, notes 2000); the limit itself passes', async () => {
    const browser = await signIn('editor');
    expect(errorsOf((await create(browser, house({ street: 'S'.repeat(201) }))).body)).toEqual([{ pointer: '/street', code: 'too_long' }]);
    expect(errorsOf((await create(browser, house({ buildingNumber: 'B'.repeat(21) }))).body)).toEqual([
      { pointer: '/buildingNumber', code: 'too_long' },
    ]);
    expect(errorsOf((await create(browser, house({ city: 'C'.repeat(101) }))).body)).toEqual([{ pointer: '/city', code: 'too_long' }]);
    expect(errorsOf((await create(browser, house({ notes: 'n'.repeat(2001) }))).body)).toEqual([{ pointer: '/notes', code: 'too_long' }]);
    expect(
      (
        await create(
          browser,
          house({ street: 'S'.repeat(200), buildingNumber: 'B'.repeat(20), city: 'C'.repeat(100), notes: 'n'.repeat(2000) }),
        )
      ).status,
    ).toBe(201);
  });

  it('EVM-021 AC5 the required fields are required; the id must be a UUIDv7 (another version or a text is 400, never a 500 of the CHECK)', async () => {
    const browser = await signIn('editor');
    expect(errorsOf((await create(browser, { id: uuidv7(), siteType: 'other' })).body)).toEqual([
      { pointer: '/street', code: 'required' },
      { pointer: '/buildingNumber', code: 'required' },
      { pointer: '/postalCode', code: 'required' },
      { pointer: '/city', code: 'required' },
    ]);
    for (const id of ['0198b0a0-0000-4000-8000-000000000001', 'not-a-uuid', 7]) {
      const response = await create(browser, house({ id }));
      expect(response.status, String(id)).toBe(400);
      expect(response.body).toMatchObject({ code: 'validation_failed' });
    }
  });

  it('EVM-021 AC2 the Idempotency-Key must be a UUIDv7: another version or a text is 400', async () => {
    const browser = await signIn('editor');
    for (const key of ['0198b0a0-0000-4000-8000-000000000001', 'abc']) {
      const response = await create(browser, house(), key);
      expect(response.status, key).toBe(400);
      expect(response.body).toMatchObject({ code: 'validation_failed' });
    }
    expect(await count('sites.sites')).toBe(0);
  });
});

describe('a repeat without a duplicate (EVM-021 AC2; SR-API-05, AB-09)', () => {
  it('EVM-021 AC2 the same id, key and content: 201 again with Idempotent-Replayed: true, ONE site, ONE audit event, ONE record', async () => {
    const browser = await signIn('editor');
    const body = garage({ notes: 'wjazd' });
    const key = uuidv7();
    const first = await create(browser, body, key);
    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    const second = await create(browser, { ...body }, key);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.headers['etag']).toBe('"1"');
    expect(second.body).toEqual(first.body);
    expect(await count('sites.sites')).toBe(1);
    expect(await auditOf(body.id)).toHaveLength(1);
    expect(await count('platform.idempotency_records')).toBe(1);
  });

  it('EVM-021 AC2 a repeat returns the site as it is NOW, and 404 when it is no longer visible', async () => {
    const browser = await signIn('editor');
    const body = house();
    const key = uuidv7();
    await create(browser, body, key);
    await sql`update sites.sites set notes = 'zmienione', version = 2 where id = ${body.id}`.execute(admin());
    const replay = await create(browser, body, key);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toMatchObject({ notes: 'zmienione', version: 2 });
    await sql`update sites.sites set deleted_at = now() where id = ${body.id}`.execute(admin());
    const gone = await create(browser, body, key);
    expect(gone.status).toBe(404);
    expect(gone.body).toMatchObject({ code: 'not_found' });
  });

  it('EVM-021 AC2 the same key with another content is 422 idempotency_mismatch; no second site', async () => {
    const browser = await signIn('editor');
    const key = uuidv7();
    await create(browser, house(), key);
    const other = await create(browser, house({ street: 'ul. Inna' }), key);
    expect(other.status).toBe(422);
    expect(other.body).toMatchObject({ code: 'idempotency_mismatch' });
    expect(await count('sites.sites')).toBe(1);
  });

  it('EVM-021 AC2 a parallel request with the same key is 409 idempotency_in_progress with Retry-After; after the first one it is a creation', async () => {
    const browser = await signIn('editor');
    const body = house();
    const key = uuidv7();
    await admin()
      .transaction()
      .execute(async (tx) => {
        await sql`select pg_advisory_xact_lock(hashtextextended(${`idempotency|${browser.userId}||${key}`}, 0))`.execute(tx);
        const refused = await create(browser, body, key);
        expect(refused.status, JSON.stringify(refused.body)).toBe(409);
        expect(refused.body).toMatchObject({ code: 'idempotency_in_progress' });
        expect(refused.headers['retry-after']).toBe('1');
        expect(await count('sites.sites')).toBe(0);
      });
    const retried = await create(browser, body, key);
    expect(retried.status).toBe(201);
    expect(retried.headers['idempotent-replayed']).toBeUndefined();
  });

  it("EVM-021 AC2 an existing id (also a deleted site's, with another key or none) is 409 id_conflict — and nothing about the existing site is in the answer", async () => {
    const browser = await signIn('editor');
    const body = house({ street: 'ul. Pierwsza' });
    await create(browser, body, uuidv7());
    const conflicting = house({ id: body.id, street: 'ul. Zupelnie-Inna', city: 'Gdynia' });
    for (const key of [uuidv7(), undefined]) {
      const response = await create(browser, conflicting, key);
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'id_conflict' });
      expect(JSON.stringify(response.body)).not.toMatch(/Pierwsza|Zupelnie|Gdynia/);
    }
    const deleted = await insertSite(admin(), { deletedAt: '2026-10-07T09:00:00Z' });
    const gone = await create(browser, house({ id: deleted }), uuidv7());
    expect(gone.status).toBe(409);
    expect(gone.body).toMatchObject({ code: 'id_conflict' });
    expect(await count('sites.sites')).toBe(2);
    const row = (await sql<{ street: string }>`select street from sites.sites where id = ${body.id}`.execute(admin())).rows[0];
    expect(row?.street).toBe('ul. Pierwsza');
  });

  it('EVM-021 AC2 a failed save leaves the key free: after 409 id_conflict the same key serves the next creation', async () => {
    const browser = await signIn('editor');
    const taken = await insertSite(admin(), {});
    const key = uuidv7();
    expect((await create(browser, house({ id: taken }), key)).status).toBe(409);
    expect(await count('platform.idempotency_records')).toBe(0);
    expect((await create(browser, house(), key)).status).toBe(201);
  });

  it('EVM-021 AC2 the key belongs to the user: ANOTHER user with the same key gets no result of the first one', async () => {
    const alice = await signIn('editor');
    const bob = await signIn('administrator');
    const key = uuidv7();
    await create(alice, house(), key);
    const own = house({ street: 'ul. Druga' });
    const fresh = await create(bob, own, key);
    expect(fresh.status).toBe(201);
    expect(fresh.headers['idempotent-replayed']).toBeUndefined();
    expect(fresh.body).toMatchObject({ id: own.id, street: 'ul. Druga' });
    expect(await count('sites.sites')).toBe(2);
  });

  it('EVM-021 AC2 without a key the creation works (the key is optional on the web) and gives no record of idempotency', async () => {
    const browser = await signIn('editor');
    expect((await create(browser, house())).status).toBe(201);
    expect(await count('platform.idempotency_records')).toBe(0);
  });
});

describe('who may add a site (EVM-021 AC6; SR-AUTHZ-01, SR-AUTHZ-02, SR-AUTHZ-05)', () => {
  it('EVM-021 AC6 Administrator and Editor 201; Read-only 403 forbidden — for any body, and without a record of idempotency or a site', async () => {
    for (const role of ['administrator', 'editor'] as const)
      expect((await create(await signIn(role), house(), uuidv7())).status, role).toBe(201);
    const readOnly = await signIn('read_only');
    const valid = await create(readOnly, house(), uuidv7());
    expect(valid.status).toBe(403);
    expect(valid.body).toMatchObject({ code: 'forbidden' });
    const invalid = await create(readOnly, { zle: 'pole', searchText: 'x' }, uuidv7());
    expect(invalid.status).toBe(403); // not 400: the authorization comes before the validation
    expect(JSON.stringify(invalid.body)).not.toContain('errors');
    expect(await count('sites.sites')).toBe(2);
    expect(await count('platform.idempotency_records')).toBe(2);
  });

  it('EVM-021 AC6 no session is 401 (before any look at the body); the mobile channel is 403; no CSRF token is 403 csrf_failed', async () => {
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    for (const body of [house(), { zle: 'pole' }]) {
      const response = await anonymous.post(CREATE, body).set('Idempotency-Key', uuidv7());
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ code: 'unauthenticated' });
    }
    for (const role of ['administrator', 'editor'] as const)
      expect((await create(await signIn(role, 'mobile'), house(), uuidv7())).status, role).toBe(403);
    const noToken = await signIn('editor');
    noToken.panel.csrfToken = undefined;
    const csrf = await create(noToken, house(), uuidv7());
    expect(csrf.status).toBe(403);
    expect(csrf.body).toMatchObject({ code: 'csrf_failed' });
    expect(await count('sites.sites')).toBe(0);
    expect(await count('platform.idempotency_records')).toBe(0);
  });

  it('EVM-021 AC6 EVM-036 AC7 there is no route that writes a single site by POST (404); the GET of /sites/{id} is the detail of EVM-036', async () => {
    const browser = await signIn('administrator');
    const body = house();
    await create(browser, body);
    expect((await browser.panel.get(`${CREATE}/${body.id}`)).status).toBe(200);
    expect((await browser.panel.post(`${CREATE}/${body.id}`, {})).status).toBe(404);
  });
});

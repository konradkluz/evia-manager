import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { clearSitesAndParties, insertParty, insertSite, type SiteSpec } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  await sql`delete from work_orders.scope_items`.execute(current.database.admin);
  await sql`delete from work_orders.work_order_assignments`.execute(current.database.admin);
  await sql`delete from work_orders.work_orders`.execute(current.database.admin);
  await clearSitesAndParties(current.database.admin);
});

const BASE = '/api/v1/sites';
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

const codeOf = (body: unknown) => (body as { code?: string }).code;
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;
const withoutTrace = (body: unknown): string => JSON.stringify(body).replace(/"traceId":"[0-9a-f]+"/, '');

const get = (browser: Browser, id: string) => browser.panel.get(`${BASE}/${id}`);
interface PatchOptions {
  readonly ifMatch?: string | null;
  readonly key?: string;
}
const patch = (browser: Browser, id: string, body: unknown, options: PatchOptions = {}) =>
  browser.panel.patch(`${BASE}/${id}`, body, {
    ...(options.ifMatch === null ? {} : { 'If-Match': options.ifMatch ?? '"1"' }),
    ...(options.key === undefined ? {} : { 'Idempotency-Key': options.key }),
  });

interface Row {
  site_type: string;
  street: string;
  postal_code: string;
  parking_spot_number: string | null;
  garage_level: string | null;
  connection_power_kw: string | null;
  metering_point_id: string | null;
  distribution_system_operator_party_id: string | null;
  manager_party_id: string | null;
  notes: string | null;
  version: number;
  created_by: string | null;
  updated_by: string | null;
}
async function rowOf(id: string): Promise<Row> {
  const { rows } = await sql<Row>`select site_type, street, postal_code, parking_spot_number, garage_level, connection_power_kw,
    metering_point_id, distribution_system_operator_party_id, manager_party_id, notes, version, created_by, updated_by
    from sites.sites where id = ${id}`.execute(admin());
  const row = rows[0];
  if (row === undefined) throw new Error('no such site');
  return row;
}
const auditOf = async (objectId: string) =>
  (await sql<Record<string, unknown>>`select * from audit.events where object_id = ${objectId} order by occurred_at, id`.execute(admin()))
    .rows;
const auditTotal = async (): Promise<number> =>
  Number(
    (await sql<{ n: string }>`select count(*)::text as n from audit.events where action = 'site.updated'`.execute(admin())).rows[0]?.n,
  );
const idempotencyTotal = async (): Promise<number> =>
  Number((await sql<{ n: string }>`select count(*)::text as n from platform.idempotency_records`.execute(admin())).rows[0]?.n);

const GARAGE: SiteSpec = { siteType: 'multi_family_garage', parkingSpotNumber: '15', garageLevel: '-1' };

describe('the detail of a site (EVM-036 AC1, AC6, AC7; SR-AUTHZ-02, SR-AUTHZ-05, SR-DATA-03)', () => {
  it('EVM-036 AC1 the whole site for the dialog W-20, an ETag of the version, no-store and nosniff — for the three roles', async () => {
    const osd = await insertParty(admin());
    const id = await insertSite(admin(), {
      ...GARAGE,
      connectionPowerKw: 11.5,
      meteringPointId: 'PL0000000000000001',
      osdPartyId: osd,
      notes: 'Wjazd z boku.',
    });
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const response = await get(await signIn(role), id);
      expect(response.status, role).toBe(200);
      expect(response.headers['etag']).toBe('"1"');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.body).toEqual({
        id,
        siteType: 'multi_family_garage',
        street: 'ul. Testowa',
        buildingNumber: '7',
        postalCode: '00-001',
        city: 'Warszawa',
        parkingSpotNumber: '15',
        garageLevel: '-1',
        connectionPowerKw: 11.5,
        meteringPointId: 'PL0000000000000001',
        distributionSystemOperatorPartyId: osd,
        notes: 'Wjazd z boku.',
        version: 1,
        createdAt: '2026-10-07T08:00:00.000Z',
        updatedAt: '2026-10-07T08:00:00.000Z',
      });
    }
  });

  it('EVM-036 AC6 the site has no customer, medium or document: the answer holds none of those keys and never the search text or the authors', async () => {
    const id = await insertSite(admin(), { notes: 'x' });
    const response = await get(await signIn('read_only'), id);
    expect(JSON.stringify(Object.keys(response.body as object))).not.toMatch(
      /customer|media|document|payment|searchText|createdBy|updatedBy|deleted/i,
    );
  });

  it('EVM-036 AC7 a site that is soft deleted and one that never existed are the SAME 404 not_found for every role; a malformed id is 400', async () => {
    const deleted = await insertSite(admin(), { deletedAt: '2026-10-02T08:00:00Z' });
    const answers: string[] = [];
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const browser = await signIn(role);
      for (const id of [deleted, uuidv7()]) {
        const response = await get(browser, id);
        expect(response.status, role).toBe(404);
        expect(codeOf(response.body)).toBe('not_found');
        answers.push(withoutTrace(response.body));
      }
    }
    expect(new Set(answers).size).toBe(1);
    expect((await get(await signIn(), 'abc')).status).toBe(400);
  });

  it('EVM-036 AC7 an anonymous caller is 401 and a mobile token 403 on the detail and the edit', async () => {
    const id = await insertSite(admin());
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    expect((await anonymous.get(`${BASE}/${id}`)).status).toBe(401);
    expect((await anonymous.patch(`${BASE}/${id}`, { notes: 'x' }, { 'If-Match': '"1"' })).status).toBe(401);
    const mobile = await signIn('editor', 'mobile');
    for (const response of [await get(mobile, id), await patch(mobile, id, { notes: 'x' })]) {
      expect(response.status).toBe(403);
      expect(codeOf(response.body)).toBe('forbidden');
    }
    expect((await rowOf(id)).version).toBe(1);
  });
});

describe('the edit of a site (EVM-036 AC1, AC2, AC7; SR-INPUT-01, SR-INPUT-02, SR-AUTHZ-04, SR-API-06)', () => {
  it('EVM-036 AC1 the PPE, the power and the notes change: version + 1, a new ETag, the author of the change; the address stays', async () => {
    const id = await insertSite(admin());
    const editor = await signIn('editor');
    const response = await patch(editor, id, { meteringPointId: 'PL0000000000000099', connectionPowerKw: 17.25, notes: 'Brama od ulicy.' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['etag']).toBe('"2"');
    expect(response.headers['idempotent-replayed']).toBeUndefined();
    expect(response.body).toMatchObject({
      id,
      street: 'ul. Testowa',
      meteringPointId: 'PL0000000000000099',
      connectionPowerKw: 17.25,
      notes: 'Brama od ulicy.',
      version: 2,
    });
    expect(await rowOf(id)).toMatchObject({
      metering_point_id: 'PL0000000000000099',
      connection_power_kw: '17.25',
      notes: 'Brama od ulicy.',
      street: 'ul. Testowa',
      version: 2,
      updated_by: editor.userId,
    });
    expect(((await get(editor, id)).body as { version: number }).version).toBe(2);
  });

  it('EVM-036 AC7 the Administrator edits as well', async () => {
    const id = await insertSite(admin());
    const administrator = await signIn('administrator');
    expect((await patch(administrator, id, { city: 'Łódź', postalCode: '90-001' })).status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ postal_code: '90-001', version: 2, updated_by: administrator.userId });
  });

  it('EVM-036 AC1 a field that is absent stays; null clears an optional field; null in a required one is 400', async () => {
    const id = await insertSite(admin(), { meteringPointId: 'PL1', connectionPowerKw: 11, notes: 'n' });
    const editor = await signIn('editor');
    const cleared = await patch(editor, id, { meteringPointId: null, connectionPowerKw: null, notes: null });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(await rowOf(id)).toMatchObject({ metering_point_id: null, connection_power_kw: null, notes: null, street: 'ul. Testowa' });
    expect(Object.keys(cleared.body as object)).not.toContain('meteringPointId');
    const required = await patch(editor, id, { street: null }, { ifMatch: '"2"' });
    expect(required.status).toBe(400);
    expect(errorsOf(required.body)).toEqual([{ pointer: '/street', code: 'invalid_type' }]);
  });

  it('EVM-036 AC1 the rules of the creation apply — postal code (shape), scale of the power, garage fields; errors carry a pointer and a code, never the value', async () => {
    const id = await insertSite(admin());
    const editor = await signIn('editor');
    const shape = await patch(editor, id, { postalCode: '99999x' });
    expect(shape.status).toBe(400);
    expect(errorsOf(shape.body)).toEqual([{ pointer: '/postalCode', code: 'invalid_format' }]);
    const response = await patch(editor, id, { connectionPowerKw: 11.123, parkingSpotNumber: 'miejsce-poufne' });
    expect(response.status).toBe(400);
    expect(errorsOf(response.body)).toEqual(
      expect.arrayContaining([
        { pointer: '/connectionPowerKw', code: 'invalid_format' },
        { pointer: '/parkingSpotNumber', code: 'not_allowed_for_site_type' },
      ]),
    );
    expect(JSON.stringify(response.body)).not.toMatch(/99999|11\.123|miejsce-poufne/);
    expect(await rowOf(id)).toMatchObject({ version: 1, postal_code: '00-001' });
  });

  it('EVM-036 AC1 leaving a garage must clear the spot and the level in the same patch', async () => {
    const id = await insertSite(admin(), GARAGE);
    const editor = await signIn('editor');
    const refused = await patch(editor, id, { siteType: 'commercial' });
    expect(refused.status).toBe(400);
    expect(errorsOf(refused.body)).toEqual([
      { pointer: '/parkingSpotNumber', code: 'not_allowed_for_site_type' },
      { pointer: '/garageLevel', code: 'not_allowed_for_site_type' },
    ]);
    const accepted = await patch(editor, id, { siteType: 'commercial', parkingSpotNumber: null, garageLevel: null });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(await rowOf(id)).toMatchObject({ site_type: 'commercial', parking_spot_number: null, garage_level: null });
  });

  it('EVM-036 AC7 a stranger (customerId, __proto__, constructor) is 400 unknown_field and the site is untouched', async () => {
    const id = await insertSite(admin());
    const editor = await signIn('editor');
    const response = await patch(editor, id, { notes: 'x', customerId: uuidv7(), constructor: { prototype: { isAdmin: true } } });
    expect(response.status).toBe(400);
    expect(errorsOf(response.body)).toEqual(
      expect.arrayContaining([
        { pointer: '/customerId', code: 'unknown_field' },
        { pointer: '/constructor', code: 'unknown_field' },
      ]),
    );
    const proto = await editor.panel
      .patch(`${BASE}/${id}`, undefined, { 'If-Match': '"1"', 'Content-Type': 'application/json' })
      .send('{"__proto__":{"isAdmin":true},"notes":"x"}');
    expect(proto.status).toBe(400);
    expect(errorsOf(proto.body)).toEqual([{ pointer: '/__proto__', code: 'unknown_field' }]);
    expect(({} as Record<string, unknown>)['isAdmin']).toBeUndefined();
    expect(await rowOf(id)).toMatchObject({ notes: null, version: 1 });
  });

  it('EVM-036 AC7 every field controlled by the server — id, version, createdAt, updatedAt, searchText — is 400 read_only_field', async () => {
    const id = await insertSite(admin());
    const editor = await signIn('editor');
    const fields: Record<string, unknown> = {
      id: uuidv7(),
      version: 99,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      searchText: 'podrobiony',
    };
    for (const [field, value] of Object.entries(fields)) {
      const response = await patch(editor, id, { [field]: value });
      expect(response.status, field).toBe(400);
      expect(errorsOf(response.body), field).toEqual([{ pointer: `/${field}`, code: 'read_only_field' }]);
    }
    expect(await rowOf(id)).toMatchObject({ version: 1, updated_by: null });
  });

  it('EVM-036 AC1 If-Match: absent is 428, weak / a list / * / malformed is 400 at the header — whether or not the site exists', async () => {
    const id = await insertSite(admin());
    const editor = await signIn('editor');
    for (const target of [id, uuidv7()]) {
      const absent = await patch(editor, target, { notes: 'x' }, { ifMatch: null });
      expect(absent.status).toBe(428);
      expect(codeOf(absent.body)).toBe('precondition_required');
      for (const ifMatch of ['W/"1"', '"1", "2"', '*', '1', '"0"']) {
        const response = await patch(editor, target, { notes: 'x' }, { ifMatch });
        expect(response.status, ifMatch).toBe(400);
        expect(errorsOf(response.body)).toEqual([{ pointer: '/headers/If-Match', code: 'invalid_format' }]);
      }
    }
    expect((await rowOf(id)).version).toBe(1);
  });
});

describe('the parties of a site (EVM-036 AC2; SR-INPUT-02, SR-AUTHZ-02)', () => {
  it('EVM-036 AC2 the OSD and the manager are saved when they are of the right kinds; null clears one', async () => {
    const id = await insertSite(admin());
    const osd = await insertParty(admin());
    const manager = await insertParty(admin(), { kind: 'property_manager', displayName: 'Zarządca Testowy' });
    const editor = await signIn('editor');
    const set = await patch(editor, id, { distributionSystemOperatorPartyId: osd, managerPartyId: manager });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body).toMatchObject({ distributionSystemOperatorPartyId: osd, managerPartyId: manager });
    const cleared = await patch(editor, id, { managerPartyId: null }, { ifMatch: '"2"' });
    expect(cleared.status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ distribution_system_operator_party_id: osd, manager_party_id: null });
  });

  it('EVM-036 AC2 a party of the wrong kind is 400 validation_failed wrong_party_kind — without the id and the kind found', async () => {
    const id = await insertSite(admin());
    const designer = await insertParty(admin(), { kind: 'designer', displayName: 'Projektant Poufny' });
    const osd = await insertParty(admin());
    const editor = await signIn('editor');
    const response = await patch(editor, id, { distributionSystemOperatorPartyId: designer, managerPartyId: osd });
    expect(response.status).toBe(400);
    expect(codeOf(response.body)).toBe('validation_failed');
    expect(errorsOf(response.body)).toEqual([
      { pointer: '/distributionSystemOperatorPartyId', code: 'wrong_party_kind' },
      { pointer: '/managerPartyId', code: 'wrong_party_kind' },
    ]);
    expect(JSON.stringify(response.body)).not.toMatch(/designer|distribution_system_operator\b|Projektant|Poufny/);
    expect(JSON.stringify(response.body)).not.toContain(designer);
    expect(await rowOf(id)).toMatchObject({ distribution_system_operator_party_id: null, manager_party_id: null, version: 1 });
  });

  it('EVM-036 AC2 a party that does not exist and one that is deleted are the SAME unknown_party', async () => {
    const id = await insertSite(admin());
    const deleted = await insertParty(admin(), { deletedAt: '2026-10-02T08:00:00Z' });
    const editor = await signIn('editor');
    const answers: string[] = [];
    for (const party of [deleted, uuidv7()]) {
      const response = await patch(editor, id, { distributionSystemOperatorPartyId: party });
      expect(response.status).toBe(400);
      expect(errorsOf(response.body)).toEqual([{ pointer: '/distributionSystemOperatorPartyId', code: 'unknown_party' }]);
      answers.push(withoutTrace(response.body));
    }
    expect(new Set(answers).size).toBe(1);
  });

  it('EVM-036 AC2 a party the patch does not name is not asked about: an OSD deleted since does not stop the correction of the PPE', async () => {
    const osd = await insertParty(admin());
    const id = await insertSite(admin(), { osdPartyId: osd });
    await sql`update parties.parties set deleted_at = now() where id = ${osd}`.execute(admin());
    const editor = await signIn('editor');
    const response = await patch(editor, id, { meteringPointId: 'PL0000000000000042' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(await rowOf(id)).toMatchObject({ distribution_system_operator_party_id: osd, metering_point_id: 'PL0000000000000042' });
  });

  it('EVM-036 AC2 a failed check of a party leaves nothing: no audit event, no idempotency record, the version unchanged', async () => {
    const id = await insertSite(admin());
    const designer = await insertParty(admin(), { kind: 'designer' });
    const editor = await signIn('editor');
    const events = await auditTotal();
    const records = await idempotencyTotal();
    const failed = await patch(editor, id, { managerPartyId: designer, notes: 'x' }, { key: uuidv7() });
    expect(failed.status).toBe(400);
    expect(await auditTotal()).toBe(events);
    expect(await idempotencyTotal()).toBe(records);
    expect(await rowOf(id)).toMatchObject({ version: 1, notes: null });
  });
});

describe('conflicts and visibility (EVM-036 AC4, AC7; SR-API-06, SR-API-07, SR-AUTHZ-02)', () => {
  it('EVM-036 AC4 a stale If-Match is 412 version_conflict: the data are untouched, the answer carries no current value, and no event is written', async () => {
    const id = await insertSite(admin());
    const editor = await signIn('editor');
    expect((await patch(editor, id, { meteringPointId: 'PL0000000000000001' })).status).toBe(200); // version 2
    const events = await auditTotal();
    const records = await idempotencyTotal();
    const stale = await patch(editor, id, { notes: 'wartosc-poufna' }, { ifMatch: '"1"', key: uuidv7() });
    expect(stale.status).toBe(412);
    expect(codeOf(stale.body)).toBe('version_conflict');
    expect(JSON.stringify(stale.body)).not.toMatch(/PL0000000000000001|wartosc-poufna|"version":/);
    expect(await rowOf(id)).toMatchObject({ notes: null, metering_point_id: 'PL0000000000000001', version: 2 });
    expect(await auditTotal()).toBe(events);
    expect(await idempotencyTotal()).toBe(records);
  });

  it('EVM-036 AC4 a deleted site with a STALE If-Match is 404 — never 412; the same body as for a site that never existed', async () => {
    const deleted = await insertSite(admin(), { deletedAt: '2026-10-02T08:00:00Z' });
    const answers: string[] = [];
    for (const role of ['administrator', 'editor'] as const) {
      const browser = await signIn(role);
      for (const target of [deleted, uuidv7()]) {
        for (const body of [{ notes: 'x' }, { connectionPowerKw: 11.123 }]) {
          const response = await patch(browser, target, body, { ifMatch: '"7"' });
          expect(response.status, `${role} ${JSON.stringify(body)}`).toBe(404);
          answers.push(withoutTrace(response.body));
        }
      }
    }
    expect(new Set(answers).size).toBe(1);
    expect((await rowOf(deleted)).version).toBe(1);
  });

  it('EVM-036 AC4 two edits with the SAME ETag at once: one is 200, the other 412, the version rose by one and one event was written', async () => {
    const id = await insertSite(admin());
    const editor = await signIn('editor');
    const other = await signIn('administrator');
    const [first, second] = await Promise.all([patch(editor, id, { notes: 'pierwsza' }), patch(other, id, { notes: 'druga' })]);
    expect([first.status, second.status].sort()).toEqual([200, 412]);
    expect((await rowOf(id)).version).toBe(2);
    expect(await auditOf(id)).toHaveLength(1);
  });

  it('EVM-036 AC6 the site of an order that is soft deleted is reachable only as a site — the edit of a site does not touch any order', async () => {
    const id = await insertSite(admin());
    const editor = await signIn('editor');
    expect((await patch(editor, id, { notes: 'x' })).status).toBe(200);
    const { rows } = await sql<{ n: string }>`select count(*)::text as n from work_orders.work_orders`.execute(admin());
    expect(rows[0]?.n).toBe('0');
  });
});

describe('the idempotency of the edit of a site (EVM-036 AC1; SR-API-05, ASVS V2.3.3, CWE-639)', () => {
  it('EVM-036 AC1 a repeat (same key, site and body) answers 200 with Idempotent-Replayed, with no second change and no second audit event', async () => {
    const id = await insertSite(admin());
    const editor = await signIn('editor');
    const key = uuidv7();
    const first = await patch(editor, id, { notes: 'jedna' }, { key });
    expect(first.status).toBe(200);
    for (const ifMatch of ['"1"', '"2"']) {
      const again = await patch(editor, id, { notes: 'jedna' }, { key, ifMatch });
      expect(again.status, ifMatch).toBe(200);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.headers['etag']).toBe('"2"');
      expect(again.body).toEqual(first.body);
    }
    expect((await rowOf(id)).version).toBe(2);
    expect(await auditOf(id)).toHaveLength(1);
  });

  it('EVM-036 AC1 the same key with another body is 422 idempotency_mismatch', async () => {
    const id = await insertSite(admin());
    const editor = await signIn('editor');
    const key = uuidv7();
    expect((await patch(editor, id, { notes: 'jedna' }, { key })).status).toBe(200);
    const other = await patch(editor, id, { notes: 'dwa' }, { key, ifMatch: '"2"' });
    expect(other.status).toBe(422);
    expect(codeOf(other.body)).toBe('idempotency_mismatch');
    expect((await rowOf(id)).notes).toBe('jedna');
  });

  it('EVM-036 AC1 the key is bound to the SITE: the same key and body for ANOTHER site is 422 idempotency_mismatch, never a replay', async () => {
    const first = await insertSite(admin(), { street: 'ul. Pierwsza' });
    const second = await insertSite(admin(), { street: 'ul. Druga' });
    const editor = await signIn('editor');
    const key = uuidv7();
    expect((await patch(editor, first, { notes: 'jedna' }, { key })).status).toBe(200);
    const response = await patch(editor, second, { notes: 'jedna' }, { key });
    expect(response.status).toBe(422);
    expect(codeOf(response.body)).toBe('idempotency_mismatch');
    expect(JSON.stringify(response.body)).not.toMatch(/Pierwsza|jedna/);
    expect(await rowOf(second)).toMatchObject({ notes: null, version: 1 });
  });

  it('EVM-036 AC1 a failed edit leaves no idempotency record that would block the retry with the same key', async () => {
    const id = await insertSite(admin());
    const editor = await signIn('editor');
    const key = uuidv7();
    expect((await patch(editor, id, { postalCode: 'zly' }, { key })).status).toBe(400);
    const retry = await patch(editor, id, { postalCode: '90-001' }, { key });
    expect(retry.status).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
  });
});

describe('who may edit a site, what is audited and what is logged (EVM-036 AC7; SR-AUTHZ-01, SR-AUTHZ-05, SR-LOG-02, SR-LOG-03)', () => {
  it('EVM-036 AC7 Read-only is 403 forbidden on a PATCH whatever it carries — before the headers, the body and the existence of the site', async () => {
    const id = await insertSite(admin());
    const reader = await signIn('read_only');
    const events = await auditTotal();
    const records = await idempotencyTotal();
    for (const [target, body, ifMatch] of [
      [id, { notes: 'x' }, '"1"'],
      [id, { postalCode: 'zly', id: 'x', nieznane: 1 }, '"1"'],
      [id, { notes: 'x' }, null],
      [uuidv7(), { notes: 'x' }, '"1"'],
    ] as const) {
      const response = await patch(reader, target, body, { ifMatch, key: uuidv7() });
      expect(response.status, JSON.stringify(body)).toBe(403);
      expect(codeOf(response.body)).toBe('forbidden');
    }
    expect(await rowOf(id)).toMatchObject({ notes: null, version: 1 });
    expect(await auditTotal()).toBe(events);
    expect(await idempotencyTotal()).toBe(records);
  });

  it('EVM-036 AC7 a missing, a wrong or a foreign-origin CSRF token is 403 csrf_failed; the site is untouched', async () => {
    const id = await insertSite(admin());
    const editor = await signIn('editor');
    const wrong = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    wrong.cookie = editor.panel.cookie;
    wrong.csrfToken = 'not-the-token';
    const missing = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    missing.cookie = editor.panel.cookie;
    const crossSite = new PanelClient(current.app.getHttpServer(), 'https://evil.example');
    crossSite.cookie = editor.panel.cookie;
    crossSite.csrfToken = editor.panel.csrfToken;
    for (const client of [wrong, missing, crossSite]) {
      const response = await client.patch(`${BASE}/${id}`, { notes: 'x' }, { 'If-Match': '"1"' });
      expect(response.status).toBe(403);
      expect(codeOf(response.body)).toBe('csrf_failed');
    }
    expect((await rowOf(id)).version).toBe(1);
  });

  it('EVM-036 AC7 SR-LOG-03 the audit trail has ONE site.updated with the actor, the site, the outcome and the trace — and no field name and no value', async () => {
    const id = await insertSite(admin(), { street: 'ul. Poufna', notes: 'stara-notatka' });
    const editor = await signIn('editor');
    expect((await patch(editor, id, { meteringPointId: 'PL0000000000000777', notes: 'nowa-notatka' })).status).toBe(200);
    const events = await auditOf(id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'site.updated',
      outcome: 'success',
      actor_type: 'user',
      actor_user_id: editor.userId,
      object_type: 'site',
      object_id: id,
      origin: 'web',
    });
    expect(String(events[0]?.['trace_id'])).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(events)).not.toMatch(/PL0000000000000777|nowa-notatka|stara-notatka|Poufna|metering|notes|street/);
  });

  it('EVM-036 AC1 nothing about the site reaches the log of the API — not the PPE, the notes, the address, nor a rejected value', async () => {
    const id = await insertSite(admin(), { street: 'ul. Sekretna' });
    const editor = await signIn('editor');
    const before = current.logs.lines.length;
    await patch(editor, id, { meteringPointId: 'PL-SEKRET-1', notes: 'sekretna-notatka-xyz' });
    await patch(editor, id, { postalCode: 'zly-sekret' }, { ifMatch: '"2"' });
    await patch(editor, id, { notes: 'sekret-412' }, { ifMatch: '"1"' });
    await get(editor, id);
    expect(current.logs.lines.slice(before).join('\n')).not.toMatch(/SEKRET|sekret|Sekretna/);
  });
});

describe('the limit of requests (EVM-036 AC8; SR-API-02)', () => {
  it('EVM-036 AC8 past the limit of requests a PATCH is 429 rate_limited with Retry-After and the site is untouched', async () => {
    const limited = await createIdentityApp();
    try {
      const user = await createUser(limited.database.admin, limited.clock, { role: 'editor' });
      const session = await createSession(limited.database.admin, limited.clock, user, { channel: 'web' });
      const panel = new PanelClient(limited.app.getHttpServer(), PANEL_ORIGIN);
      panel.cookie = session.cookie;
      panel.csrfToken = session.csrfToken;
      const id = await insertSite(limited.database.admin);
      for (let attempt = 1; attempt <= 1200; attempt += 1) await panel.get('/api/v1/nothing');
      const response = await panel.patch(`${BASE}/${id}`, { notes: 'x' }, { 'If-Match': '"1"' });
      expect(response.status).toBe(429);
      expect(codeOf(response.body)).toBe('rate_limited');
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
      const { rows } = await sql<{ version: number }>`select version from sites.sites where id = ${id}`.execute(limited.database.admin);
      expect(rows[0]?.version).toBe(1);
    } finally {
      await limited.close();
    }
  }, 60_000);
});

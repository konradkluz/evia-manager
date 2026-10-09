import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { clearSitesAndParties, insertParty, insertSite, type PartySpec } from '../support/site-fixtures.ts';
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

const BASE = '/api/v1/parties';
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
  kind: string;
  legal_form: string;
  display_name: string;
  contact_person_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  version: number;
  updated_by: string | null;
}
async function rowOf(id: string): Promise<Row> {
  const { rows } = await sql<Row>`select kind, legal_form, display_name, contact_person_name, phone, email, notes, version, updated_by
    from parties.parties where id = ${id}`.execute(admin());
  const row = rows[0];
  if (row === undefined) throw new Error('no such party');
  return row;
}
const auditOf = async (objectId: string) =>
  (await sql<Record<string, unknown>>`select * from audit.events where object_id = ${objectId} order by occurred_at, id`.execute(admin()))
    .rows;
const auditTotal = async (): Promise<number> =>
  Number(
    (await sql<{ n: string }>`select count(*)::text as n from audit.events where action = 'party.updated'`.execute(admin())).rows[0]?.n,
  );
const idempotencyTotal = async (): Promise<number> =>
  Number((await sql<{ n: string }>`select count(*)::text as n from platform.idempotency_records`.execute(admin())).rows[0]?.n);

const MANAGER: PartySpec = {
  kind: 'property_manager',
  displayName: 'Zarządca Testowy',
  contactPersonName: 'Anna Kontaktowa',
  phone: '+48600000001',
  email: 'biuro@example.test',
  notes: 'Biuro czynne do 16:00.',
};

describe('the detail of a party (EVM-036 AC3, AC6, AC7; SR-AUTHZ-02, SR-AUTHZ-05, SR-DATA-03)', () => {
  it('EVM-036 AC3 the whole party for the dialog, an ETag of the version, no-store and nosniff — for the three roles', async () => {
    const id = await insertParty(admin(), MANAGER);
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const response = await get(await signIn(role), id);
      expect(response.status, role).toBe(200);
      expect(response.headers['etag']).toBe('"1"');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.body).toEqual({
        id,
        kind: 'property_manager',
        legalForm: 'organization',
        displayName: 'Zarządca Testowy',
        contactPersonName: 'Anna Kontaktowa',
        phone: '+48600000001',
        email: 'biuro@example.test',
        notes: 'Biuro czynne do 16:00.',
        version: 1,
        createdAt: '2026-10-07T08:00:00.000Z',
        updatedAt: '2026-10-07T08:00:00.000Z',
      });
    }
    expect(JSON.stringify((await get(await signIn('read_only'), id)).body)).not.toMatch(/searchText|createdBy|updatedBy|deleted/);
  });

  it('EVM-036 AC7 a party that is soft deleted and one that never existed are the SAME 404 not_found for every role; a malformed id is 400', async () => {
    const deleted = await insertParty(admin(), { deletedAt: '2026-10-02T08:00:00Z' });
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
    const id = await insertParty(admin());
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

describe('the edit of a party (EVM-036 AC3, AC7; SR-INPUT-01, SR-INPUT-05, SR-AUTHZ-04, SR-API-06)', () => {
  it('EVM-036 AC3 a new name, telephone and e-mail: normalised like at the creation (E.164, lower case), version + 1, a new ETag, the author', async () => {
    const id = await insertParty(admin(), MANAGER);
    const editor = await signIn('editor');
    const response = await patch(editor, id, {
      displayName: 'Zarządca Nowy',
      phone: '+48 (600) 000-222',
      email: 'Biuro.Nowe@Example.TEST',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['etag']).toBe('"2"');
    expect(response.headers['idempotent-replayed']).toBeUndefined();
    expect(response.body).toMatchObject({
      id,
      kind: 'property_manager',
      displayName: 'Zarządca Nowy',
      phone: '+48600000222',
      email: 'biuro.nowe@example.test',
      contactPersonName: 'Anna Kontaktowa',
      version: 2,
    });
    expect(await rowOf(id)).toMatchObject({ display_name: 'Zarządca Nowy', phone: '+48600000222', version: 2, updated_by: editor.userId });
    expect(((await get(editor, id)).body as { version: number }).version).toBe(2);
  });

  it('EVM-036 AC3 the change is seen where the party is used: the card of a site names the new name (the party is shared)', async () => {
    const id = await insertParty(admin(), { kind: 'distribution_system_operator', displayName: 'OSD Stary' });
    const siteId = await insertSite(admin(), { osdPartyId: id });
    const editor = await signIn('editor');
    expect((await patch(editor, id, { displayName: 'OSD Nowy' })).status).toBe(200);
    const { rows } = await sql<{ display_name: string }>`select p.display_name from sites.sites s
      join parties.parties p on p.id = s.distribution_system_operator_party_id where s.id = ${siteId}`.execute(admin());
    expect(rows[0]?.display_name).toBe('OSD Nowy');
  });

  it('EVM-036 AC7 the Administrator edits as well', async () => {
    const id = await insertParty(admin(), MANAGER);
    const administrator = await signIn('administrator');
    expect((await patch(administrator, id, { notes: 'Nowa notatka.' })).status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ notes: 'Nowa notatka.', version: 2, updated_by: administrator.userId });
  });

  it('EVM-036 AC3 a field that is absent stays; null clears an optional field; null in the name is 400', async () => {
    const id = await insertParty(admin(), MANAGER);
    const editor = await signIn('editor');
    const cleared = await patch(editor, id, { phone: null, email: null, notes: null, contactPersonName: null });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(await rowOf(id)).toMatchObject({
      phone: null,
      email: null,
      notes: null,
      contact_person_name: null,
      display_name: 'Zarządca Testowy',
    });
    expect(Object.keys(cleared.body as object)).not.toContain('email');
    const name = await patch(editor, id, { displayName: null }, { ifMatch: '"2"' });
    expect(name.status).toBe(400);
    expect(errorsOf(name.body)).toEqual([{ pointer: '/displayName', code: 'invalid_type' }]);
  });

  it('EVM-036 AC3 the legal form can change (an organisation becomes a natural person)', async () => {
    const id = await insertParty(admin(), MANAGER);
    const editor = await signIn('editor');
    const response = await patch(editor, id, { legalForm: 'natural_person', displayName: 'Jan Przykładowy' });
    expect(response.status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ legal_form: 'natural_person', display_name: 'Jan Przykładowy', kind: 'property_manager' });
  });

  it('EVM-036 AC3 the rules of the creation apply: a telephone and an e-mail — errors are a pointer and a code, never the value', async () => {
    const id = await insertParty(admin(), MANAGER);
    const editor = await signIn('editor');
    const response = await patch(editor, id, { phone: '12345', email: 'zly-adres-poufny' });
    expect(response.status).toBe(400);
    expect(codeOf(response.body)).toBe('validation_failed');
    expect(errorsOf(response.body)).toEqual(
      expect.arrayContaining([
        { pointer: '/phone', code: 'invalid_format' },
        { pointer: '/email', code: 'invalid_format' },
      ]),
    );
    expect(JSON.stringify(response.body)).not.toMatch(/12345|zly-adres/);
    expect(await rowOf(id)).toMatchObject({ phone: '+48600000001', version: 1 });
  });

  it('EVM-036 AC3 the KIND is immutable: naming it is 400 read_only_field, whatever the value (even the same one)', async () => {
    const id = await insertParty(admin(), MANAGER);
    const editor = await signIn('editor');
    for (const kind of ['designer', 'property_manager', 'robot']) {
      const response = await patch(editor, id, { kind });
      expect(response.status, kind).toBe(400);
      expect(errorsOf(response.body), kind).toEqual([{ pointer: '/kind', code: 'read_only_field' }]);
    }
    expect(await rowOf(id)).toMatchObject({ kind: 'property_manager', version: 1 });
  });

  it('EVM-036 AC7 every field controlled by the server is 400 read_only_field, a stranger (customerId, searchText is server) is unknown_field', async () => {
    const id = await insertParty(admin(), MANAGER);
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
    const stranger = await patch(editor, id, { customerId: uuidv7(), constructor: {} });
    expect(errorsOf(stranger.body)).toEqual(
      expect.arrayContaining([
        { pointer: '/customerId', code: 'unknown_field' },
        { pointer: '/constructor', code: 'unknown_field' },
      ]),
    );
    const proto = await editor.panel
      .patch(`${BASE}/${id}`, undefined, { 'If-Match': '"1"', 'Content-Type': 'application/json' })
      .send('{"__proto__":{"isAdmin":true}}');
    expect(errorsOf(proto.body)).toEqual([{ pointer: '/__proto__', code: 'unknown_field' }]);
    expect(await rowOf(id)).toMatchObject({ version: 1, updated_by: null });
  });

  it('EVM-036 AC3 If-Match: absent is 428, weak / a list / * / malformed is 400 at the header — whether or not the party exists', async () => {
    const id = await insertParty(admin(), MANAGER);
    const editor = await signIn('editor');
    for (const target of [id, uuidv7()]) {
      const absent = await patch(editor, target, { notes: 'x' }, { ifMatch: null });
      expect(absent.status).toBe(428);
      for (const ifMatch of ['W/"1"', '"1", "2"', '*', '1', '"0"']) {
        const response = await patch(editor, target, { notes: 'x' }, { ifMatch });
        expect(response.status, ifMatch).toBe(400);
        expect(errorsOf(response.body)).toEqual([{ pointer: '/headers/If-Match', code: 'invalid_format' }]);
      }
    }
    expect((await rowOf(id)).version).toBe(1);
  });
});

describe('conflicts and visibility (EVM-036 AC4; SR-API-06, SR-API-07, SR-AUTHZ-02)', () => {
  it('EVM-036 AC4 a stale If-Match is 412 version_conflict: the data are untouched, no current value in the answer, no event and no idempotency record', async () => {
    const id = await insertParty(admin(), MANAGER);
    const editor = await signIn('editor');
    expect((await patch(editor, id, { phone: '600 000 111' })).status).toBe(200); // version 2
    const events = await auditTotal();
    const records = await idempotencyTotal();
    const stale = await patch(editor, id, { notes: 'wartosc-poufna' }, { ifMatch: '"1"', key: uuidv7() });
    expect(stale.status).toBe(412);
    expect(codeOf(stale.body)).toBe('version_conflict');
    expect(JSON.stringify(stale.body)).not.toMatch(/600000111|wartosc-poufna|"version":/);
    expect(await rowOf(id)).toMatchObject({ phone: '+48600000111', version: 2 });
    expect(await auditTotal()).toBe(events);
    expect(await idempotencyTotal()).toBe(records);
  });

  it('EVM-036 AC4 a deleted party with a STALE If-Match is 404 — never 412; the same body as for a party that never existed', async () => {
    const deleted = await insertParty(admin(), { deletedAt: '2026-10-02T08:00:00Z' });
    const answers: string[] = [];
    for (const role of ['administrator', 'editor'] as const) {
      const browser = await signIn(role);
      for (const target of [deleted, uuidv7()]) {
        for (const body of [{ notes: 'x' }, { phone: 'zly' }]) {
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
    const id = await insertParty(admin(), MANAGER);
    const editor = await signIn('editor');
    const other = await signIn('administrator');
    const [first, second] = await Promise.all([patch(editor, id, { notes: 'pierwsza' }), patch(other, id, { notes: 'druga' })]);
    expect([first.status, second.status].sort()).toEqual([200, 412]);
    expect((await rowOf(id)).version).toBe(2);
    expect(await auditOf(id)).toHaveLength(1);
  });
});

describe('the idempotency of the edit of a party (EVM-036 AC3; SR-API-05, ASVS V2.3.3, CWE-639)', () => {
  it('EVM-036 AC3 a repeat (same key, party and body) answers 200 with Idempotent-Replayed, with no second change and no second audit event', async () => {
    const id = await insertParty(admin(), MANAGER);
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

  it('EVM-036 AC3 the same key with another body is 422; the same key and body for ANOTHER party is 422 idempotency_mismatch, never a replay', async () => {
    const first = await insertParty(admin(), { ...MANAGER, displayName: 'Pierwsza Strona' });
    const second = await insertParty(admin(), { ...MANAGER, displayName: 'Druga Strona' });
    const editor = await signIn('editor');
    const key = uuidv7();
    expect((await patch(editor, first, { notes: 'jedna' }, { key })).status).toBe(200);
    const body = await patch(editor, first, { notes: 'dwa' }, { key, ifMatch: '"2"' });
    expect(body.status).toBe(422);
    const other = await patch(editor, second, { notes: 'jedna' }, { key });
    expect(other.status).toBe(422);
    expect(codeOf(other.body)).toBe('idempotency_mismatch');
    expect(JSON.stringify(other.body)).not.toMatch(/Pierwsza|jedna/);
    expect(await rowOf(second)).toMatchObject({ notes: 'Biuro czynne do 16:00.', version: 1 });
  });

  it('EVM-036 AC3 a failed edit leaves no idempotency record that would block the retry with the same key', async () => {
    const id = await insertParty(admin(), MANAGER);
    const editor = await signIn('editor');
    const key = uuidv7();
    expect((await patch(editor, id, { phone: 'zly' }, { key })).status).toBe(400);
    const retry = await patch(editor, id, { phone: '600 000 777' }, { key });
    expect(retry.status).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
  });
});

describe('who may edit a party, what is audited and what is logged (EVM-036 AC7; SR-AUTHZ-01, SR-AUTHZ-05, SR-LOG-02, SR-LOG-03)', () => {
  it('EVM-036 AC7 Read-only is 403 forbidden on a PATCH whatever it carries — before the headers, the body and the existence of the party', async () => {
    const id = await insertParty(admin(), MANAGER);
    const reader = await signIn('read_only');
    const events = await auditTotal();
    const records = await idempotencyTotal();
    for (const [target, body, ifMatch] of [
      [id, { notes: 'x' }, '"1"'],
      [id, { phone: 'zly', id: 'x', nieznane: 1 }, '"1"'],
      [id, { notes: 'x' }, null],
      [uuidv7(), { notes: 'x' }, '"1"'],
    ] as const) {
      const response = await patch(reader, target, body, { ifMatch, key: uuidv7() });
      expect(response.status, JSON.stringify(body)).toBe(403);
      expect(codeOf(response.body)).toBe('forbidden');
    }
    expect(await rowOf(id)).toMatchObject({ phone: '+48600000001', version: 1 });
    expect(await auditTotal()).toBe(events);
    expect(await idempotencyTotal()).toBe(records);
  });

  it('EVM-036 AC7 a missing, a wrong or a foreign-origin CSRF token is 403 csrf_failed; the party is untouched', async () => {
    const id = await insertParty(admin(), MANAGER);
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

  it('EVM-036 AC3 SR-LOG-03 the audit trail has ONE party.updated with the actor, the party, the outcome and the trace — no name, no field, no value', async () => {
    const id = await insertParty(admin(), { ...MANAGER, legalForm: 'natural_person', displayName: 'Jan Poufny' });
    const editor = await signIn('editor');
    expect((await patch(editor, id, { displayName: 'Jan Nowy-Poufny', phone: '600 000 555', notes: 'nowa-notatka' })).status).toBe(200);
    const events = await auditOf(id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'party.updated',
      outcome: 'success',
      actor_type: 'user',
      actor_user_id: editor.userId,
      object_type: 'party',
      object_id: id,
      origin: 'web',
    });
    expect(String(events[0]?.['trace_id'])).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(events)).not.toMatch(/Poufny|600000555|nowa-notatka|biuro@example|phone|email|notes|displayName/);
  });

  it('EVM-036 AC3 nothing about the party reaches the log of the API — not the name, the telephone, the e-mail, the notes, nor a rejected value', async () => {
    const id = await insertParty(admin(), { ...MANAGER, displayName: 'Sekretna Strona' });
    const editor = await signIn('editor');
    const before = current.logs.lines.length;
    await patch(editor, id, { displayName: 'Sekretny Nowy', phone: '600 000 888', notes: 'sekretna-notatka-xyz' });
    await patch(editor, id, { phone: '999 sekret', email: 'zly-sekret' }, { ifMatch: '"2"' });
    await patch(editor, id, { notes: 'sekret-412' }, { ifMatch: '"1"' });
    await get(editor, id);
    expect(current.logs.lines.slice(before).join('\n')).not.toMatch(/sekret|Sekret|600000888|600 000 888|biuro@example/);
  });
});

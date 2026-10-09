import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { clearSitesAndParties, insertParty } from '../support/site-fixtures.ts';
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

const CREATE = '/api/v1/parties';
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

const operator = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  kind: 'distribution_system_operator',
  legalForm: 'organization',
  displayName: 'Operator Testowy',
  ...overrides,
});
const create = (browser: Browser, body: unknown, key?: string) => {
  const call = browser.panel.post(CREATE, body);
  return key === undefined ? call : call.set('Idempotency-Key', key);
};
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;
const count = async (table: 'parties.parties' | 'platform.idempotency_records') => {
  const { rows } =
    table === 'parties.parties'
      ? await sql<{ n: string }>`select count(*)::text as n from parties.parties`.execute(admin())
      : await sql<{ n: string }>`select count(*)::text as n from platform.idempotency_records`.execute(admin());
  return Number(rows[0]?.n);
};
const auditOf = async (objectId: string) =>
  (await sql<Record<string, unknown>>`select * from audit.events where object_id = ${objectId}`.execute(admin())).rows;

describe('adding a party (EVM-021 AC4; SR-INPUT-01, SR-DATA-02)', () => {
  it('EVM-021 AC4 an OSD: 201 with the party as the contract has it, the telephone in E.164, the e-mail in lower case, ETag, no-store', async () => {
    const browser = await signIn('editor');
    const body = operator({
      contactPersonName: 'Anna Kontaktowa',
      phone: '600 000 003',
      email: 'Biuro@Operator.Example.TEST',
      notes: 'Dział przyłączeń\nlinia 2',
    });
    const response = await create(browser, body, uuidv7());
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body).toEqual({
      id: body.id,
      kind: 'distribution_system_operator',
      legalForm: 'organization',
      displayName: 'Operator Testowy',
      contactPersonName: 'Anna Kontaktowa',
      phone: '+48600000003',
      email: 'biuro@operator.example.test',
      notes: 'Dział przyłączeń\nlinia 2',
      version: 1,
      createdAt: expect.stringMatching(/^2026-10-01T08:00:00\.000Z$/) as unknown,
      updatedAt: expect.stringMatching(/^2026-10-01T08:00:00\.000Z$/) as unknown,
    });
    expect(response.headers['etag']).toBe('"1"');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['idempotent-replayed']).toBeUndefined();
    expect(response.headers['location']).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toMatch(/searchText|createdBy|updatedBy|deleted/);
    const { rows } = await sql<Record<string, unknown>>`select * from parties.parties where id = ${body.id}`.execute(admin());
    expect(rows[0]).toMatchObject({ created_by: browser.userId, updated_by: browser.userId, version: 1, deleted_at: null });
  });

  it('EVM-021 AC4 the minimum: the kind, the form and the name — a natural person, added by the Administrator, with no contact data', async () => {
    const browser = await signIn('administrator');
    const body = { id: uuidv7(), kind: 'designer', legalForm: 'natural_person', displayName: 'Jan Projektant' };
    const response = await create(browser, body);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body).toMatchObject({ kind: 'designer', legalForm: 'natural_person', displayName: 'Jan Projektant', version: 1 });
    for (const field of ['contactPersonName', 'phone', 'email', 'notes']) expect(response.body).not.toHaveProperty(field);
  });

  it('EVM-021 AC4 the new party is found at once, by its kind (the combobox selects it after the save)', async () => {
    const browser = await signIn('editor');
    expect((await create(browser, operator({ displayName: 'Nowy Operator' }))).status).toBe(201);
    const found = await browser.panel.post('/api/v1/parties/search', { query: 'nowy op', kinds: ['distribution_system_operator'] });
    expect(found.body).toMatchObject({ items: [{ displayName: 'Nowy Operator', kind: 'distribution_system_operator' }] });
  });

  it('EVM-021 AC4 the errors of the fields are pointers and codes (every wrong field at once); the values never come back', async () => {
    const browser = await signIn('editor');
    const response = await create(
      browser,
      operator({ phone: 'sekretny-telefon', email: 'sekretny-email', notes: 'zły\u0000znak', displayName: '   ' }),
    );
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'validation_failed' });
    expect(errorsOf(response.body)).toEqual([
      { pointer: '/displayName', code: 'required' },
      { pointer: '/phone', code: 'invalid_format' },
      { pointer: '/email', code: 'invalid_format' },
      { pointer: '/notes', code: 'invalid_characters' },
    ]);
    expect(JSON.stringify(response.body)).not.toMatch(/sekretny|zły/);
    expect(await count('parties.parties')).toBe(0);
  });

  it('EVM-021 AC4 the kind and the form are closed lists: another value (or none) is 400 invalid_value, a missing name required', async () => {
    const browser = await signIn('editor');
    expect(errorsOf((await create(browser, operator({ kind: 'osd' }))).body)).toEqual([{ pointer: '/kind', code: 'invalid_value' }]);
    expect(errorsOf((await create(browser, operator({ legalForm: 'person' }))).body)).toEqual([
      { pointer: '/legalForm', code: 'invalid_value' },
    ]);
    expect(errorsOf((await create(browser, operator({ kind: undefined, displayName: undefined }))).body)).toEqual([
      { pointer: '/kind', code: 'invalid_value' },
      { pointer: '/displayName', code: 'required' },
    ]);
  });

  it('EVM-021 AC4 the audit trail has ONE event party.created with the actor, the party id, the trace and no personal data — not even the name of a natural person', async () => {
    const browser = await signIn('editor');
    const body = operator({
      legalForm: 'natural_person',
      displayName: 'Jan Przykładowy',
      contactPersonName: 'Anna Kontaktowa',
      phone: '600000004',
      email: 'jan@example.test',
      notes: 'notatka-poufna',
    });
    expect((await create(browser, body, uuidv7())).status).toBe(201);
    const events = await auditOf(body.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'party.created',
      outcome: 'success',
      actor_type: 'user',
      actor_user_id: browser.userId,
      object_type: 'party',
      object_id: body.id,
      origin: 'web',
    });
    expect(String(events[0]?.['trace_id'])).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(events)).not.toMatch(/Przykładowy|Kontaktowa|600000004|jan@example|notatka-poufna/);
  });

  it('EVM-021 AC4 nothing about the party reaches the log of the API', async () => {
    const browser = await signIn('editor');
    const before = current.logs.lines.length;
    await create(
      browser,
      operator({ displayName: 'Logowany Kontrahent', email: 'logowany@example.test', notes: 'notatka-do-logu' }),
      uuidv7(),
    );
    await create(browser, operator({ phone: 'zly' }));
    const lines = current.logs.lines.slice(before).join('\n');
    expect(lines).toContain(CREATE);
    expect(lines).not.toMatch(/Logowany|logowany@example|notatka-do-logu|zly/);
  });
});

describe('validation of the server (EVM-021 AC5; SR-AUTHZ-04, SR-INPUT-01, CWE-915)', () => {
  it('EVM-021 AC5 a field of the server is 400 validation_failed with the code read_only_field — searchText, createdAt, version and the rest; nothing is stored', async () => {
    const browser = await signIn('editor');
    const fields = ['createdAt', 'createdBy', 'deletedAt', 'deletedBy', 'searchText', 'updatedAt', 'updatedBy', 'version'];
    const response = await create(
      browser,
      operator({
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
    expect(await count('parties.parties')).toBe(0);
  });

  it('EVM-021 AC5 a field outside the schema is unknown_field (also __proto__); nothing is stored', async () => {
    const browser = await signIn('editor');
    expect(errorsOf((await create(browser, operator({ vip: true }))).body)).toEqual([{ pointer: '/vip', code: 'unknown_field' }]);
    const proto = await browser.panel.post(
      CREATE,
      JSON.parse(`{"id":"${uuidv7()}","kind":"other","legalForm":"organization","displayName":"X","__proto__":{"role":"administrator"}}`),
    );
    expect(proto.status).toBe(400);
    expect(await count('parties.parties')).toBe(0);
  });

  it('EVM-021 AC5 a name over 200 characters (and notes over 2000, an e-mail over 254) is 400 too_long; 200 passes', async () => {
    const browser = await signIn('editor');
    const long = await create(browser, operator({ displayName: 'N'.repeat(201) }));
    expect(long.status).toBe(400);
    expect(errorsOf(long.body)).toEqual([{ pointer: '/displayName', code: 'too_long' }]);
    expect(errorsOf((await create(browser, operator({ notes: 'n'.repeat(2001) }))).body)).toEqual([
      { pointer: '/notes', code: 'too_long' },
    ]);
    expect(errorsOf((await create(browser, operator({ email: `${'a'.repeat(250)}@b.cz` }))).body)).toEqual([
      { pointer: '/email', code: 'too_long' },
    ]);
    expect(errorsOf((await create(browser, operator({ contactPersonName: 'C'.repeat(201) }))).body)).toEqual([
      { pointer: '/contactPersonName', code: 'too_long' },
    ]);
    expect((await create(browser, operator({ displayName: 'N'.repeat(200) }))).status).toBe(201);
  });

  it('EVM-021 AC5 the id must be a UUIDv7: another version or a text is 400 (never a 500 of the CHECK of the database)', async () => {
    const browser = await signIn('editor');
    for (const id of ['0198b0a0-0000-4000-8000-000000000001', 'not-a-uuid', 7]) {
      const response = await create(browser, operator({ id }));
      expect(response.status, String(id)).toBe(400);
      expect(response.body).toMatchObject({ code: 'validation_failed' });
    }
    expect(errorsOf((await create(browser, operator({ id: undefined }))).body)).toEqual([{ pointer: '/id', code: 'required' }]);
  });

  it('EVM-021 AC4 the Idempotency-Key must be a UUIDv7: another version or a text is 400', async () => {
    const browser = await signIn('editor');
    for (const key of ['0198b0a0-0000-4000-8000-000000000001', 'abc']) {
      const response = await create(browser, operator(), key);
      expect(response.status, key).toBe(400);
      expect(response.body).toMatchObject({ code: 'validation_failed' });
    }
    expect(await count('parties.parties')).toBe(0);
  });
});

describe('a repeat without a duplicate (EVM-021 AC4; SR-API-05, AB-09)', () => {
  it('EVM-021 AC4 the same id, key and content: 201 again with Idempotent-Replayed: true, ONE party, ONE audit event, ONE record', async () => {
    const browser = await signIn('editor');
    const body = operator({ email: 'biuro@example.test' });
    const key = uuidv7();
    const first = await create(browser, body, key);
    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    const second = await create(browser, { ...body }, key);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.headers['etag']).toBe('"1"');
    expect(second.body).toEqual(first.body);
    expect(await count('parties.parties')).toBe(1);
    expect(await auditOf(body.id)).toHaveLength(1);
    expect(await count('platform.idempotency_records')).toBe(1);
  });

  it('EVM-021 AC4 a repeat returns the party as it is NOW, and 404 when it is no longer visible', async () => {
    const browser = await signIn('editor');
    const body = operator();
    const key = uuidv7();
    await create(browser, body, key);
    await sql`update parties.parties set notes = 'zmienione', version = 2 where id = ${body.id}`.execute(admin());
    const replay = await create(browser, body, key);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toMatchObject({ notes: 'zmienione', version: 2 });
    await sql`update parties.parties set deleted_at = now() where id = ${body.id}`.execute(admin());
    const gone = await create(browser, body, key);
    expect(gone.status).toBe(404);
    expect(gone.body).toMatchObject({ code: 'not_found' });
  });

  it('EVM-021 AC4 the same key with another content is 422 idempotency_mismatch; the same key on ANOTHER operation (a site) too; no second party', async () => {
    const browser = await signIn('editor');
    const key = uuidv7();
    await create(browser, operator(), key);
    const other = await create(browser, operator({ displayName: 'Inna Nazwa' }), key);
    expect(other.status).toBe(422);
    expect(other.body).toMatchObject({ code: 'idempotency_mismatch' });
    const site = await browser.panel
      .post('/api/v1/sites', {
        id: uuidv7(),
        siteType: 'other',
        street: 'ul. Testowa',
        buildingNumber: '7',
        postalCode: '00-001',
        city: 'Warszawa',
      })
      .set('Idempotency-Key', key);
    expect(site.status).toBe(422);
    expect(site.body).toMatchObject({ code: 'idempotency_mismatch' });
    expect(await count('parties.parties')).toBe(1);
  });

  it('EVM-021 AC4 a parallel request with the same key is 409 idempotency_in_progress with Retry-After; after the first one it is a creation', async () => {
    const browser = await signIn('editor');
    const body = operator();
    const key = uuidv7();
    await admin()
      .transaction()
      .execute(async (tx) => {
        await sql`select pg_advisory_xact_lock(hashtextextended(${`idempotency|${browser.userId}||${key}`}, 0))`.execute(tx);
        const refused = await create(browser, body, key);
        expect(refused.status, JSON.stringify(refused.body)).toBe(409);
        expect(refused.body).toMatchObject({ code: 'idempotency_in_progress' });
        expect(refused.headers['retry-after']).toBe('1');
        expect(await count('parties.parties')).toBe(0);
      });
    const retried = await create(browser, body, key);
    expect(retried.status).toBe(201);
    expect(retried.headers['idempotent-replayed']).toBeUndefined();
  });

  it("EVM-021 AC4 an existing id (also a deleted party's, with another key or none) is 409 id_conflict — and nothing about the existing party is in the answer", async () => {
    const browser = await signIn('editor');
    const body = operator();
    await create(browser, body, uuidv7());
    const conflicting = operator({ id: body.id, displayName: 'Zupelnie-Inna-Nazwa', phone: '600000009' });
    for (const key of [uuidv7(), undefined]) {
      const response = await create(browser, conflicting, key);
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'id_conflict' });
      expect(JSON.stringify(response.body)).not.toMatch(/Operator Testowy|Zupelnie|600000009/);
    }
    const deleted = await insertParty(admin(), { deletedAt: '2026-10-07T09:00:00Z' });
    const gone = await create(browser, operator({ id: deleted }), uuidv7());
    expect(gone.status).toBe(409);
    expect(gone.body).toMatchObject({ code: 'id_conflict' });
    expect(await count('parties.parties')).toBe(2);
  });

  it('EVM-021 AC4 a failed save leaves the key free: after 409 id_conflict the same key serves the next creation, and 4xx leaves no record', async () => {
    const browser = await signIn('editor');
    const taken = await insertParty(admin(), {});
    const key = uuidv7();
    expect((await create(browser, operator({ id: taken }), key)).status).toBe(409);
    expect((await create(browser, operator({ phone: 'zly' }), key)).status).toBe(400);
    expect(await count('platform.idempotency_records')).toBe(0);
    expect((await create(browser, operator(), key)).status).toBe(201);
  });

  it('EVM-021 AC4 the key belongs to the user: ANOTHER user with the same key gets no result of the first one', async () => {
    const alice = await signIn('editor');
    const bob = await signIn('administrator');
    const key = uuidv7();
    await create(alice, operator(), key);
    const own = operator({ displayName: 'Drugi Operator' });
    const fresh = await create(bob, own, key);
    expect(fresh.status).toBe(201);
    expect(fresh.headers['idempotent-replayed']).toBeUndefined();
    expect(fresh.body).toMatchObject({ id: own.id, displayName: 'Drugi Operator' });
    expect(await count('parties.parties')).toBe(2);
  });

  it('EVM-021 AC4 without a key the creation works (the key is optional on the web) and gives no record of idempotency', async () => {
    const browser = await signIn('editor');
    expect((await create(browser, operator())).status).toBe(201);
    expect(await count('platform.idempotency_records')).toBe(0);
  });
});

describe('who may add a party (EVM-021 AC6; SR-AUTHZ-01, SR-AUTHZ-02, SR-AUTHZ-05)', () => {
  it('EVM-021 AC6 Administrator and Editor 201; Read-only 403 forbidden — for any body, and without a record of idempotency or a party', async () => {
    for (const role of ['administrator', 'editor'] as const)
      expect((await create(await signIn(role), operator(), uuidv7())).status, role).toBe(201);
    const readOnly = await signIn('read_only');
    const valid = await create(readOnly, operator(), uuidv7());
    expect(valid.status).toBe(403);
    expect(valid.body).toMatchObject({ code: 'forbidden' });
    const invalid = await create(readOnly, { zle: 'pole', searchText: 'x' }, uuidv7());
    expect(invalid.status).toBe(403); // not 400: the authorization comes before the validation
    expect(JSON.stringify(invalid.body)).not.toContain('errors');
    expect(await count('parties.parties')).toBe(2);
    expect(await count('platform.idempotency_records')).toBe(2);
  });

  it('EVM-021 AC6 no session is 401 (before any look at the body); the mobile channel is 403; no CSRF token is 403 csrf_failed', async () => {
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    for (const body of [operator(), { zle: 'pole' }]) {
      const response = await anonymous.post(CREATE, body).set('Idempotency-Key', uuidv7());
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ code: 'unauthenticated' });
    }
    for (const role of ['administrator', 'editor'] as const)
      expect((await create(await signIn(role, 'mobile'), operator(), uuidv7())).status, role).toBe(403);
    const noToken = await signIn('editor');
    noToken.panel.csrfToken = undefined;
    const csrf = await create(noToken, operator(), uuidv7());
    expect(csrf.status).toBe(403);
    expect(csrf.body).toMatchObject({ code: 'csrf_failed' });
    expect(await count('parties.parties')).toBe(0);
    expect(await count('platform.idempotency_records')).toBe(0);
  });

  it('EVM-021 AC6 EVM-036 AC7 there is no route that writes a single party by POST (404); the GET of /parties/{id} is the detail of EVM-036', async () => {
    const browser = await signIn('administrator');
    const body = operator();
    await create(browser, body);
    expect((await browser.panel.get(`${CREATE}/${body.id}`)).status).toBe(200);
    expect((await browser.panel.post(`${CREATE}/${body.id}`, {})).status).toBe(404);
  });
});

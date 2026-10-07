import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { clearCustomers, insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { uuidv7 } from '../support/uuid.ts';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  await clearCustomers(current.database.admin);
});

const CREATE = '/api/v1/customers';
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

const person = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  kind: 'person',
  firstName: 'Jan',
  lastName: 'Przykładowy',
  phone: '600 000 001',
  ...overrides,
});
const create = (browser: Browser, body: unknown, key?: string) => {
  const call = browser.panel.post(CREATE, body);
  return key === undefined ? call : call.set('Idempotency-Key', key);
};
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;
const count = async (table: 'customers.customers' | 'platform.idempotency_records') => {
  const { rows } =
    table === 'customers.customers'
      ? await sql<{ n: string }>`select count(*)::text as n from customers.customers`.execute(admin())
      : await sql<{ n: string }>`select count(*)::text as n from platform.idempotency_records`.execute(admin());
  return Number(rows[0]?.n);
};
const auditOf = async (objectId: string) =>
  (await sql<Record<string, unknown>>`select * from audit.events where object_id = ${objectId}`.execute(admin())).rows;

describe('adding a customer (EVM-020 AC2; SR-INPUT-01, SR-DATA-02)', () => {
  it('EVM-020 AC2 a person: 201 with the customer as the contract has it, the telephone in E.164, the e-mail in lower case, ETag, no-store', async () => {
    const browser = await signIn('editor');
    const body = person({
      email: 'Jan.Przykladowy@Example.TEST',
      notes: 'Dzwonić po 16:00\nParking podziemny',
      postalAddress: { street: 'Piotrkowska', buildingNumber: '1', apartmentNumber: '5', postalCode: '90-001', city: 'Łódź' },
    });
    const response = await create(browser, body, uuidv7());
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body).toEqual({
      id: body.id,
      kind: 'person',
      firstName: 'Jan',
      lastName: 'Przykładowy',
      phone: '+48600000001',
      email: 'jan.przykladowy@example.test',
      postalAddress: { street: 'Piotrkowska', buildingNumber: '1', apartmentNumber: '5', postalCode: '90-001', city: 'Łódź' },
      notes: 'Dzwonić po 16:00\nParking podziemny',
      displayName: 'Jan Przykładowy',
      version: 1,
      createdAt: expect.stringMatching(/^2026-10-01T08:00:00\.000Z$/) as unknown,
      updatedAt: expect.stringMatching(/^2026-10-01T08:00:00\.000Z$/) as unknown,
    });
    expect(response.headers['etag']).toBe('"1"');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['idempotent-replayed']).toBeUndefined();
    expect(response.headers['location']).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toMatch(/searchText|sortName|createdBy|updatedBy|deleted/);
    const { rows } = await sql<Record<string, unknown>>`select * from customers.customers where id = ${body.id}`.execute(admin());
    expect(rows[0]).toMatchObject({
      phone: '+48600000001',
      email: 'jan.przykladowy@example.test',
      city: 'Łódź',
      created_by: browser.userId,
      updated_by: browser.userId,
      version: 1,
      deleted_at: null,
    });
  });

  it('EVM-020 AC2 a company: name, NIP (PL, hyphens and spaces accepted — stored as 10 digits), contact person; the Administrator may add too', async () => {
    const browser = await signIn('administrator');
    const body = {
      id: uuidv7(),
      kind: 'company',
      companyName: 'Firma Testowa sp. z o.o.',
      taxId: 'PL 526-025-02-74',
      contactPersonName: 'Anna Kontaktowa',
      phone: '+48 600 000 002',
    };
    const response = await create(browser, body);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body).toMatchObject({
      kind: 'company',
      companyName: 'Firma Testowa sp. z o.o.',
      taxId: '5260250274',
      contactPersonName: 'Anna Kontaktowa',
      displayName: 'Firma Testowa sp. z o.o.',
    });
    expect(response.body).not.toHaveProperty('email');
    expect(response.body).not.toHaveProperty('postalAddress');
  });

  it('EVM-020 AC2 the new customer is found at once (the form selects it after the save)', async () => {
    const browser = await signIn('editor');
    expect(
      (await create(browser, person({ postalAddress: { street: 'Piotrkowska', buildingNumber: '1', postalCode: '90-001', city: 'Łódź' } })))
        .status,
    ).toBe(201);
    const found = await browser.panel.post('/api/v1/customers/search', { query: 'Lodz' });
    expect(found.body).toMatchObject({ items: [{ displayName: 'Jan Przykładowy', phone: '+48600000001' }] });
  });

  it('EVM-020 AC2 the errors of the fields are pointers and codes (every wrong field at once); the values never come back', async () => {
    const browser = await signIn('editor');
    const response = await create(
      browser,
      person({
        phone: 'sekretny-telefon',
        email: 'sekretny-email',
        notes: 'zły\u0000znak',
        postalAddress: { street: 'Piotrkowska', buildingNumber: '1', postalCode: '90-001', city: 'Łódź' },
      }),
    );
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'validation_failed' });
    expect(errorsOf(response.body)).toEqual([
      { pointer: '/phone', code: 'invalid_format' },
      { pointer: '/email', code: 'invalid_format' },
      { pointer: '/notes', code: 'invalid_characters' },
    ]);
    expect(JSON.stringify(response.body)).not.toMatch(/sekretny|zły/);
    const nip = await create(browser, { id: uuidv7(), kind: 'company', companyName: 'Firma', phone: '600000001', taxId: '5260250275' });
    expect(errorsOf(nip.body)).toEqual([{ pointer: '/taxId', code: 'invalid_format' }]);
    expect(await count('customers.customers')).toBe(0);
  });

  it('EVM-020 AC2 the rules of the kind: a person without names, a company without a name, fields of the other kind — 400 with the pointer of the field', async () => {
    const browser = await signIn('editor');
    expect(errorsOf((await create(browser, { id: uuidv7(), kind: 'person', phone: '600000001' })).body)).toEqual([
      { pointer: '/firstName', code: 'required' },
      { pointer: '/lastName', code: 'required' },
    ]);
    expect(errorsOf((await create(browser, person({ companyName: 'Firma' }))).body)).toEqual([
      { pointer: '/companyName', code: 'not_allowed_for_kind' },
    ]);
    expect(errorsOf((await create(browser, { id: uuidv7(), kind: 'company', phone: '600000001' })).body)).toEqual([
      { pointer: '/companyName', code: 'required' },
    ]);
    expect(
      errorsOf((await create(browser, { id: uuidv7(), kind: 'company', companyName: 'F', firstName: 'Jan', phone: '600000001' })).body),
    ).toEqual([{ pointer: '/firstName', code: 'not_allowed_for_kind' }]);
    expect(errorsOf((await create(browser, { id: uuidv7(), kind: 'osoba', phone: '600000001' })).body)).toEqual([
      { pointer: '/kind', code: 'invalid_value' },
    ]);
    expect(errorsOf((await create(browser, person({ phone: undefined }))).body)).toEqual([{ pointer: '/phone', code: 'required' }]);
  });

  it('EVM-020 AC2 the postal address needs street, building number, a code 00-000 and a city together', async () => {
    const browser = await signIn('editor');
    const partial = await create(browser, person({ postalAddress: { street: 'Piotrkowska' } }));
    expect(errorsOf(partial.body)).toEqual(
      expect.arrayContaining([
        { pointer: '/postalAddress/buildingNumber', code: 'required' },
        { pointer: '/postalAddress/postalCode', code: 'required' },
        { pointer: '/postalAddress/city', code: 'required' },
      ]),
    );
    const code = await create(
      browser,
      person({ postalAddress: { street: 'Piotrkowska', buildingNumber: '1', postalCode: '90001', city: 'Łódź' } }),
    );
    expect(errorsOf(code.body)).toEqual([{ pointer: '/postalAddress/postalCode', code: 'invalid_format' }]);
  });

  it('EVM-020 AC2 the audit trail has ONE event customer.created with the actor, the customer id, the trace and no personal data', async () => {
    const browser = await signIn('editor');
    const body = person({ email: 'jan@example.test', notes: 'notatka-poufna' });
    const response = await create(browser, body, uuidv7());
    expect(response.status).toBe(201);
    const events = await auditOf(body.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'customer.created',
      outcome: 'success',
      actor_type: 'user',
      actor_user_id: browser.userId,
      object_type: 'customer',
      object_id: body.id,
      origin: 'web',
    });
    expect(String(events[0]?.['trace_id'])).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(events)).not.toMatch(/Przykładowy|600000001|jan@example|notatka-poufna/);
  });

  it('EVM-020 AC2 nothing about the customer reaches the log of the API', async () => {
    const browser = await signIn('editor');
    const before = current.logs.lines.length;
    await create(browser, person({ email: 'logowany@example.test', notes: 'notatka-do-logu' }), uuidv7());
    await create(browser, person({ phone: 'zly' }));
    const lines = current.logs.lines.slice(before).join('\n');
    expect(lines).toContain(CREATE);
    expect(lines).not.toMatch(/Przykładowy|600000001|logowany@example|notatka-do-logu|zly/);
  });
});

describe('validation of the server (EVM-020 AC5; SR-AUTHZ-04, SR-INPUT-01, CWE-915)', () => {
  it('EVM-020 AC5 a field of the server is 400 validation_failed with the code read_only_field — searchText, createdAt, version and the rest; nothing is stored', async () => {
    const browser = await signIn('editor');
    const response = await create(
      browser,
      person({
        searchText: 'x',
        createdAt: '2026-01-01T00:00:00Z',
        version: 9,
        displayName: 'Podrobiony',
        sortName: 'x',
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
      [
        'createdAt',
        'createdBy',
        'deletedAt',
        'deletedBy',
        'displayName',
        'searchText',
        'sortName',
        'updatedAt',
        'updatedBy',
        'version',
      ].map((field) => ({ pointer: `/${field}`, code: 'read_only_field' })),
    );
    expect(JSON.stringify(response.body)).not.toContain('Podrobiony');
    expect(await count('customers.customers')).toBe(0);
  });

  it('EVM-020 AC5 a field outside the schema is unknown_field (also __proto__ and a field inside the address); nothing is stored', async () => {
    const browser = await signIn('editor');
    const response = await create(
      browser,
      person({ vip: true, postalAddress: { street: 'Piotrkowska', buildingNumber: '1', postalCode: '90-001', city: 'Łódź', version: 2 } }),
    );
    expect(errorsOf(response.body)).toEqual(
      expect.arrayContaining([
        { pointer: '/vip', code: 'unknown_field' },
        { pointer: '/postalAddress/version', code: 'unknown_field' },
      ]),
    );
    const proto = await browser.panel.post(
      CREATE,
      JSON.parse(
        `{"id":"${uuidv7()}","kind":"person","firstName":"J","lastName":"K","phone":"600000001","__proto__":{"role":"administrator"}}`,
      ),
    );
    expect(proto.status).toBe(400);
    expect(await count('customers.customers')).toBe(0);
  });

  it('EVM-020 AC5 a name over 200 characters (and notes over 2000) is 400 too_long; 200 passes', async () => {
    const browser = await signIn('editor');
    const long = await create(browser, person({ lastName: 'N'.repeat(201) }));
    expect(long.status).toBe(400);
    expect(errorsOf(long.body)).toEqual([{ pointer: '/lastName', code: 'too_long' }]);
    expect(errorsOf((await create(browser, person({ notes: 'n'.repeat(2001) }))).body)).toEqual([{ pointer: '/notes', code: 'too_long' }]);
    expect((await create(browser, person({ lastName: 'N'.repeat(200) }))).status).toBe(201);
  });

  it('EVM-020 AC5 the id must be a UUIDv7: another version or a text is 400 (never a 500 of the CHECK of the database)', async () => {
    const browser = await signIn('editor');
    for (const id of ['0198b0a0-0000-4000-8000-000000000001', 'not-a-uuid', 7]) {
      const response = await create(browser, person({ id }));
      expect(response.status, String(id)).toBe(400);
      expect(response.body).toMatchObject({ code: 'validation_failed' });
    }
    expect(errorsOf((await create(browser, person({ id: undefined }))).body)).toEqual([{ pointer: '/id', code: 'required' }]);
  });

  it('EVM-020 AC4 the Idempotency-Key must be a UUIDv7: another version or a text is 400', async () => {
    const browser = await signIn('editor');
    for (const key of ['0198b0a0-0000-4000-8000-000000000001', 'abc']) {
      const response = await create(browser, person(), key);
      expect(response.status, key).toBe(400);
      expect(response.body).toMatchObject({ code: 'validation_failed' });
    }
    expect(await count('customers.customers')).toBe(0);
  });
});

describe('a repeat without a duplicate (EVM-020 AC4; SR-API-05, AB-09)', () => {
  it('EVM-020 AC4 the same id, key and content: 201 again with Idempotent-Replayed: true, ONE customer, ONE audit event', async () => {
    const browser = await signIn('editor');
    const body = person({ email: 'jan@example.test' });
    const key = uuidv7();
    const first = await create(browser, body, key);
    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    const second = await create(browser, { ...body }, key);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.headers['etag']).toBe('"1"');
    expect(second.body).toEqual(first.body);
    expect(await count('customers.customers')).toBe(1);
    expect(await auditOf(body.id)).toHaveLength(1);
    expect(await count('platform.idempotency_records')).toBe(1);
  });

  it('EVM-020 AC4 the content in another order of keys is the same request', async () => {
    const browser = await signIn('editor');
    const key = uuidv7();
    const body = person();
    await create(browser, body, key);
    const reordered = Object.fromEntries(Object.entries(body).reverse());
    expect((await create(browser, reordered, key)).headers['idempotent-replayed']).toBe('true');
  });

  it('EVM-020 AC4 a repeat returns the customer as it is NOW (current representation), and 404 when it is no longer visible', async () => {
    const browser = await signIn('editor');
    const body = person();
    const key = uuidv7();
    await create(browser, body, key);
    await sql`update customers.customers set notes = 'zmienione', version = 2 where id = ${body.id}`.execute(admin());
    const replay = await create(browser, body, key);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toMatchObject({ notes: 'zmienione', version: 2 });
    expect(replay.headers['etag']).toBe('"2"');
    await sql`update customers.customers set deleted_at = now() where id = ${body.id}`.execute(admin());
    const gone = await create(browser, body, key);
    expect(gone.status).toBe(404);
    expect(gone.body).toMatchObject({ code: 'not_found' });
  });

  it('EVM-020 AC4 the same key with another content is 422 idempotency_mismatch (and counted); no second customer', async () => {
    const browser = await signIn('editor');
    const key = uuidv7();
    await create(browser, person(), key);
    const other = await create(browser, person({ phone: '600000002' }), key);
    expect(other.status).toBe(422);
    expect(other.body).toMatchObject({ code: 'idempotency_mismatch' });
    expect(await count('customers.customers')).toBe(1);
  });

  it('EVM-020 AC4 a parallel request with the same key is 409 idempotency_in_progress with Retry-After; after the first one it is a repeat', async () => {
    const browser = await signIn('editor');
    const body = person();
    const key = uuidv7();
    // another session holds the lock of the key — what a request in the middle of its transaction does
    const holder = admin()
      .transaction()
      .execute(async (tx) => {
        await sql`select pg_advisory_xact_lock(hashtextextended(${`idempotency|${browser.userId}||${key}`}, 0))`.execute(tx);
        const refused = await create(browser, body, key);
        expect(refused.status, JSON.stringify(refused.body)).toBe(409);
        expect(refused.body).toMatchObject({ code: 'idempotency_in_progress' });
        expect(refused.headers['retry-after']).toBe('1');
        expect(await count('customers.customers')).toBe(0);
      });
    await holder;
    const retried = await create(browser, body, key);
    expect(retried.status).toBe(201);
    expect(retried.headers['idempotent-replayed']).toBeUndefined();
  });

  it('EVM-020 AC4 an existing id is 409 id_conflict (also with another key, and without any key) — and nothing about the existing customer is in the answer', async () => {
    const browser = await signIn('editor');
    const body = person();
    await create(browser, body, uuidv7());
    const conflicting = person({ id: body.id, lastName: 'Zupelnie-Inny', phone: '600000009' });
    for (const key of [uuidv7(), undefined]) {
      const response = await create(browser, conflicting, key);
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'id_conflict' });
      expect(JSON.stringify(response.body)).not.toMatch(/Przykładowy|Zupelnie|600000001|600000009/);
    }
    expect(await count('customers.customers')).toBe(1);
    const row = (await sql<{ last_name: string }>`select last_name from customers.customers`.execute(admin())).rows[0];
    expect(row?.last_name).toBe('Przykładowy');
  });

  it('EVM-020 AC4 the id of a deleted customer is taken as well (INSERT only): 409 id_conflict', async () => {
    const browser = await signIn('editor');
    const id = await insertCustomer(admin(), { deletedAt: '2026-10-07T09:00:00Z' });
    const response = await create(browser, person({ id }), uuidv7());
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'id_conflict' });
  });

  it('EVM-020 AC4 a failed save leaves the key free: after 409 id_conflict the same key serves the next creation', async () => {
    const browser = await signIn('editor');
    const taken = await insertCustomer(admin(), {});
    const key = uuidv7();
    expect((await create(browser, person({ id: taken }), key)).status).toBe(409);
    expect(await count('platform.idempotency_records')).toBe(0);
    expect((await create(browser, person(), key)).status).toBe(201);
  });

  it('EVM-020 AC4 the key belongs to the user: ANOTHER user with the same key gets no result of the first one (a new customer; the id of the first one is a conflict without data)', async () => {
    const alice = await signIn('editor');
    const bob = await signIn('administrator');
    const key = uuidv7();
    const mine = person();
    await create(alice, mine, key);
    const own = person({ phone: '600000007' });
    const fresh = await create(bob, own, key);
    expect(fresh.status).toBe(201);
    expect(fresh.headers['idempotent-replayed']).toBeUndefined();
    expect(fresh.body).toMatchObject({ id: own.id, phone: '+48600000007' });
    const stolen = await create(bob, mine, uuidv7());
    expect(stolen.status).toBe(409);
    expect(JSON.stringify(stolen.body)).not.toMatch(/Przykładowy|600000001/);
    expect(await count('customers.customers')).toBe(2);
  });

  it('EVM-020 AC4 without a key the creation works (the key is optional on the web) and gives no record of idempotency', async () => {
    const browser = await signIn('editor');
    expect((await create(browser, person())).status).toBe(201);
    expect(await count('platform.idempotency_records')).toBe(0);
  });

  it('EVM-020 AC4 an expired key (30 days) is a new request: the same key serves another creation of the same user', async () => {
    const user = await createUser(admin(), current.clock, { role: 'editor' });
    const open = async () => {
      const session = await createSession(admin(), current.clock, user);
      const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
      panel.cookie = session.cookie;
      panel.csrfToken = session.csrfToken;
      return { userId: user.id, panel };
    };
    const key = uuidv7();
    expect((await create(await open(), person(), key)).status).toBe(201);
    current.clock.advance(31 * 24 * 3_600_000);
    const again = await create(await open(), person({ phone: '600000008' }), key);
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.headers['idempotent-replayed']).toBeUndefined();
    expect(await count('customers.customers')).toBe(2);
    expect(await count('platform.idempotency_records')).toBe(1); // overwritten, not duplicated
    current.clock.set('2026-10-01T08:00:00.000Z');
  });
});

describe('who may add a customer (EVM-020 AC7; SR-AUTHZ-01, SR-AUTHZ-02, SR-AUTHZ-05)', () => {
  it('EVM-020 AC7 Administrator and Editor 201; Read-only 403 forbidden — for any body, and without a record of idempotency or a customer', async () => {
    for (const role of ['administrator', 'editor'] as const)
      expect((await create(await signIn(role), person(), uuidv7())).status, role).toBe(201);
    const readOnly = await signIn('read_only');
    const valid = await create(readOnly, person(), uuidv7());
    expect(valid.status).toBe(403);
    expect(valid.body).toMatchObject({ code: 'forbidden' });
    const invalid = await create(readOnly, { zle: 'pole', searchText: 'x' }, uuidv7());
    expect(invalid.status).toBe(403); // not 400: the authorization comes before the validation
    expect(JSON.stringify(invalid.body)).not.toContain('errors');
    expect(await count('customers.customers')).toBe(2);
    expect(await count('platform.idempotency_records')).toBe(2);
  });

  it('EVM-020 AC7 no session is 401 (before any look at the body); the mobile channel is 403; no CSRF token is 403 csrf_failed', async () => {
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    for (const body of [person(), { zle: 'pole' }]) {
      const response = await anonymous.post(CREATE, body).set('Idempotency-Key', uuidv7());
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ code: 'unauthenticated' });
    }
    for (const role of ['administrator', 'editor'] as const)
      expect((await create(await signIn(role, 'mobile'), person(), uuidv7())).status, role).toBe(403);
    const noToken = await signIn('editor');
    noToken.panel.csrfToken = undefined;
    const csrf = await create(noToken, person(), uuidv7());
    expect(csrf.status).toBe(403);
    expect(csrf.body).toMatchObject({ code: 'csrf_failed' });
    expect(await count('customers.customers')).toBe(0);
    expect(await count('platform.idempotency_records')).toBe(0);
  });

  it('EVM-020 AC7 there is no route of a single customer yet: GET and POST on /customers/{id} are 404', async () => {
    const browser = await signIn('administrator');
    const body = person();
    await create(browser, body);
    expect((await browser.panel.get(`${CREATE}/${body.id}`)).status).toBe(404);
    expect((await browser.panel.post(`${CREATE}/${body.id}`, {})).status).toBe(404);
  });
});

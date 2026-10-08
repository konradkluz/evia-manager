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

const BASE = '/api/v1/customers';
const admin = () => current.database.admin;

async function signIn(role: Role = 'editor', channel: 'web' | 'mobile' = 'web') {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, { channel });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel, session };
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
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  tax_id: string | null;
  contact_person_name: string | null;
  phone: string;
  email: string | null;
  street: string | null;
  notes: string | null;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  updated_at: Date;
  created_at: Date;
}
async function rowOf(id: string): Promise<Row> {
  const { rows } = await sql<Row>`select first_name, last_name, company_name, tax_id, contact_person_name, phone, email, street, notes,
    version, created_by, updated_by, updated_at, created_at from customers.customers where id = ${id}`.execute(admin());
  const row = rows[0];
  if (row === undefined) throw new Error('no such customer');
  return row;
}
const auditOf = async (objectId: string) =>
  (await sql<Record<string, unknown>>`select * from audit.events where object_id = ${objectId} order by occurred_at, id`.execute(admin()))
    .rows;
const auditTotal = async (): Promise<number> =>
  Number(
    (await sql<{ n: string }>`select count(*)::text as n from audit.events where action = 'customer.updated'`.execute(admin())).rows[0]?.n,
  );

describe('the detail of a customer (EVM-039 AC2, AC6, AC7; SR-AUTHZ-02, SR-AUTHZ-05, SR-DATA-03)', () => {
  it('EVM-039 AC2 a person: the data, the address and the notes, an ETag of the version, no-store — for the three roles', async () => {
    const id = await insertCustomer(admin(), { email: 'jan@example.test', city: 'Łódź', notes: 'Kontakt po 16:00.' });
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const response = await get(await signIn(role), id);
      expect(response.status, role).toBe(200);
      expect(response.headers['etag']).toBe('"1"');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toEqual({
        id,
        kind: 'person',
        firstName: 'Jan',
        lastName: 'Przykładowy',
        phone: '+48600000001',
        email: 'jan@example.test',
        postalAddress: { street: 'Piotrkowska', buildingNumber: '1', postalCode: '90-001', city: 'Łódź' },
        notes: 'Kontakt po 16:00.',
        displayName: 'Jan Przykładowy',
        version: 1,
        createdAt: '2026-10-07T08:00:00.000Z',
        updatedAt: '2026-10-07T08:00:00.000Z',
      });
    }
  });

  it('EVM-039 AC2 a company: name, NIP, contact person; and never the search text, the sort key, the authors or the deletion mark', async () => {
    const id = await insertCustomer(admin(), { kind: 'company', companyName: 'Firma Testowa sp. z o.o.', taxId: '5260250274' });
    const response = await get(await signIn('read_only'), id);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ kind: 'company', companyName: 'Firma Testowa sp. z o.o.', taxId: '5260250274' });
    expect(Object.keys(response.body as object).sort()).toEqual(
      ['companyName', 'createdAt', 'displayName', 'id', 'kind', 'phone', 'taxId', 'updatedAt', 'version'].sort(),
    );
    expect(JSON.stringify(response.body)).not.toMatch(/searchText|sortName|createdBy|updatedBy|deletedAt|deletedBy/);
  });

  it('EVM-039 AC6 a customer who is soft deleted and one that never existed are the SAME 404 not_found for the Administrator, the Editor and Read-only', async () => {
    const deleted = await insertCustomer(admin(), { deletedAt: '2026-10-02T08:00:00Z' });
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
  });

  it('EVM-039 AC2 a malformed identifier is 400 validation_failed, not 404 and not 500', async () => {
    const browser = await signIn();
    for (const id of ['abc', '123', 'not-a-uuid-at-all']) {
      const response = await get(browser, id);
      expect(response.status, id).toBe(400);
      expect(codeOf(response.body)).toBe('validation_failed');
    }
  });

  it('EVM-039 AC7 an anonymous caller is 401 on the list, the detail, the search and the edit', async () => {
    const id = await insertCustomer(admin());
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    expect((await anonymous.get(BASE)).status).toBe(401);
    expect((await anonymous.get(`${BASE}/${id}`)).status).toBe(401);
    expect((await anonymous.post(`${BASE}/search`, { query: 'abc' })).status).toBe(401);
    expect((await anonymous.patch(`${BASE}/${id}`, { phone: '600 000 002' }, { 'If-Match': '"1"' })).status).toBe(401);
  });

  it('EVM-039 AC7 a mobile token is 403 forbidden (channel outside the policy) on the list, the detail, the search and the edit (web only)', async () => {
    const id = await insertCustomer(admin());
    const mobile = await signIn('editor', 'mobile');
    for (const response of [
      await mobile.panel.get(BASE),
      await mobile.panel.get(`${BASE}/${id}`),
      await mobile.panel.post(`${BASE}/search`, { query: 'abc' }),
      await patch(mobile, id, { phone: '600 000 002' }),
    ]) {
      expect(response.status).toBe(403);
      expect(codeOf(response.body)).toBe('forbidden');
    }
    expect((await rowOf(id)).version).toBe(1);
  });
});

describe('the edit of a customer (EVM-039 AC3, AC4, AC7; SR-INPUT-01, SR-INPUT-05, SR-AUTHZ-04, SR-API-06)', () => {
  it('EVM-039 AC3 A1″ a new telephone and a new e-mail: normalised like at the creation (E.164, lower case), version + 1, a new ETag, the author of the change', async () => {
    const id = await insertCustomer(admin());
    const editor = await signIn('editor');
    const response = await patch(editor, id, { phone: '+48 (600) 000-222', email: 'Jan.Przykladowy@Example.TEST' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['etag']).toBe('"2"');
    expect(response.headers['idempotent-replayed']).toBeUndefined();
    expect(response.body).toMatchObject({ id, phone: '+48600000222', email: 'jan.przykladowy@example.test', version: 2, firstName: 'Jan' });
    expect(await rowOf(id)).toMatchObject({
      phone: '+48600000222',
      email: 'jan.przykladowy@example.test',
      version: 2,
      updated_by: editor.userId,
    });
    expect(((await get(editor, id)).body as { version: number }).version).toBe(2);
  });

  it('EVM-039 AC7 the Administrator edits as well; the data of the author and of the creation stay', async () => {
    const id = await insertCustomer(admin());
    const before = await rowOf(id);
    const administrator = await signIn('administrator');
    expect((await patch(administrator, id, { notes: 'Nowa notatka.' })).status).toBe(200);
    const after = await rowOf(id);
    expect(after).toMatchObject({ notes: 'Nowa notatka.', version: 2, updated_by: administrator.userId, created_by: before.created_by });
    expect(after.created_at).toEqual(before.created_at);
  });

  it('EVM-039 AC3 a field that is absent stays; null clears an optional field (e-mail, notes, address); the telephone cannot be cleared', async () => {
    const id = await insertCustomer(admin(), { email: 'jan@example.test', notes: 'notatka', city: 'Łódź' });
    const editor = await signIn('editor');
    const cleared = await patch(editor, id, { email: null, notes: null, postalAddress: null });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(await rowOf(id)).toMatchObject({ email: null, notes: null, street: null, phone: '+48600000001', first_name: 'Jan' });
    expect(Object.keys(cleared.body as object)).not.toContain('email');
    const phone = await patch(editor, id, { phone: null }, { ifMatch: '"2"' });
    expect(phone.status).toBe(400);
    expect(errorsOf(phone.body)).toEqual([{ pointer: '/phone', code: 'invalid_type' }]);
  });

  it('EVM-039 AC3 an address is set whole: a partial one is refused, a whole one saved', async () => {
    const id = await insertCustomer(admin());
    const editor = await signIn('editor');
    const partial = await patch(editor, id, { postalAddress: { street: 'Piotrkowska' } });
    expect(partial.status).toBe(400);
    const whole = await patch(editor, id, {
      postalAddress: { street: 'Piotrkowska', buildingNumber: '12', apartmentNumber: '3', postalCode: '90-001', city: 'Łódź' },
    });
    expect(whole.status).toBe(200);
    expect((whole.body as { postalAddress: unknown }).postalAddress).toEqual({
      street: 'Piotrkowska',
      buildingNumber: '12',
      apartmentNumber: '3',
      postalCode: '90-001',
      city: 'Łódź',
    });
  });

  it('EVM-039 AC3 the rules of the creation apply: a telephone, an e-mail, a NIP, a postal code — errors are a pointer and a code, never the value', async () => {
    const id = await insertCustomer(admin(), { kind: 'company', companyName: 'Firma Testowa sp. z o.o.', taxId: '5260250274' });
    const editor = await signIn('editor');
    const response = await patch(editor, id, { phone: '12345', email: 'zly-adres-poufny', taxId: '1234567890' });
    expect(response.status).toBe(400);
    expect(codeOf(response.body)).toBe('validation_failed');
    expect(errorsOf(response.body)).toEqual(
      expect.arrayContaining([
        { pointer: '/phone', code: 'invalid_format' },
        { pointer: '/email', code: 'invalid_format' },
        { pointer: '/taxId', code: 'invalid_format' },
      ]),
    );
    const postalCode = await patch(editor, id, {
      postalAddress: { street: 'Piotrkowska', buildingNumber: '1', postalCode: '90001', city: 'Łódź' },
    });
    expect(errorsOf(postalCode.body)).toEqual([{ pointer: '/postalAddress/postalCode', code: 'invalid_format' }]);
    expect(JSON.stringify([response.body, postalCode.body])).not.toMatch(/12345|zly-adres|1234567890|90001/);
    expect(await rowOf(id)).toMatchObject({ phone: '+48600000001', email: null, tax_id: '5260250274', version: 1 });
  });

  it('EVM-039 AC3 a NIP with the prefix PL and separators is saved as 10 digits; a company may drop its NIP and contact person with null', async () => {
    const id = await insertCustomer(admin(), { kind: 'company', companyName: 'Firma Testowa sp. z o.o.' });
    const editor = await signIn('editor');
    const set = await patch(editor, id, { taxId: 'PL 526-025-02-74', contactPersonName: 'Anna Kontaktowa' });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(await rowOf(id)).toMatchObject({ tax_id: '5260250274', contact_person_name: 'Anna Kontaktowa' });
    const dropped = await patch(editor, id, { taxId: null, contactPersonName: null }, { ifMatch: '"2"' });
    expect(dropped.status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ tax_id: null, contact_person_name: null, version: 3 });
  });

  it('EVM-039 AC3 a change of kind drops the fields of the previous kind and needs the ones of the new: a person becomes a company only with a name', async () => {
    const id = await insertCustomer(admin(), { email: 'jan@example.test' });
    const editor = await signIn('editor');
    const missing = await patch(editor, id, { kind: 'company' });
    expect(missing.status).toBe(400);
    expect(errorsOf(missing.body)).toEqual([{ pointer: '/companyName', code: 'required' }]);
    const stranger = await patch(editor, id, { kind: 'company', companyName: 'Firma Nowa sp. z o.o.', firstName: 'Jan' });
    expect(errorsOf(stranger.body)).toEqual([{ pointer: '/firstName', code: 'not_allowed_for_kind' }]);
    const converted = await patch(editor, id, { kind: 'company', companyName: 'Firma Nowa sp. z o.o.' });
    expect(converted.status, JSON.stringify(converted.body)).toBe(200);
    expect(converted.body).toMatchObject({
      kind: 'company',
      companyName: 'Firma Nowa sp. z o.o.',
      displayName: 'Firma Nowa sp. z o.o.',
      email: 'jan@example.test',
    });
    expect(Object.keys(converted.body as object)).not.toContain('firstName');
    expect(await rowOf(id)).toMatchObject({ first_name: null, last_name: null, company_name: 'Firma Nowa sp. z o.o.' });
  });

  it('EVM-039 AC4 a field outside the schema is 400 unknown_field, also inside the address', async () => {
    const id = await insertCustomer(admin());
    const editor = await signIn('editor');
    const response = await patch(editor, id, {
      phone: '600 000 002',
      role: 'administrator',
      postalAddress: { street: 'A', buildingNumber: '1', postalCode: '90-001', city: 'Łódź', x: 1 },
    });
    expect(response.status).toBe(400);
    expect(errorsOf(response.body)).toEqual(
      expect.arrayContaining([
        { pointer: '/role', code: 'unknown_field' },
        { pointer: '/postalAddress/x', code: 'unknown_field' },
      ]),
    );
    expect(await rowOf(id)).toMatchObject({ phone: '+48600000001', version: 1 });
  });

  it('EVM-039 AC4 every field controlled by the server — id, displayName, sortName, searchText, version, the dates and authors, the deletion — is 400 read_only_field', async () => {
    const id = await insertCustomer(admin());
    const editor = await signIn('editor');
    const fields: Record<string, unknown> = {
      id: uuidv7(),
      displayName: 'Podrobiona Nazwa',
      sortName: 'Podrobiona',
      searchText: 'podrobiona',
      version: 99,
      createdAt: '2026-01-01T00:00:00Z',
      createdBy: uuidv7(),
      updatedAt: '2026-01-01T00:00:00Z',
      updatedBy: uuidv7(),
      deletedAt: '2026-01-01T00:00:00Z',
      deletedBy: uuidv7(),
    };
    for (const [field, value] of Object.entries(fields)) {
      const response = await patch(editor, id, { [field]: value });
      expect(response.status, field).toBe(400);
      expect(codeOf(response.body)).toBe('validation_failed');
      expect(errorsOf(response.body), field).toEqual([{ pointer: `/${field}`, code: 'read_only_field' }]);
    }
    const all = await patch(editor, id, fields);
    expect(errorsOf(all.body)?.every((error) => error.code === 'read_only_field')).toBe(true);
    expect(await rowOf(id)).toMatchObject({ version: 1, updated_by: null });
  });

  it('EVM-039 AC4 a body that is not an object, an invalid JSON and a wrong type are 400 with a pointer and a code', async () => {
    const id = await insertCustomer(admin());
    const editor = await signIn('editor');
    for (const body of [[], 'tekst', 42, { phone: 600000001 }, { kind: 'robot' }, { notes: 'a'.repeat(2001) }]) {
      const response = await patch(editor, id, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    const broken = await editor.panel
      .patch(`${BASE}/${id}`, undefined, { 'If-Match': '"1"', 'Content-Type': 'application/json' })
      .send('{"phone":');
    expect(broken.status).toBe(400);
  });

  it('EVM-039 AC3 If-Match: absent is 428, weak / a list / * / malformed is 400 pointing at the header, whether or not the customer exists', async () => {
    const id = await insertCustomer(admin());
    const editor = await signIn('editor');
    for (const target of [id, uuidv7()]) {
      const absent = await patch(editor, target, { phone: '600 000 002' }, { ifMatch: null });
      expect(absent.status).toBe(428);
      expect(codeOf(absent.body)).toBe('precondition_required');
      for (const ifMatch of ['W/"1"', '"1", "2"', '*', '1', '"0"', '"abc"']) {
        const response = await patch(editor, target, { phone: '600 000 002' }, { ifMatch });
        expect(response.status, ifMatch).toBe(400);
        expect(errorsOf(response.body)).toEqual([{ pointer: '/headers/If-Match', code: 'invalid_format' }]);
      }
    }
    expect((await rowOf(id)).version).toBe(1);
  });

  it('EVM-039 AC3 a stale If-Match is 412 version_conflict: the data are untouched, the answer carries no current value', async () => {
    const id = await insertCustomer(admin(), { email: 'jan@example.test' });
    const editor = await signIn('editor');
    expect((await patch(editor, id, { email: 'inny@example.test' })).status).toBe(200); // version 2
    const stale = await patch(editor, id, { phone: '600 000 333', notes: 'wartosc-poufna' }, { ifMatch: '"1"' });
    expect(stale.status).toBe(412);
    expect(codeOf(stale.body)).toBe('version_conflict');
    expect(JSON.stringify(stale.body)).not.toMatch(/inny@example|600000|wartosc-poufna|"version":/);
    expect(await rowOf(id)).toMatchObject({ phone: '+48600000001', notes: null, email: 'inny@example.test', version: 2 });
    expect((await auditOf(id)).length).toBe(1); // only the successful change
  });

  it('EVM-039 AC6 SR-AUTHZ-02 a deleted customer with a STALE If-Match is 404 — never 412 (no oracle of existence); the same body as for a customer that never existed', async () => {
    const deleted = await insertCustomer(admin(), { deletedAt: '2026-10-02T08:00:00Z' });
    const answers: string[] = [];
    for (const role of ['administrator', 'editor'] as const) {
      const browser = await signIn(role);
      for (const target of [deleted, uuidv7()]) {
        for (const body of [{ phone: '600 000 002' }, { phone: 'zly' }]) {
          const response = await patch(browser, target, body, { ifMatch: '"7"' });
          expect(response.status, `${role} ${JSON.stringify(body)}`).toBe(404);
          expect(codeOf(response.body)).toBe('not_found');
          answers.push(withoutTrace(response.body));
        }
      }
    }
    expect(new Set(answers).size).toBe(1);
    expect((await rowOf(deleted)).version).toBe(1);
    // the SHAPE of a body is checked before the database is asked: a malformed body is 400 for a deleted and a made-up customer alike
    const editor = await signIn('editor');
    for (const target of [deleted, uuidv7()]) {
      const response = await patch(editor, target, { displayName: 'x' }, { ifMatch: '"7"' });
      expect(response.status).toBe(400);
      expect(errorsOf(response.body)).toEqual([{ pointer: '/displayName', code: 'read_only_field' }]);
    }
  });

  it('EVM-039 AC3 two edits with the SAME ETag at once: one is 200, the other 412, and the version rose by one', async () => {
    const id = await insertCustomer(admin());
    const editor = await signIn('editor');
    const other = await signIn('administrator');
    const [first, second] = await Promise.all([patch(editor, id, { phone: '600 000 111' }), patch(other, id, { phone: '600 000 222' })]);
    expect([first.status, second.status].sort()).toEqual([200, 412]);
    const row = await rowOf(id);
    expect(row.version).toBe(2);
    expect(['+48600000111', '+48600000222']).toContain(row.phone);
    expect(await auditOf(id)).toHaveLength(1);
  });

  it('EVM-039 AC7 SR-LOG-03 the audit trail has ONE customer.updated with the actor, the customer, the outcome and the trace — and no field and no value', async () => {
    const id = await insertCustomer(admin(), { email: 'stary@example.test', notes: 'stara-notatka' });
    const editor = await signIn('editor');
    expect((await patch(editor, id, { phone: '600 000 555', email: 'nowy@example.test', notes: 'nowa-notatka' })).status).toBe(200);
    const events = await auditOf(id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'customer.updated',
      outcome: 'success',
      actor_type: 'user',
      actor_user_id: editor.userId,
      object_type: 'customer',
      object_id: id,
      origin: 'web',
    });
    expect(String(events[0]?.['trace_id'])).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(events)).not.toMatch(
      /600000555|nowy@example|stary@example|nowa-notatka|stara-notatka|Przykładowy|phone|email|notes/,
    );
  });

  it('EVM-039 AC3 an error rolls everything back: no audit event, no new version, and no idempotency record that would block the retry', async () => {
    const id = await insertCustomer(admin());
    const editor = await signIn('editor');
    const key = uuidv7();
    const total = await auditTotal();
    const failed = await patch(editor, id, { phone: 'zly' }, { key });
    expect(failed.status).toBe(400);
    expect(await auditTotal()).toBe(total);
    expect((await rowOf(id)).version).toBe(1);
    const retry = await patch(editor, id, { phone: '600 000 777' }, { key });
    expect(retry.status).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
  });

  it('EVM-039 AC3 nothing about the customer reaches the log of the API — not the telephone, the e-mail, the notes, nor a rejected value', async () => {
    const id = await insertCustomer(admin(), { email: 'stary@example.test' });
    const editor = await signIn('editor');
    const before = current.logs.lines.length;
    await patch(editor, id, { phone: '600 000 888', email: 'sekretny.adres@example.test', notes: 'sekretna-notatka-xyz' });
    await patch(editor, id, { phone: '999 sekret', email: 'zly-sekret' }, { ifMatch: '"2"' });
    await patch(editor, id, { phone: '600 000 999' }, { ifMatch: '"1"' }); // 412
    await get(editor, id);
    const lines = current.logs.lines.slice(before).join('\n');
    expect(lines).not.toMatch(/600000888|600 000 888|sekretny|sekretna|sekret|600000999|stary@example|Przykładowy/);
  });
});

describe('the idempotency of the edit (EVM-039 AC3; SR-API-05, ASVS V2.3.3, CWE-639)', () => {
  it('EVM-039 AC3 a repeat (same key, customer and body) answers 200 with the current customer and Idempotent-Replayed, with no second change and no second audit event — also with a stale If-Match', async () => {
    const id = await insertCustomer(admin());
    const editor = await signIn('editor');
    const key = uuidv7();
    const first = await patch(editor, id, { phone: '600 000 444' }, { key });
    expect(first.status).toBe(200);
    for (const ifMatch of ['"1"', '"2"']) {
      const again = await patch(editor, id, { phone: '600 000 444' }, { key, ifMatch });
      expect(again.status, ifMatch).toBe(200);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.headers['etag']).toBe('"2"');
      expect(again.body).toEqual(first.body);
    }
    expect((await rowOf(id)).version).toBe(2);
    expect(await auditOf(id)).toHaveLength(1);
  });

  it('EVM-039 AC3 the same key with another body is 422 idempotency_mismatch', async () => {
    const id = await insertCustomer(admin());
    const editor = await signIn('editor');
    const key = uuidv7();
    expect((await patch(editor, id, { phone: '600 000 444' }, { key })).status).toBe(200);
    const other = await patch(editor, id, { phone: '600 000 555' }, { key, ifMatch: '"2"' });
    expect(other.status).toBe(422);
    expect(codeOf(other.body)).toBe('idempotency_mismatch');
    expect((await rowOf(id)).phone).toBe('+48600000444');
  });

  it('EVM-039 AC3 A2 the key is bound to the CUSTOMER: the same key and the same body for ANOTHER customer is 422 idempotency_mismatch, never a replay of the first answer', async () => {
    const first = await insertCustomer(admin(), { lastName: 'Pierwszy' });
    const second = await insertCustomer(admin(), { lastName: 'Drugi' });
    const editor = await signIn('editor');
    const key = uuidv7();
    expect((await patch(editor, first, { phone: '600 000 444' }, { key })).status).toBe(200);
    const response = await patch(editor, second, { phone: '600 000 444' }, { key });
    expect(response.status).toBe(422);
    expect(codeOf(response.body)).toBe('idempotency_mismatch');
    expect(JSON.stringify(response.body)).not.toMatch(/Pierwszy|600000444/);
    expect(await rowOf(second)).toMatchObject({ phone: '+48600000001', version: 1 });
  });

  it('EVM-039 AC3 a repeat for a customer deleted in the meantime is 404 (the answer is read with the read policy), and the key of one user is not the key of another', async () => {
    const id = await insertCustomer(admin());
    const editor = await signIn('editor');
    const key = uuidv7();
    expect((await patch(editor, id, { phone: '600 000 444' }, { key })).status).toBe(200);
    const other = await signIn('administrator');
    expect((await patch(other, id, { phone: '600 000 666' }, { key, ifMatch: '"2"' })).status).toBe(200); // a new key for this user
    await sql`update customers.customers set deleted_at = now() where id = ${id}`.execute(admin());
    const gone = await patch(editor, id, { phone: '600 000 444' }, { key });
    expect(gone.status).toBe(404);
    expect(codeOf(gone.body)).toBe('not_found');
  });

  it('EVM-039 AC3 an Idempotency-Key that is not a UUIDv7 is 400', async () => {
    const id = await insertCustomer(admin());
    const editor = await signIn('editor');
    const response = await patch(editor, id, { phone: '600 000 444' }, { key: '0198b0a0-0000-4000-8000-000000000001' });
    expect(response.status).toBe(400);
  });
});

describe('who may edit (EVM-039 AC7; SR-AUTHZ-01, SR-AUTHZ-05, SR-AUTHZ-06, SR-API-07)', () => {
  it('EVM-039 AC7 Read-only is 403 forbidden on a PATCH whatever it carries — a good body, a bad one, no If-Match, a made-up id — before anything else is looked at', async () => {
    const id = await insertCustomer(admin());
    const reader = await signIn('read_only');
    const total = await auditTotal();
    for (const [target, body, ifMatch] of [
      [id, { phone: '600 000 002' }, '"1"'],
      [id, { phone: 'zly', displayName: 'x', nieznane: 1 }, '"1"'],
      [id, { phone: '600 000 002' }, null],
      [id, { phone: '600 000 002' }, 'W/"1"'],
      [uuidv7(), { phone: '600 000 002' }, '"1"'],
    ] as const) {
      const response = await patch(reader, target, body, { ifMatch });
      expect(response.status, JSON.stringify(body)).toBe(403);
      expect(codeOf(response.body)).toBe('forbidden');
    }
    expect(await rowOf(id)).toMatchObject({ phone: '+48600000001', version: 1 });
    expect(await auditTotal()).toBe(total);
  });

  it('EVM-039 AC7 Read-only reads: the list, the detail and the search are 200', async () => {
    const id = await insertCustomer(admin());
    const reader = await signIn('read_only');
    expect((await reader.panel.get(BASE)).status).toBe(200);
    expect((await get(reader, id)).status).toBe(200);
    expect((await reader.panel.post(`${BASE}/search`, { query: 'przykl' })).status).toBe(200);
  });

  it('EVM-039 AC7 a missing, a wrong or a foreign-origin CSRF token is 403 csrf_failed; the customer is untouched', async () => {
    const id = await insertCustomer(admin());
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
      const response = await client.patch(`${BASE}/${id}`, { phone: '600 000 002' }, { 'If-Match': '"1"' });
      expect(response.status).toBe(403);
      expect(codeOf(response.body)).toBe('csrf_failed');
    }
    expect((await rowOf(id)).version).toBe(1);
  });
});

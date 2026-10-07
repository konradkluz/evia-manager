import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { METRICS } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { MINUTE } from '../support/clock.ts';
import { clearCustomers, insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';

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

const SEARCH = '/api/v1/customers/search';

/** A signed-in browser of a NEW user of the role (every user has their own search limit and mass-read window). */
async function signIn(role: Role = 'editor', channel: 'web' | 'mobile' = 'web') {
  const user = await createUser(current.database.admin, current.clock, { role });
  const session = await createSession(current.database.admin, current.clock, user, { channel });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;
const search = (browser: Browser, query: unknown) => browser.panel.post(SEARCH, { query });
interface Item {
  id: string;
  displayName: string;
  phone: string;
}
const found = async (browser: Browser, query: string): Promise<Item[]> => {
  const response = await search(browser, query);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return (response.body as { items: Item[] }).items;
};
const names = (items: Item[]): string[] => items.map((item) => item.displayName);
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;

describe('search by a phrase (EVM-020 AC1, AC3; SR-API-04, SR-INPUT-03)', () => {
  it('EVM-020 AC1 "Lodz" finds the customer from Łódź, "przykl" Jan Przykładowy; case and Polish letters do not matter', async () => {
    await insertCustomer(current.database.admin, { city: 'Łódź' });
    await insertCustomer(current.database.admin, {
      kind: 'company',
      companyName: 'Firma Testowa sp. z o.o.',
      phone: '+48600000002',
      city: 'Gdańsk',
    });
    const browser = await signIn();
    expect(names(await found(browser, 'Lodz'))).toEqual(['Jan Przykładowy']);
    expect(names(await found(browser, 'ŁÓDŹ'))).toEqual(['Jan Przykładowy']);
    expect(names(await found(browser, 'przykl'))).toEqual(['Jan Przykładowy']);
    expect(names(await found(browser, 'PRZYKŁADOWY'))).toEqual(['Jan Przykładowy']);
    expect(names(await found(browser, 'firma test'))).toEqual(['Firma Testowa sp. z o.o.']);
    expect(names(await found(browser, 'gdansk'))).toEqual(['Firma Testowa sp. z o.o.']);
    expect(await found(browser, 'nikt takiego')).toEqual([]);
  });

  it('EVM-020 AC1 the result is the list envelope with id, displayName and phone — and nothing else (no e-mail, NIP, address, notes, search text)', async () => {
    const id = await insertCustomer(current.database.admin, {
      kind: 'company',
      companyName: 'Firma Testowa sp. z o.o.',
      taxId: '5260250274',
      email: 'biuro@example.test',
      city: 'Łódź',
      notes: 'notatka-poufna',
    });
    const response = await search(await signIn('read_only'), 'firma');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [{ id, displayName: 'Firma Testowa sp. z o.o.', phone: '+48600000001' }], nextCursor: null });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(response.body)).not.toMatch(/biuro@example|5260250274|notatka-poufna|Piotrkowska/);
  });

  it('EVM-020 AC1 the search covers first name, surname, company, NIP, the digits of the telephone, e-mail and city — not the notes', async () => {
    await insertCustomer(current.database.admin, {
      firstName: 'Zofia',
      lastName: 'Nowakowska',
      email: 'zofia.n@example.test',
      city: 'Wrocław',
      notes: 'klucz-w-notatce',
    });
    await insertCustomer(current.database.admin, {
      kind: 'company',
      companyName: 'Elektro Bis',
      taxId: '5260250274',
      phone: '+48600000003',
    });
    const browser = await signIn();
    for (const phrase of ['zofia', 'nowakowska', 'zofia.n@example', 'wroclaw', 'elektro', '5260250274', '526-025-02-74', '600000003'])
      expect(await found(browser, phrase), phrase).toHaveLength(1);
    expect(await found(browser, 'klucz-w-notatce')).toEqual([]);
  });

  it('EVM-020 AC3 a telephone is found however it is written: +48 600 000 001, 600000001, 600 000 001, (48) 600-000-001, 0048600000001', async () => {
    const id = await insertCustomer(current.database.admin, { phone: '+48600000001' });
    await insertCustomer(current.database.admin, { phone: '+48600000999', lastName: 'Inny' });
    const browser = await signIn();
    for (const phrase of ['+48 600 000 001', '600000001', '600 000 001', '(48) 600-000-001', '0048600000001'])
      expect(
        (await found(browser, phrase)).map((item) => item.id),
        phrase,
      ).toEqual([id]);
  });

  it('EVM-020 AC3 the same surname finds the customer (the "similar customer" prompt)', async () => {
    const id = await insertCustomer(current.database.admin, { lastName: 'Przykładowy' });
    expect((await found(await signIn('editor'), 'Przykładowy')).map((item) => item.id)).toEqual([id]);
  });

  it('EVM-020 AC1 % and _ and the backslash are matched literally, never as a pattern', async () => {
    await insertCustomer(current.database.admin, { kind: 'company', companyName: 'Rabat 100% Prąd', phone: '+48600000011' });
    await insertCustomer(current.database.admin, { kind: 'company', companyName: 'Moto_Bis', phone: '+48600000012' });
    await insertCustomer(current.database.admin, { kind: 'company', companyName: 'MotoXBis', phone: '+48600000013' });
    await insertCustomer(current.database.admin, { kind: 'company', companyName: 'Ścieżka\\Bis', phone: '+48600000014' });
    const browser = await signIn();
    expect(names(await found(browser, '100%'))).toEqual(['Rabat 100% Prąd']);
    expect(await found(browser, '%%%')).toEqual([]);
    expect(await found(browser, '___')).toEqual([]);
    expect(names(await found(browser, 'moto_bis'))).toEqual(['Moto_Bis']);
    expect(names(await found(browser, 'ścieżka\\bis'))).toEqual(['Ścieżka\\Bis']);
    expect(await found(browser, 'moto\\_bis')).toEqual([]);
  });

  it('EVM-020 AC1 full-width look-alikes of % _ and the backslash (which unaccent maps to ASCII) are literal, never a pattern', async () => {
    await insertCustomer(current.database.admin, { kind: 'company', companyName: 'Moto_Bis', phone: '+48600000011' });
    await insertCustomer(current.database.admin, { kind: 'company', companyName: 'MotoXBis', phone: '+48600000012' });
    const browser = await signIn();
    for (const phrase of ['％％％', '﹪﹪﹪', '＿＿＿', 'abc＼', 'abc﹨']) expect(await found(browser, phrase), phrase).toEqual([]);
    expect(names(await found(browser, 'moto＿bis'))).toEqual(['Moto_Bis']);
  });

  it('EVM-020 AC1 a phrase shorter than 3 characters (after NFC and trim) is 400 validation_failed with the code too_short — and the phrase is not in the answer', async () => {
    const browser = await signIn();
    for (const phrase of ['ab', '  ab ', '', '   ']) {
      const response = await search(browser, phrase);
      expect(response.status, phrase).toBe(400);
      expect(response.body).toMatchObject({ code: 'validation_failed' });
      expect(errorsOf(response.body)).toEqual([{ pointer: '/query', code: 'too_short' }]);
    }
    const long = await search(browser, 'x'.repeat(101));
    expect(errorsOf(long.body)).toEqual([{ pointer: '/query', code: 'too_long' }]);
    const huge = await search(browser, 'x'.repeat(201));
    expect(huge.status).toBe(400);
    expect(errorsOf(huge.body)).toEqual([{ pointer: '/query', code: 'too_long' }]);
  });

  it('EVM-020 AC1 the body is strict: an unknown field, a missing or non-text phrase, a control character is 400', async () => {
    const browser = await signIn();
    const post = (body: unknown) => browser.panel.post(SEARCH, body);
    expect(errorsOf((await post({ query: 'Lodz', limit: 500 })).body)).toEqual([{ pointer: '/limit', code: 'unknown_field' }]);
    expect(errorsOf((await post({})).body)).toEqual([{ pointer: '/query', code: 'required' }]);
    expect(errorsOf((await post({ query: 42 })).body)).toEqual([{ pointer: '/query', code: 'invalid_type' }]);
    expect(errorsOf((await post({ query: 'ab\u0000cd' })).body)).toEqual([{ pointer: '/query', code: 'invalid_characters' }]);
    expect((await post(undefined as unknown as object)).status).toBe(400);
  });

  it('EVM-020 AC1 at most 20 results, in the order of the sort name (surname first, ICU pl-PL: Ł after L), then identifier', async () => {
    for (let index = 0; index < 25; index += 1)
      await insertCustomer(current.database.admin, { lastName: `Seria${String(index).padStart(2, '0')}`, firstName: 'Ola' });
    const browser = await signIn();
    const items = await found(browser, 'seria');
    expect(items).toHaveLength(20);
    expect(names(items)[0]).toBe('Ola Seria00');
    expect(names(items)[19]).toBe('Ola Seria19');
    await clearCustomers(current.database.admin);
    for (const lastName of ['Mazur', 'Łukasiewicz', 'Lis', 'Zawada'])
      await insertCustomer(current.database.admin, { lastName, firstName: 'Ola Test' });
    expect(names(await found(browser, 'ola test'))).toEqual(['Ola Test Lis', 'Ola Test Łukasiewicz', 'Ola Test Mazur', 'Ola Test Zawada']);
  });

  it('EVM-020 AC1 the phrase is in the body only: it is not in the URL, the request log, the answer of an error or a metric', async () => {
    await insertCustomer(current.database.admin, { lastName: 'Sekretny' });
    const browser = await signIn();
    const before = current.logs.lines.length;
    await found(browser, 'Sekretny-Wyraz');
    await search(browser, 'zz'); // too short: its error has the pointer and the code only
    const tooShort = await search(browser, 'sekretna fraza');
    expect(tooShort.status).toBe(200);
    const lines = current.logs.lines.slice(before).join('\n');
    expect(lines).toContain(SEARCH);
    expect(lines).not.toMatch(/Sekretny-Wyraz|sekretna fraza|Sekretny|600000001/i);
    const metrics = JSON.stringify(current.app.get<MetricsRegistry>(METRICS, { strict: false }).snapshot());
    expect(metrics).not.toMatch(/Sekretny|sekretna|600000001/i);
    const refusal = await search(browser, 'zz');
    expect(JSON.stringify(refusal.body)).not.toContain('zz"');
  });
});

describe('who finds which customer (EVM-020 AC7; SR-AUTHZ-02, SR-AUTHZ-03)', () => {
  it('EVM-020 AC7 Administrator, Editor and Read-only search: 200; a deleted customer (soft delete) is found by none of them — also by the phone and in the "similar customer" prompt', async () => {
    await insertCustomer(current.database.admin, { firstName: 'Anna', lastName: 'Widoczna', phone: '+48600000021' });
    await insertCustomer(current.database.admin, {
      firstName: 'Adam',
      lastName: 'Usunięty',
      phone: '+48600000022',
      deletedAt: '2026-10-07T09:00:00Z',
    });
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const browser = await signIn(role);
      expect(names(await found(browser, 'widoczna')), role).toEqual(['Anna Widoczna']);
      expect(await found(browser, 'usunięty'), role).toEqual([]);
      expect(await found(browser, 'usuniety'), role).toEqual([]);
      expect(await found(browser, '600000022'), role).toEqual([]);
      expect(await found(browser, '+48 600 000 022'), role).toEqual([]);
    }
  });

  it('EVM-020 AC7 no session is 401; a session of the mobile channel is 403; a request without the CSRF token is 403 csrf_failed — whatever the body', async () => {
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    const refused = await anonymous.post(SEARCH, { query: 'Lodz' });
    expect(refused.status).toBe(401);
    expect(refused.body).toMatchObject({ code: 'unauthenticated' });
    expect((await anonymous.post(SEARCH, { zly: 1 })).status).toBe(401);

    for (const role of ['administrator', 'editor'] as const) {
      const mobile = await signIn(role, 'mobile');
      const response = await search(mobile, 'Lodz');
      expect(response.status, role).toBe(403);
      expect(response.body).toMatchObject({ code: 'forbidden' });
    }

    const noToken = await signIn();
    noToken.panel.csrfToken = undefined;
    const csrf = await search(noToken, 'Lodz');
    expect(csrf.status).toBe(403);
    expect(csrf.body).toMatchObject({ code: 'csrf_failed' });
  });
});

describe('the limit of searches (EVM-020 AC6; SR-API-02, P10, CWE-770)', () => {
  it('EVM-020 AC6 60 searches in a minute pass, the 61st is 429 rate_limited with Retry-After; ANOTHER user is not affected; the next minute passes', async () => {
    await insertCustomer(current.database.admin, {});
    const heavy = await signIn();
    const other = await signIn();
    for (let index = 0; index < 60; index += 1) expect((await search(heavy, 'przykl')).status, `search ${index + 1}`).toBe(200);
    const refused = await search(heavy, 'przykl');
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ code: 'rate_limited' });
    expect(refused.headers['retry-after']).toMatch(/^[1-9][0-9]*$/);
    expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect((await search(other, 'przykl')).status).toBe(200);
    expect((await search(heavy, 'przykl')).status).toBe(429);
    current.clock.advance(MINUTE);
    expect((await search(heavy, 'przykl')).status).toBe(200);
  });

  it('EVM-020 AC6 every authorised search counts, one refused by the validation too: the limit comes BEFORE the validation (a loop of short phrases is no way round it)', async () => {
    const browser = await signIn();
    for (let index = 0; index < 60; index += 1) expect((await search(browser, 'ab')).status).toBe(400);
    const refused = await search(browser, 'ab');
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ code: 'rate_limited' });
    const rejections = current.app
      .get<MetricsRegistry>(METRICS, { strict: false })
      .snapshot()
      .find((sample) => sample.name === 'customer_search_rate_limited');
    expect(rejections?.value).toBeGreaterThanOrEqual(1);
  });

  it('EVM-020 AC6 a request that the guard refuses (Read-only is allowed to search, an anonymous one is not) does not use up the limit of anybody', async () => {
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    for (let index = 0; index < 70; index += 1) expect((await anonymous.post(SEARCH, { query: 'Lodz' })).status).toBe(401);
    const browser = await signIn('read_only');
    expect((await search(browser, 'Lodz')).status).toBe(200);
  });
});

describe('no personal data in the database of a search (EVM-020 AC1; SR-LOG-02)', () => {
  it('EVM-020 AC1 a search writes nothing: no audit event, no idempotency record', async () => {
    await insertCustomer(current.database.admin, {});
    const events = async () =>
      Number((await sql<{ n: string }>`select count(*)::text as n from audit.events`.execute(current.database.admin)).rows[0]?.n);
    const before = await events();
    await found(await signIn(), 'przykl');
    expect(await events()).toBe(before);
    const { rows } = await sql<{ n: string }>`select count(*)::text as n from platform.idempotency_records`.execute(current.database.admin);
    expect(rows[0]?.n).toBe('0');
  });
});

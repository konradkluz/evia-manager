import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { METRICS } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { MINUTE } from '../support/clock.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { clearSitesAndParties, insertParty, insertSite } from '../support/site-fixtures.ts';

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

const SEARCH = '/api/v1/sites/search';
const admin = () => current.database.admin;

/** A signed-in browser of a NEW user of the role (every user has their own search limit and mass-read window). */
async function signIn(role: Role = 'editor', channel: 'web' | 'mobile' = 'web') {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, { channel });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;
const search = (browser: Browser, query: unknown) => browser.panel.post(SEARCH, { query });
interface Item {
  id: string;
  siteType: string;
  street: string;
  buildingNumber: string;
  city: string;
  parkingSpotNumber?: string;
}
const found = async (browser: Browser, query: string): Promise<Item[]> => {
  const response = await search(browser, query);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return (response.body as { items: Item[] }).items;
};
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;

describe('search of sites (EVM-021 AC1; SR-API-04, SR-INPUT-03)', () => {
  it('EVM-021 AC1 "testowa 7" finds "ul. Testowa 7, 00-001 Warszawa, miejsce 15" with the type, the address and the spot; "Lodz" finds Łódź; case and Polish letters do not matter', async () => {
    const garage = await insertSite(admin(), { siteType: 'multi_family_garage', parkingSpotNumber: '15', garageLevel: '-1' });
    await insertSite(admin(), { street: 'ul. Piotrkowska', buildingNumber: '12', postalCode: '90-001', city: 'Łódź' });
    const browser = await signIn();
    const [item] = await found(browser, 'testowa 7');
    expect(item).toEqual({
      id: garage,
      siteType: 'multi_family_garage',
      street: 'ul. Testowa',
      buildingNumber: '7',
      postalCode: '00-001',
      city: 'Warszawa',
      parkingSpotNumber: '15',
      garageLevel: '-1',
    });
    for (const phrase of ['TESTOWA', 'ul. testowa 7', 'warszawa', '00-001']) expect(await found(browser, phrase), phrase).toHaveLength(1);
    expect((await found(browser, 'Lodz')).map((site) => site.city)).toEqual(['Łódź']);
    expect((await found(browser, 'ŁÓDŹ')).map((site) => site.city)).toEqual(['Łódź']);
    expect((await found(browser, 'piotrkowska 12')).map((site) => site.street)).toEqual(['ul. Piotrkowska']);
    expect(await found(browser, 'nie ma takiej')).toEqual([]);
  });

  it('EVM-021 AC1 the result is the list envelope with the type, the address and the spot — and nothing else (no notes, PPE, power, parties, search text)', async () => {
    const osd = await insertParty(admin(), {});
    const id = await insertSite(admin(), {
      apartmentNumber: '5',
      connectionPowerKw: 11,
      meteringPointId: 'PPE-SEKRET-1',
      osdPartyId: osd,
      notes: 'notatka-poufna',
    });
    const response = await search(await signIn('read_only'), 'testowa');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [
        {
          id,
          siteType: 'single_family_house',
          street: 'ul. Testowa',
          buildingNumber: '7',
          apartmentNumber: '5',
          postalCode: '00-001',
          city: 'Warszawa',
        },
      ],
      nextCursor: null,
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(response.body)).not.toMatch(/PPE-SEKRET|notatka-poufna|connectionPowerKw|PartyId/);
  });

  it('EVM-021 AC1 the search covers the street, the building and apartment numbers, the postal code, the city and the spot — not the PPE, the notes or the level', async () => {
    await insertSite(admin(), {
      street: 'ul. Zielona',
      buildingNumber: '12A',
      apartmentNumber: '34',
      postalCode: '31-100',
      city: 'Kraków',
      siteType: 'multi_family_garage',
      parkingSpotNumber: 'P-215',
      garageLevel: 'Poziom-minus-dwa',
      meteringPointId: 'PPE-UKRYTE-9',
      notes: 'klucz-w-notatce',
    });
    const browser = await signIn();
    for (const phrase of ['zielona', '12a', 'zielona 12a 34', '31-100', 'krakow', 'p-215'])
      expect(await found(browser, phrase), phrase).toHaveLength(1);
    for (const phrase of ['PPE-UKRYTE', 'klucz-w-notatce', 'minus-dwa']) expect(await found(browser, phrase), phrase).toEqual([]);
  });

  it('EVM-021 AC1 % and _ and the backslash and their full-width look-alikes are matched literally, never as a pattern', async () => {
    await insertSite(admin(), { street: 'ul. 100% Prąd' });
    await insertSite(admin(), { street: 'ul. Moto_Bis' });
    await insertSite(admin(), { street: 'ul. MotoXBis' });
    await insertSite(admin(), { street: 'ul. Ścieżka\\Bis' });
    const browser = await signIn();
    expect((await found(browser, '100%')).map((site) => site.street)).toEqual(['ul. 100% Prąd']);
    expect(await found(browser, '%%%')).toEqual([]);
    expect(await found(browser, '___')).toEqual([]);
    expect((await found(browser, 'moto_bis')).map((site) => site.street)).toEqual(['ul. Moto_Bis']);
    expect((await found(browser, 'ścieżka\\bis')).map((site) => site.street)).toEqual(['ul. Ścieżka\\Bis']);
    for (const phrase of ['％％％', '＿＿＿', 'abc＼']) expect(await found(browser, phrase), phrase).toEqual([]);
    expect((await found(browser, 'moto＿bis')).map((site) => site.street)).toEqual(['ul. Moto_Bis']);
  });

  it('EVM-021 AC1 a quote and SQL in the phrase are only text (parameterised): no error, no rows', async () => {
    await insertSite(admin(), {});
    const browser = await signIn();
    for (const phrase of ["'; drop table sites.sites; --", "' or '1'='1", '") or 1=1 --'])
      expect(await found(browser, phrase), phrase).toEqual([]);
    expect(await found(browser, 'testowa')).toHaveLength(1);
  });

  it('EVM-021 AC1 a phrase shorter than 3 characters (after NFC and trim) is 400 validation_failed with the code too_short; over 100 too_long — and the phrase is not in the answer', async () => {
    const browser = await signIn();
    for (const phrase of ['ab', '  ab ', '', '   ']) {
      const response = await search(browser, phrase);
      expect(response.status, phrase).toBe(400);
      expect(response.body).toMatchObject({ code: 'validation_failed' });
      expect(errorsOf(response.body)).toEqual([{ pointer: '/query', code: 'too_short' }]);
    }
    expect(errorsOf((await search(browser, 'x'.repeat(101))).body)).toEqual([{ pointer: '/query', code: 'too_long' }]);
    expect(errorsOf((await search(browser, 'x'.repeat(201))).body)).toEqual([{ pointer: '/query', code: 'too_long' }]);
  });

  it('EVM-021 AC5 the body is strict: an unknown field, a missing or non-text phrase, a control character is 400', async () => {
    const browser = await signIn();
    const post = (body: unknown) => browser.panel.post(SEARCH, body);
    expect(errorsOf((await post({ query: 'Lodz', limit: 500 })).body)).toEqual([{ pointer: '/limit', code: 'unknown_field' }]);
    expect(errorsOf((await post({})).body)).toEqual([{ pointer: '/query', code: 'required' }]);
    expect(errorsOf((await post({ query: 42 })).body)).toEqual([{ pointer: '/query', code: 'invalid_type' }]);
    expect(errorsOf((await post({ query: 'ab\u0000cd' })).body)).toEqual([{ pointer: '/query', code: 'invalid_characters' }]);
    expect((await post(undefined as unknown as object)).status).toBe(400);
  });

  it('EVM-021 AC1 at most 20 results, in the order of the city, the street, the building and the identifier', async () => {
    for (let index = 0; index < 25; index += 1)
      await insertSite(admin(), { street: `ul. Seria${String(index).padStart(2, '0')}`, buildingNumber: '1' });
    const browser = await signIn();
    const items = await found(browser, 'seria');
    expect(items).toHaveLength(20);
    expect(items[0]?.street).toBe('ul. Seria00');
    expect(items[19]?.street).toBe('ul. Seria19');
    await clearSitesAndParties(admin());
    for (const city of ['Zakopane', 'Łódź', 'Lublin', 'Gdańsk']) await insertSite(admin(), { street: 'ul. Wspólna', city });
    expect((await found(browser, 'wspolna')).map((site) => site.city)).toEqual(['Gdańsk', 'Lublin', 'Łódź', 'Zakopane']);
  });

  it('EVM-021 AC1 the phrase is in the body only: it is not in the request log, the answer of an error or a metric', async () => {
    await insertSite(admin(), { street: 'ul. Sekretna' });
    const browser = await signIn();
    const before = current.logs.lines.length;
    await found(browser, 'Sekretna-Fraza');
    await search(browser, 'zz');
    await found(browser, 'ul. sekretna');
    const lines = current.logs.lines.slice(before).join('\n');
    expect(lines).toContain(SEARCH);
    expect(lines).not.toMatch(/Sekretna|sekretna/i);
    const metrics = JSON.stringify(current.app.get<MetricsRegistry>(METRICS, { strict: false }).snapshot());
    expect(metrics).not.toMatch(/Sekretna/i);
  });
});

describe('who finds which site (EVM-021 AC6; SR-AUTHZ-02, SR-AUTHZ-03)', () => {
  it('EVM-021 AC6 Administrator, Editor and Read-only search: 200; a deleted site (soft delete) is found by none of them', async () => {
    await insertSite(admin(), { street: 'ul. Widoczna' });
    await insertSite(admin(), { street: 'ul. Usunięta', deletedAt: '2026-10-07T09:00:00Z' });
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const browser = await signIn(role);
      expect(
        (await found(browser, 'widoczna')).map((site) => site.street),
        role,
      ).toEqual(['ul. Widoczna']);
      expect(await found(browser, 'usunięta'), role).toEqual([]);
      expect(await found(browser, 'usunieta'), role).toEqual([]);
    }
  });

  it('EVM-021 AC6 no session is 401; a session of the mobile channel is 403; a request without the CSRF token is 403 csrf_failed — whatever the body', async () => {
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    const refused = await anonymous.post(SEARCH, { query: 'Lodz' });
    expect(refused.status).toBe(401);
    expect(refused.body).toMatchObject({ code: 'unauthenticated' });
    expect((await anonymous.post(SEARCH, { zly: 1 })).status).toBe(401);
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const response = await search(await signIn(role, 'mobile'), 'Lodz');
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

describe('the limit of searches of sites (EVM-021 AC7; SR-API-02, P10, CWE-770)', () => {
  it('EVM-021 AC7 60 searches in a minute pass, the 61st is 429 rate_limited with Retry-After; ANOTHER user is not affected; the next minute passes', async () => {
    await insertSite(admin(), {});
    const heavy = await signIn();
    const other = await signIn();
    for (let index = 0; index < 60; index += 1) expect((await search(heavy, 'testowa')).status, `search ${index + 1}`).toBe(200);
    const refused = await search(heavy, 'testowa');
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ code: 'rate_limited' });
    expect(refused.headers['retry-after']).toMatch(/^[1-9][0-9]*$/);
    expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect((await search(other, 'testowa')).status).toBe(200);
    current.clock.advance(MINUTE);
    expect((await search(heavy, 'testowa')).status).toBe(200);
  });

  it('EVM-021 AC7 every authorised search counts, one refused by the validation too (the limit comes BEFORE the validation); the bucket is its own: the searches of customers and parties are not used up', async () => {
    const browser = await signIn();
    for (let index = 0; index < 60; index += 1) expect((await search(browser, 'ab')).status).toBe(400);
    expect((await search(browser, 'ab')).status).toBe(429);
    expect((await browser.panel.post('/api/v1/customers/search', { query: 'Lodz' })).status).toBe(200);
    expect((await browser.panel.post('/api/v1/parties/search', { query: 'Lodz' })).status).toBe(200);
    const rejections = current.app
      .get<MetricsRegistry>(METRICS, { strict: false })
      .snapshot()
      .find((sample) => sample.name === 'site_search_rate_limited');
    expect(rejections?.value).toBeGreaterThanOrEqual(1);
  });
});

describe('a search of sites writes nothing (EVM-021 AC1; SR-LOG-02)', () => {
  it('EVM-021 AC1 no audit event and no idempotency record', async () => {
    await insertSite(admin(), {});
    const events = async () => Number((await sql<{ n: string }>`select count(*)::text as n from audit.events`.execute(admin())).rows[0]?.n);
    const before = await events();
    await found(await signIn(), 'testowa');
    expect(await events()).toBe(before);
    const { rows } = await sql<{ n: string }>`select count(*)::text as n from platform.idempotency_records`.execute(admin());
    expect(rows[0]?.n).toBe('0');
  });
});

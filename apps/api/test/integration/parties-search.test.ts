import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { METRICS } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { MINUTE } from '../support/clock.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { clearSitesAndParties, insertParty } from '../support/site-fixtures.ts';

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

const SEARCH = '/api/v1/parties/search';
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
const search = (browser: Browser, query: unknown, kinds?: unknown) =>
  browser.panel.post(SEARCH, kinds === undefined ? { query } : { query, kinds });
interface Item {
  id: string;
  kind: string;
  legalForm: string;
  displayName: string;
}
const found = async (browser: Browser, query: string, kinds?: unknown): Promise<Item[]> => {
  const response = await search(browser, query, kinds);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return (response.body as { items: Item[] }).items;
};
const names = (items: Item[]): string[] => items.map((item) => item.displayName);
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;
const MANAGER_KINDS = ['building_administration', 'property_manager', 'housing_community'];

describe('search of parties (EVM-021 AC3; SR-API-04, SR-INPUT-03, SR-INPUT-02)', () => {
  it('EVM-021 AC3 the OSD combobox: kinds [distribution_system_operator] finds only the OSD, the manager combobox only the three manager kinds', async () => {
    await insertParty(admin(), { displayName: 'Stoen Operator Testowy' });
    await insertParty(admin(), { displayName: 'Stoen Zarządca Testowy', kind: 'property_manager' });
    await insertParty(admin(), { displayName: 'Stoen Administracja', kind: 'building_administration' });
    await insertParty(admin(), { displayName: 'Stoen Wspólnota', kind: 'housing_community' });
    await insertParty(admin(), { displayName: 'Stoen Dostawca', kind: 'supplier' });
    const browser = await signIn();
    expect(names(await found(browser, 'stoen', ['distribution_system_operator']))).toEqual(['Stoen Operator Testowy']);
    expect(names(await found(browser, 'stoen', MANAGER_KINDS))).toEqual([
      'Stoen Administracja',
      'Stoen Wspólnota',
      'Stoen Zarządca Testowy',
    ]);
    expect(await found(browser, 'stoen')).toHaveLength(5);
    expect(await found(browser, 'stoen', ['designer'])).toEqual([]);
  });

  it('EVM-021 AC3 the filter is validated: an unknown kind, an empty list, more than 10 and a repeated kind are 400; nothing is read', async () => {
    const browser = await signIn();
    expect(errorsOf((await search(browser, 'stoen', ['osd'])).body)).toEqual([{ pointer: '/kinds/0', code: 'invalid_value' }]);
    expect(errorsOf((await search(browser, 'stoen', [])).body)).toEqual([{ pointer: '/kinds', code: 'too_short' }]);
    expect(
      errorsOf(
        (
          await search(
            browser,
            'stoen',
            Array.from({ length: 11 }, () => 'other'),
          )
        ).body,
      ),
    ).toEqual([{ pointer: '/kinds', code: 'too_long' }]);
    const repeated = await search(browser, 'stoen', ['other', 'supplier', 'other']);
    expect(repeated.status).toBe(400);
    expect(repeated.body).toMatchObject({ code: 'validation_failed' });
    expect(errorsOf(repeated.body)).toEqual([{ pointer: '/kinds', code: 'not_unique' }]);
    expect(errorsOf((await search(browser, 'stoen', 'distribution_system_operator')).body)).toEqual(
      expect.arrayContaining([{ pointer: '/kinds', code: 'invalid_type' }]),
    );
  });

  it('EVM-021 AC3 case and Polish letters do not matter: "zarzadca", "ZARZĄDCA", "lodzki" find the party', async () => {
    await insertParty(admin(), { displayName: 'Łódzki Zarządca Nieruchomości', kind: 'property_manager' });
    const browser = await signIn();
    for (const phrase of ['zarzadca', 'ZARZĄDCA', 'lodzki', 'nieruchomosci']) expect(await found(browser, phrase), phrase).toHaveLength(1);
  });

  it('EVM-021 AC3 the result is the list envelope with id, kind, legalForm and displayName — and nothing else (no telephone, e-mail, contact person, notes, search text)', async () => {
    const id = await insertParty(admin(), {
      displayName: 'Jan Przykładowy',
      legalForm: 'natural_person',
      kind: 'property_manager',
      contactPersonName: 'Osoba Kontaktowa',
      phone: '+48600000123',
      email: 'sekret@example.test',
      notes: 'notatka-poufna',
    });
    const response = await search(await signIn('read_only'), 'przykład');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [{ id, kind: 'property_manager', legalForm: 'natural_person', displayName: 'Jan Przykładowy' }],
      nextCursor: null,
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(response.body)).not.toMatch(/Kontaktowa|600000123|sekret|notatka-poufna/);
  });

  it('EVM-021 AC3 the search covers the name and the contact person — not the telephone, the e-mail or the notes', async () => {
    await insertParty(admin(), {
      displayName: 'Operator Alfa',
      contactPersonName: 'Zofia Nowakowska',
      phone: '+48600000777',
      email: 'ukryty@example.test',
      notes: 'klucz-w-notatce',
    });
    const browser = await signIn();
    expect(await found(browser, 'nowakowska')).toHaveLength(1);
    expect(await found(browser, 'alfa')).toHaveLength(1);
    for (const phrase of ['600000777', 'ukryty@example', 'klucz-w-notatce']) expect(await found(browser, phrase), phrase).toEqual([]);
  });

  it('EVM-021 AC1 % and _ and the backslash and their full-width look-alikes are matched literally, never as a pattern', async () => {
    await insertParty(admin(), { displayName: 'Rabat 100% Prąd' });
    await insertParty(admin(), { displayName: 'Moto_Bis' });
    await insertParty(admin(), { displayName: 'MotoXBis' });
    await insertParty(admin(), { displayName: 'Ścieżka\\Bis' });
    const browser = await signIn();
    expect(names(await found(browser, '100%'))).toEqual(['Rabat 100% Prąd']);
    expect(await found(browser, '%%%')).toEqual([]);
    expect(await found(browser, '___')).toEqual([]);
    expect(names(await found(browser, 'moto_bis'))).toEqual(['Moto_Bis']);
    expect(names(await found(browser, 'ścieżka\\bis'))).toEqual(['Ścieżka\\Bis']);
    for (const phrase of ['％％％', '＿＿＿', 'abc＼']) expect(await found(browser, phrase), phrase).toEqual([]);
    expect(names(await found(browser, 'moto＿bis'))).toEqual(['Moto_Bis']);
  });

  it('EVM-021 AC3 a quote and SQL in the phrase are only text (parameterised): no error, no rows', async () => {
    await insertParty(admin(), { displayName: 'Operator Testowy' });
    const browser = await signIn();
    for (const phrase of ["'; drop table parties.parties; --", "' or '1'='1", '") or 1=1 --'])
      expect(await found(browser, phrase), phrase).toEqual([]);
    expect(await found(browser, 'operator')).toHaveLength(1);
  });

  it('EVM-021 AC7 a phrase shorter than 3 characters is 400 too_short, a longer than 100 too_long — and the phrase is not in the answer', async () => {
    const browser = await signIn();
    for (const phrase of ['ab', '  ab ', '', '   ']) {
      const response = await search(browser, phrase);
      expect(response.status, phrase).toBe(400);
      expect(errorsOf(response.body)).toEqual([{ pointer: '/query', code: 'too_short' }]);
    }
    expect(errorsOf((await search(browser, 'x'.repeat(101))).body)).toEqual([{ pointer: '/query', code: 'too_long' }]);
    expect(errorsOf((await search(browser, 'x'.repeat(201))).body)).toEqual([{ pointer: '/query', code: 'too_long' }]);
  });

  it('EVM-021 AC5 the body is strict: an unknown field, a missing or non-text phrase, a control character is 400', async () => {
    const browser = await signIn();
    const post = (body: unknown) => browser.panel.post(SEARCH, body);
    expect(errorsOf((await post({ query: 'Stoen', limit: 500 })).body)).toEqual([{ pointer: '/limit', code: 'unknown_field' }]);
    expect(errorsOf((await post({})).body)).toEqual([{ pointer: '/query', code: 'required' }]);
    expect(errorsOf((await post({ query: 42 })).body)).toEqual([{ pointer: '/query', code: 'invalid_type' }]);
    expect(errorsOf((await post({ query: 'ab\u0000cd' })).body)).toEqual([{ pointer: '/query', code: 'invalid_characters' }]);
  });

  it('EVM-021 AC3 at most 20 results, in the order of the name', async () => {
    for (let index = 0; index < 25; index += 1) await insertParty(admin(), { displayName: `Seria ${String(index).padStart(2, '0')}` });
    const items = await found(await signIn(), 'seria');
    expect(items).toHaveLength(20);
    expect(names(items)[0]).toBe('Seria 00');
    expect(names(items)[19]).toBe('Seria 19');
  });

  it('EVM-021 AC1 the phrase is in the body only: it is not in the request log, the answer of an error or a metric', async () => {
    await insertParty(admin(), { displayName: 'Sekretny Kontrahent' });
    const browser = await signIn();
    const before = current.logs.lines.length;
    await found(browser, 'Sekretny-Wyraz');
    await search(browser, 'zz');
    await found(browser, 'sekretna fraza', ['distribution_system_operator']);
    const lines = current.logs.lines.slice(before).join('\n');
    expect(lines).toContain(SEARCH);
    expect(lines).not.toMatch(/Sekretny|sekretna|distribution_system_operator/i);
    const metrics = JSON.stringify(current.app.get<MetricsRegistry>(METRICS, { strict: false }).snapshot());
    expect(metrics).not.toMatch(/Sekretny|sekretna/i);
  });
});

describe('who finds which party (EVM-021 AC6; SR-AUTHZ-02, SR-AUTHZ-03)', () => {
  it('EVM-021 AC6 Administrator, Editor and Read-only search: 200; a deleted party (soft delete) is found by none of them', async () => {
    await insertParty(admin(), { displayName: 'Widoczny Operator' });
    await insertParty(admin(), { displayName: 'Usunięty Operator', deletedAt: '2026-10-07T09:00:00Z' });
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const browser = await signIn(role);
      expect(names(await found(browser, 'widoczny')), role).toEqual(['Widoczny Operator']);
      expect(await found(browser, 'usunięty'), role).toEqual([]);
      expect(await found(browser, 'usuniety', ['distribution_system_operator']), role).toEqual([]);
    }
  });

  it('EVM-021 AC6 no session is 401; a session of the mobile channel is 403; a request without the CSRF token is 403 csrf_failed — whatever the body', async () => {
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    const refused = await anonymous.post(SEARCH, { query: 'Stoen' });
    expect(refused.status).toBe(401);
    expect(refused.body).toMatchObject({ code: 'unauthenticated' });
    expect((await anonymous.post(SEARCH, { zly: 1 })).status).toBe(401);
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const response = await search(await signIn(role, 'mobile'), 'Stoen');
      expect(response.status, role).toBe(403);
      expect(response.body).toMatchObject({ code: 'forbidden' });
    }
    const noToken = await signIn();
    noToken.panel.csrfToken = undefined;
    const csrf = await search(noToken, 'Stoen');
    expect(csrf.status).toBe(403);
    expect(csrf.body).toMatchObject({ code: 'csrf_failed' });
  });
});

describe('the limit of searches of parties (EVM-021 AC7; SR-API-02, P10, CWE-770)', () => {
  it('EVM-021 AC7 60 searches in a minute pass, the 61st is 429 rate_limited with Retry-After; ANOTHER user is not affected; the next minute passes', async () => {
    await insertParty(admin(), {});
    const heavy = await signIn();
    const other = await signIn();
    for (let index = 0; index < 60; index += 1) expect((await search(heavy, 'operator')).status, `search ${index + 1}`).toBe(200);
    const refused = await search(heavy, 'operator');
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ code: 'rate_limited' });
    expect(refused.headers['retry-after']).toMatch(/^[1-9][0-9]*$/);
    expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect((await search(other, 'operator')).status).toBe(200);
    current.clock.advance(MINUTE);
    expect((await search(heavy, 'operator')).status).toBe(200);
  });

  it('EVM-021 AC7 every authorised search counts, one refused by the validation too (the limit comes BEFORE the validation); the bucket is its own: the other searches of the user are not used up', async () => {
    const browser = await signIn();
    for (let index = 0; index < 60; index += 1) expect((await search(browser, 'ab')).status).toBe(400);
    expect((await search(browser, 'ab')).status).toBe(429);
    expect((await browser.panel.post('/api/v1/customers/search', { query: 'Lodz' })).status).toBe(200);
    expect((await browser.panel.post('/api/v1/sites/search', { query: 'Lodz' })).status).toBe(200);
    const rejections = current.app
      .get<MetricsRegistry>(METRICS, { strict: false })
      .snapshot()
      .find((sample) => sample.name === 'party_search_rate_limited');
    expect(rejections?.value).toBeGreaterThanOrEqual(1);
  });
});

describe('a search of parties writes nothing (EVM-021 AC3; SR-LOG-02)', () => {
  it('EVM-021 AC3 no audit event and no idempotency record', async () => {
    await insertParty(admin(), {});
    const events = async () => Number((await sql<{ n: string }>`select count(*)::text as n from audit.events`.execute(admin())).rows[0]?.n);
    const before = await events();
    await found(await signIn(), 'operator');
    expect(await events()).toBe(before);
    const { rows } = await sql<{ n: string }>`select count(*)::text as n from platform.idempotency_records`.execute(admin());
    expect(rows[0]?.n).toBe('0');
  });
});

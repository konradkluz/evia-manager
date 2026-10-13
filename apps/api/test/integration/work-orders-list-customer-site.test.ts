import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../src/platform/config/config.ts';
import { createPool, type Database } from '../../src/platform/database/database.ts';
import type { Logger } from '../../src/platform/logging/logger.ts';
import { APP_CONFIG, DATABASE, LOGGER } from '../../src/platform/tokens.ts';
import { clearCustomers, insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { clearSitesAndParties, insertSite } from '../support/site-fixtures.ts';
import { insertWorkOrders, numberOf } from '../support/work-order-fixtures.ts';

/**
 * EVM-072 AC1 and AC4 on the list (`GET /api/v1/work-orders`): the customer and the site on every item, fetched in batches, and the
 * filters "Typ obiektu" and "Szablon". The search (POST) has its own file.
 */
const PATH = '/api/v1/work-orders';
const statements: string[] = [];

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp({
    configure: (builder) =>
      builder.overrideProvider(DATABASE).useFactory({
        inject: [APP_CONFIG, LOGGER],
        factory: (config: AppConfig, logger: Logger) =>
          new Kysely<Database>({
            dialect: new PostgresDialect({ pool: createPool({ url: config.databaseUrl, logger }) }),
            log: (event) => {
              if (event.level === 'query') statements.push(event.query.sql);
            },
          }),
      }),
  });
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  await sql`delete from work_orders.work_order_assignments`.execute(current.database.admin);
  await sql`delete from work_orders.work_orders`.execute(current.database.admin);
  await clearCustomers(current.database.admin);
  await clearSitesAndParties(current.database.admin);
});

interface Item {
  number: string;
  customer?: { id: string; displayName: string } | { deleted: true } | null;
  site?: { id: string; city: string; street: string; buildingNumber: string } | null;
}
interface Page {
  items: Item[];
  nextCursor: string | null;
}
const admin = () => current.database.admin;

async function signIn(role: Role = 'editor'): Promise<string> {
  const user = await createUser(admin(), current.clock, { role });
  return (await createSession(admin(), current.clock, user)).cookie;
}
const get = (cookie: string, query = '') => request(current.app.getHttpServer()).get(`${PATH}${query}`).set('Cookie', cookie);
const page = async (cookie: string, query = ''): Promise<Page> => {
  const response = await get(cookie, query);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as Page;
};
const templateId = async (code: string): Promise<string> =>
  (await sql<{ id: string }>`select id from catalog.work_order_templates where code = ${code}`.execute(admin())).rows[0]?.id ?? '';

describe('the customer and the site on the list (EVM-072 AC1; SR-DATA-03, TM-18)', () => {
  it('EVM-072 AC1 orders of different customers show the name of THEIR customer and the city, the street and the building number of THEIR site — nothing more of the address', async () => {
    const cookie = await signIn();
    const jan = await insertCustomer(admin(), { firstName: 'Jan', lastName: 'Przykładowy' });
    const ewa = await insertCustomer(admin(), { firstName: 'Ewa', lastName: 'Testowa', phone: '+48600000002' });
    const lodz = await insertSite(admin(), {
      street: 'ul. Żółkiewskiego',
      buildingNumber: '12',
      apartmentNumber: '34',
      postalCode: '91-100',
      city: 'Łódź',
      siteType: 'multi_family_garage',
      parkingSpotNumber: 'P-17',
    });
    const warszawa = await insertSite(admin(), { street: 'ul. Testowa', buildingNumber: '7', city: 'Warszawa' });
    await insertWorkOrders(admin(), [
      { number: numberOf(2026, 1), customerId: jan, siteId: lodz },
      { number: numberOf(2026, 2), customerId: ewa, siteId: warszawa },
    ]);
    const list = await page(cookie, '?sort=number');
    expect(list.items).toEqual([
      expect.objectContaining({
        number: numberOf(2026, 1),
        customer: { id: jan, displayName: expect.stringContaining('Przykładowy') as string },
        site: { id: lodz, city: 'Łódź', street: 'ul. Żółkiewskiego', buildingNumber: '12' },
      }),
      expect.objectContaining({
        number: numberOf(2026, 2),
        customer: { id: ewa, displayName: expect.stringContaining('Testowa') as string },
        site: { id: warszawa, city: 'Warszawa', street: 'ul. Testowa', buildingNumber: '7' },
      }),
    ]);
    const text = JSON.stringify(list);
    for (const hidden of ['91-100', 'P-17', '"34"', '+48600000002', 'apartmentNumber', 'postalCode'])
      expect(text, hidden).not.toContain(hidden);
  });

  it('EVM-072 AC1 an order without a customer or a site has null; a deleted customer is {deleted: true} without an id or a name; a deleted site is null', async () => {
    const cookie = await signIn('read_only');
    const gone = await insertCustomer(admin(), { lastName: 'Usunięty', deletedAt: '2026-10-05T08:00:00Z' });
    const site = await insertSite(admin(), { city: 'Gdańsk' });
    const goneSite = await insertSite(admin(), { city: 'Sopot', deletedAt: '2026-10-05T08:00:00Z' });
    await insertWorkOrders(admin(), [
      { number: numberOf(2026, 1) },
      { number: numberOf(2026, 2), customerId: gone, siteId: site },
      { number: numberOf(2026, 3), siteId: goneSite },
    ]);
    const list = await page(cookie, '?sort=number');
    expect(list.items[0]).toMatchObject({ customer: null, site: null });
    expect(list.items[1]?.customer).toEqual({ deleted: true });
    expect(list.items[1]?.site).toMatchObject({ id: site, city: 'Gdańsk' });
    expect(list.items[2]).toMatchObject({ customer: null, site: null });
    expect(JSON.stringify(list.items[1])).not.toContain(gone);
    expect(JSON.stringify(list)).not.toContain('Usunięty');
  });

  it('EVM-072 AC1 the customers and the sites of a page are fetched in ONE statement each, whatever the size of the page (no N+1)', async () => {
    const cookie = await signIn();
    const site = await insertSite(admin(), { city: 'Kraków' });
    const specs = [];
    for (let index = 0; index < 30; index += 1) {
      const customerId = await insertCustomer(admin(), { lastName: `Klient${index}`, phone: `+4860000${String(1000 + index)}` });
      specs.push({ number: numberOf(2026, index + 1), customerId, siteId: site });
    }
    await insertWorkOrders(admin(), specs);
    const counts: Record<string, { customers: number; sites: number }> = {};
    for (const limit of [1, 5, 30]) {
      statements.length = 0;
      expect((await page(cookie, `?limit=${limit}`)).items).toHaveLength(limit);
      counts[String(limit)] = {
        customers: statements.filter((text) => text.includes('"customers"."customers"')).length,
        sites: statements.filter((text) => text.includes('"sites"."sites"')).length,
      };
    }
    expect(counts['1']).toEqual({ customers: 1, sites: 1 });
    expect(counts['5']).toEqual(counts['1']);
    expect(counts['30']).toEqual(counts['1']);
  });
});

describe('"Więcej filtrów" on the list: the type of the site and the template (EVM-072 AC4; SR-INPUT-01)', () => {
  it('EVM-072 AC4 siteType keeps only the orders of sites of that type, and templateId only those created from that template; both combine with AND', async () => {
    const cookie = await signIn();
    const full = await templateId('garage_full_process');
    const house = await insertSite(admin(), { siteType: 'single_family_house' });
    const garage = await insertSite(admin(), { siteType: 'multi_family_garage' });
    await insertWorkOrders(admin(), [
      { number: numberOf(2026, 1), siteId: house, sourceTemplateId: full },
      { number: numberOf(2026, 2), siteId: garage, sourceTemplateId: full },
      { number: numberOf(2026, 3), siteId: garage },
      { number: numberOf(2026, 4) },
    ]);
    const numbers = async (query: string) => (await page(cookie, query)).items.map((item) => item.number);
    expect(await numbers('?siteType=multi_family_garage&sort=number')).toEqual([numberOf(2026, 2), numberOf(2026, 3)]);
    expect(await numbers(`?templateId=${full}&sort=number`)).toEqual([numberOf(2026, 1), numberOf(2026, 2)]);
    expect(await numbers(`?siteType=multi_family_garage&templateId=${full}`)).toEqual([numberOf(2026, 2)]);
    expect(await numbers(`?templateId=${randomUUID()}`)).toEqual([]);
  });

  it('EVM-072 AC4 a type outside the dictionary or a template that is not a UUID is 400 validation_failed with a pointer and a code, never the value', async () => {
    const cookie = await signIn();
    for (const query of ['?siteType=castle', '?siteType=', '?templateId=abc', `?templateId=${randomUUID()}x`]) {
      const response = await get(cookie, query);
      expect([response.status, (response.body as { code: string }).code], query).toEqual([400, 'validation_failed']);
      expect(JSON.stringify(response.body), query).not.toMatch(/castle/);
    }
  });
});

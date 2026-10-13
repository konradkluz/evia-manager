import { performance } from 'node:perf_hooks';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../src/platform/config/config.ts';
import { createPool, type Database } from '../../src/platform/database/database.ts';
import type { Logger } from '../../src/platform/logging/logger.ts';
import { APP_CONFIG, DATABASE, LOGGER } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { rebuildProjection } from '../support/projection.ts';
import { generateWorkOrders } from '../support/work-order-fixtures.ts';

/**
 * EVM-072 AC6: 10 000 synthetic orders, 2000 customers and 1000 sites (written in bulk SQL, the orders share them round-robin); a
 * search by a surname, an address, a city or a number — p95 of the response time below 300 ms over at least 50 measurements after a
 * warm-up, no N+1 (the number of statements does not depend on the size of the page), and the plans of the three trigram indexes in
 * the output. Everything is synthetic.
 */
const TOTAL = 10_000;
const CUSTOMERS = 2000;
const SITES = 1000;
const SEARCH = '/api/v1/work-orders/search';
const statements: string[] = [];

let app: IdentityApp;
beforeAll(async () => {
  app = await createIdentityApp({
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
  const admin = app.database.admin;
  await sql`
    insert into customers.customers (id, kind, first_name, last_name, phone, email, city, street, building_number, postal_code, created_at, updated_at)
    select ('0198b0a0-0000-7000-8000-' || lpad(to_hex(n), 12, '0'))::uuid, 'person',
           (array['Jan', 'Ewa', 'Łukasz', 'Żaneta', 'Marek'])[n % 5 + 1],
           (array['Kowalski', 'Nowak', 'Wiśniewski', 'Wójcik', 'Kamiński', 'Lewandowski', 'Zieliński', 'Szymański'])[n % 8 + 1],
           '+48' || lpad((600000000 + n)::text, 9, '0'), 'klient' || n || '@example.test',
           (array['Łódź', 'Gdańsk', 'Kraków'])[n % 3 + 1], 'Testowa', '1', '90-001', now(), now()
    from generate_series(1, ${CUSTOMERS}::int) as n`.execute(admin);
  await sql`
    insert into sites.sites (id, site_type, street, building_number, postal_code, city, created_at, updated_at)
    select ('0198b0a1-0000-7000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
           (array['single_family_house', 'multi_family_garage', 'commercial', 'other'])[n % 4 + 1],
           (array['ul. Żółkiewskiego', 'ul. Piotrkowska', 'ul. Długa', 'ul. Krótka', 'ul. Lipowa', 'ul. Polna'])[n % 6 + 1],
           (n % 120 + 1)::text, '90-001', (array['Łódź', 'Gdańsk', 'Kraków', 'Opole'])[n % 4 + 1], now(), now()
    from generate_series(1, ${SITES}::int) as n`.execute(admin);
  await generateWorkOrders(admin, TOTAL, []);
  await sql`
    with c as (select id, row_number() over (order by id) - 1 as n from customers.customers),
         s as (select id, row_number() over (order by id) - 1 as n from sites.sites),
         o as (select id, row_number() over (order by number) - 1 as n from work_orders.work_orders)
    update work_orders.work_orders w set customer_id = c.id, site_id = s.id
    from o join c on c.n = o.n % ${CUSTOMERS}::int join s on s.n = o.n % ${SITES}::int
    where w.id = o.id`.execute(admin);
  await rebuildProjection(admin);
  await sql`analyze customers.customers`.execute(admin);
  await sql`analyze sites.sites`.execute(admin);
  await sql`analyze work_orders.work_orders`.execute(admin);
  await sql`analyze overview.work_order_summaries`.execute(admin);
}, 300_000);
afterAll(async () => {
  await app.close();
});

async function reader() {
  const user = await createUser(app.database.admin, app.clock, { role: 'editor' });
  const created = await createSession(app.database.admin, app.clock, user);
  const panel = new PanelClient(app.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = created.cookie;
  panel.csrfToken = created.csrfToken;
  return panel;
}
const p95 = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;

describe('performance of the search on 10 000 synthetic orders (EVM-072 AC6; SR-API-02, TM-22)', () => {
  it('EVM-072 AC6 p95 of the response time is below 300 ms for a search by a surname, an address, a city and a number', async () => {
    const phrases = ['kowalski', 'wisniewski', 'zolkiewskiego', 'ul. Piotrkowska 12', 'Lodz', 'gdansk', '0042', 'kamiński'];
    let panel = await reader();
    // warm-up: the pool, the plans, the caches
    for (const query of phrases) expect((await panel.post(SEARCH, { query, limit: 25 })).status).toBe(200);
    const timed: number[] = [];
    for (let round = 0; round < 8; round += 1) {
      // one user serves 24 requests of 25 records: the mass-read window (10 000 records in 10 minutes) and the limit of 60 a minute
      // are not what is measured here
      panel = await reader();
      for (const query of phrases) {
        const started = performance.now();
        const response = await panel.post(SEARCH, { query, limit: 25 });
        timed.push(performance.now() - started);
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect((response.body as { items: unknown[] }).items.length, query).toBeGreaterThan(0);
      }
    }
    expect(timed.length).toBeGreaterThanOrEqual(50);
    const result = p95(timed);
    process.stdout.write(
      `EVM-072 AC6 search over ${TOTAL} orders: ${timed.length} measurements, p50 ${Math.round([...timed].sort((a, b) => a - b)[Math.floor(timed.length / 2)] ?? 0)} ms, p95 ${Math.round(result)} ms\n`,
    );
    expect(result).toBeLessThan(300);
  });

  it('EVM-072 AC6 deep pages of one search (a cursor in the body) stay fast: ten pages of 100', async () => {
    const panel = await reader();
    const timed: number[] = [];
    let cursor: string | null = null;
    for (let depth = 0; depth < 10; depth += 1) {
      const started = performance.now();
      const response: { status: number; body: unknown } = await panel.post(SEARCH, {
        query: 'wiśniewski',
        limit: 100,
        ...(cursor === null ? {} : { cursor }),
      });
      timed.push(performance.now() - started);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      cursor = (response.body as { nextCursor: string | null }).nextCursor;
      if (cursor === null) break;
    }
    expect(timed.length).toBeGreaterThanOrEqual(2);
    expect(p95(timed)).toBeLessThan(300);
  });

  it('EVM-072 AC6 no N+1: the number of statements does not depend on the size of the page — one search and one batch per module', async () => {
    const counts: Record<string, { all: number; customers: number; sites: number; orders: number; summaries: number }> = {};
    for (const limit of [1, 25, 100]) {
      const panel = await reader();
      statements.length = 0;
      expect((await panel.post(SEARCH, { query: 'kowalski', limit })).status).toBe(200);
      counts[String(limit)] = {
        all: statements.length,
        customers: statements.filter((text) => text.includes('"customers"."customers"')).length,
        sites: statements.filter((text) => text.includes('"sites"."sites"')).length,
        orders: statements.filter((text) => text.includes('"work_orders"."work_orders"')).length,
        summaries: statements.filter((text) => text.includes('"overview"."work_order_summaries"')).length,
      };
    }
    expect(counts['25']).toEqual(counts['100']);
    expect(counts['1']).toEqual(counts['100']);
    // the search and the names of the customers; the search and the lines of the sites; the search and the titles of the orders; one page
    expect(counts['100']).toMatchObject({ customers: 2, sites: 2, orders: 2, summaries: 1 });
  });

  it('EVM-072 AC6 the plans: the phrase is served by the trigram GIN index of each of the three tables (the plans are in the output)', async () => {
    const plans: Record<string, string> = {};
    await app.database.admin.transaction().execute(async (trx) => {
      // the small tables could be read in full more cheaply: the plan shows that the index CAN serve the phrase
      await sql`set local enable_seqscan = off`.execute(trx);
      const explain = async (label: string, statement: ReturnType<typeof sql>) => {
        const { rows } = await sql<{ 'QUERY PLAN': string }>`explain (analyze, buffers, format text) ${statement}`.execute(trx);
        plans[label] = rows.map((row) => row['QUERY PLAN']).join('\n');
      };
      await explain(
        'work_orders',
        sql`select id from work_orders.work_orders where deleted_at is null and search_text ilike '%' || public.f_unaccent(lower(${'garaz'})) || '%' limit 10001`,
      );
      await explain(
        'customers',
        sql`select id from customers.customers where deleted_at is null and search_text ilike '%' || public.f_unaccent(lower(${'kowalski'})) || '%' limit 10001`,
      );
      await explain(
        'sites',
        sql`select id from sites.sites where deleted_at is null and search_text ilike '%' || public.f_unaccent(lower(${'zolkiewskiego'})) || '%' limit 10001`,
      );
    });
    expect(plans['work_orders']).toMatch(/work_orders_search_text_trgm_idx/);
    expect(plans['customers']).toMatch(/customers_search_text_trgm_idx/);
    expect(plans['sites']).toMatch(/sites_search_text_trgm_idx/);
    for (const [label, plan] of Object.entries(plans)) process.stdout.write(`EVM-072 AC6 plan ${label}:\n${plan}\n`);
  });
});

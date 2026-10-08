import { performance } from 'node:perf_hooks';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../src/platform/config/config.ts';
import { createPool, type Database } from '../../src/platform/database/database.ts';
import type { Logger } from '../../src/platform/logging/logger.ts';
import { APP_CONFIG, DATABASE, LOGGER } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type UserFixture } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { generateWorkOrders } from '../support/work-order-fixtures.ts';

const TOTAL = 10_000;
const LIST = '/api/v1/customers';

/** Every statement the application sends, in order (Kysely `log` hook): what the test of N+1 counts. */
const statements: string[] = [];

let app: IdentityApp;
let history: string;
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
  // 10 000 synthetic customers (names invented from a counter, the Polish letters among them), written straight into the table
  await sql`
    insert into customers.customers (id, kind, first_name, last_name, phone, email, city, street, building_number, postal_code, created_at, updated_at)
    select ('0198b0a0-0000-7000-8000-' || lpad(to_hex(n), 12, '0'))::uuid, 'person',
           (array['Jan', 'Ewa', 'Łukasz', 'Żaneta', 'Marek'])[n % 5 + 1],
           (array['Ł', 'L', 'Z', 'A', 'Ś'])[n % 5 + 1] || 'azwisko' || lpad(n::text, 5, '0'),
           '+48' || lpad((600000000 + n)::text, 9, '0'), 'klient' || n || '@example.test',
           (array['Łódź', 'Gdańsk', 'Kraków'])[n % 3 + 1], 'Testowa', '1', '90-001', now(), now()
    from generate_series(1, ${TOTAL}::int) as n`.execute(app.database.admin);
  await sql`analyze customers.customers`.execute(app.database.admin);
  await generateWorkOrders(app.database.admin, TOTAL, []);
  const { rows } = await sql<{ id: string }>`select id from customers.customers order by id limit 1`.execute(app.database.admin);
  history = rows[0]?.id ?? '';
  await sql`update work_orders.work_orders set customer_id = ${history}
            where id in (select id from work_orders.work_orders order by created_at limit 200)`.execute(app.database.admin);
  await sql`analyze work_orders.work_orders`.execute(app.database.admin);
});
afterAll(async () => {
  await app.close();
});

async function reader(user?: UserFixture) {
  const owner = user ?? (await createUser(app.database.admin, app.clock, { role: 'editor' }));
  const created = await createSession(app.database.admin, app.clock, owner);
  const panel = new PanelClient(app.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = created.cookie;
  panel.csrfToken = created.csrfToken;
  return panel;
}
const p95 = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;

describe('performance on 10 000 synthetic customers (EVM-039 AC1, AC2; SR-API-04)', () => {
  it('EVM-039 AC1 p95 of the response time is below 300 ms for the list, the search, the detail, the history and deep pages', async () => {
    const panel = await reader();
    const timed: number[] = [];
    const timeIt = async (call: () => Promise<{ status: number; body: unknown }>) => {
      const started = performance.now();
      const response = await call();
      timed.push(performance.now() - started);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return response.body as { nextCursor?: string | null; items?: unknown[] };
    };
    for (let round = 0; round < 6; round += 1) {
      await timeIt(() => panel.get(`${LIST}?limit=100`));
      await timeIt(() => panel.get(`${LIST}?limit=25`));
      await timeIt(() => panel.post('/api/v1/customers/search', { query: 'Gdansk', limit: 25 }));
      await timeIt(() => panel.post('/api/v1/customers/search', { query: 'azwisko0500' }));
      await timeIt(() => panel.get(`${LIST}/${history}`));
      await timeIt(() => panel.get(`/api/v1/work-orders?customerId=${history}&sort=-createdAt&limit=25`));
      app.clock.advance(61_000); // a new minute: the search limit and the address limit are not what is measured
    }
    // deep pages: ten pages into the list and into a search
    let cursor: string | null | undefined = '';
    for (let depth = 0; depth < 10 && cursor !== null && cursor !== undefined; depth += 1) {
      const page = await timeIt(() => panel.get(`${LIST}?limit=100${cursor === '' ? '' : `&cursor=${cursor}`}`));
      cursor = page.nextCursor;
    }
    cursor = '';
    for (let depth = 0; depth < 10 && cursor !== null && cursor !== undefined; depth += 1) {
      const page = await timeIt(() =>
        panel.post('/api/v1/customers/search', { query: 'azwisko', limit: 100, ...(cursor === '' ? {} : { cursor }) }),
      );
      cursor = page.nextCursor;
    }
    expect(timed.length).toBeGreaterThan(40);
    expect(p95(timed)).toBeLessThan(300);
  });

  it('EVM-039 AC1 the plan of the keyset page walks the index on (sort_name, id) — no sort of the 10 000 rows — also on a deep page', async () => {
    const explain = async (statement: ReturnType<typeof sql>): Promise<string> => {
      const { rows } = await sql<{ 'QUERY PLAN': string }>`explain (analyze, buffers, format text) ${statement}`.execute(
        app.database.admin,
      );
      return rows.map((row) => row['QUERY PLAN']).join('\n');
    };
    const first = await explain(sql`
      select id, display_name from customers.customers where deleted_at is null order by sort_name, id limit 101`);
    expect(first).toMatch(/Index (Only )?Scan using customers_sort_name_id_idx/);
    expect(first).not.toMatch(/\bSort\b/);
    const { rows } = await sql<{ sort_name: string; id: string }>`
      select sort_name, id from customers.customers where deleted_at is null order by sort_name, id offset 7000 limit 1`.execute(
      app.database.admin,
    );
    const position = rows[0];
    const deep = await explain(sql`
      select id, display_name from customers.customers
      where deleted_at is null and (sort_name, id) > (${position?.sort_name ?? ''}, ${position?.id ?? ''})
      order by sort_name, id limit 101`);
    expect(deep).toMatch(/Index (Only )?Scan using customers_sort_name_id_idx/);
    expect(deep).not.toMatch(/\bSort\b/);
  });

  it('EVM-039 AC2 the plan of the history of a customer uses the index on (customer_id, created_at, id) — no sort', async () => {
    const { rows } = await sql<{ 'QUERY PLAN': string }>`
      explain (analyze, buffers, format text)
      select wo.id from work_orders.work_orders wo
      where wo.deleted_at is null and wo.customer_id = ${history}
      order by wo.created_at desc, wo.id desc limit 26`.execute(app.database.admin);
    const plan = rows.map((row) => row['QUERY PLAN']).join('\n');
    expect(plan).toMatch(/work_orders_customer_created_idx/);
    expect(plan).not.toMatch(/\bSort\b/);
  });

  it('EVM-039 AC1 the number of statements does not depend on the size of the page: one query of the customers for the page, whatever its size', async () => {
    const panel = await reader();
    const counts: Array<{ all: number; customers: number }> = [];
    for (const limit of [1, 25, 100]) {
      statements.length = 0;
      expect((await panel.get(`${LIST}?limit=${limit}`)).status).toBe(200);
      counts.push({ all: statements.length, customers: statements.filter((text) => text.includes('"customers"."customers"')).length });
    }
    expect(counts[0]).toEqual(counts[2]);
    expect(counts[1]).toEqual(counts[2]);
    expect(counts[2]?.customers).toBe(1);
  });
});

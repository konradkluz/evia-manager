import { performance } from 'node:perf_hooks';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../src/platform/config/config.ts';
import { createPool, type Database } from '../../src/platform/database/database.ts';
import type { Logger } from '../../src/platform/logging/logger.ts';
import { APP_CONFIG, DATABASE, LOGGER } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { rebuildProjection } from '../support/projection.ts';
import { clearWorkOrderCreation, generateWorkOrders } from '../support/work-order-fixtures.ts';

const ORDERS = 2_500;
const PER_ORDER = 4;
const LIST = '/api/v1/payment-milestones';

/** Every statement the application sends, in order (Kysely `log` hook): what the test of N+1 counts. */
const statements: string[] = [];

let app: IdentityApp;
let customerId = '';
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
  await clearWorkOrderCreation(app.database.admin);
  customerId = await insertCustomer(app.database.admin, { lastName: 'Wydajnościowy' });
  await generateWorkOrders(app.database.admin, ORDERS, []);
  await sql`update work_orders.work_orders set customer_id = ${customerId}
            where id in (select id from work_orders.work_orders order by created_at limit 100)`.execute(app.database.admin);
  // 10 000 issued milestones in 2 500 orders (4 each, due days over 120 days around "today") and 5 000 settled ones that must not matter
  await sql`
    insert into payments.payment_milestones (work_order_id, name, position, amount_minor, currency, status, invoice_number, invoiced_on,
      due_date, paid_on, created_at, updated_at)
    select o.id, 'Transza ' || p.position, p.position, 100000 + p.position, 'PLN',
           case when p.position <= ${PER_ORDER} then 'invoiced' else 'paid' end,
           'FV/' || o.rn || '/' || p.position, date '2026-06-01',
           date '2026-06-01' + (((o.rn * 7 + p.position * 13) % 240)::int),
           case when p.position <= ${PER_ORDER} then null else date '2026-06-02' end,
           now(), now()
    from (select id, row_number() over (order by id) as rn from work_orders.work_orders) o
    cross join generate_series(1, ${PER_ORDER + 2}::int) as p(position)`.execute(app.database.admin);
  await rebuildProjection(app.database.admin);
  await sql`analyze payments.payment_milestones`.execute(app.database.admin);
  await sql`analyze work_orders.work_orders`.execute(app.database.admin);
  app.clock.set('2026-10-03T10:00:00.000Z');
});
afterAll(async () => {
  await app.close();
});

async function reader() {
  const user = await createUser(app.database.admin, app.clock, { role: 'read_only' });
  const created = await createSession(app.database.admin, app.clock, user);
  const panel = new PanelClient(app.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = created.cookie;
  panel.csrfToken = created.csrfToken;
  return panel;
}
const p95 = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;

describe('performance on 10 000 issued milestones in 2 500 orders (EVM-055 AC1, AC3; SR-API-04)', () => {
  it('EVM-055 AC1 p95 of the response time is below 300 ms (the statement timeout of the pool is 2000 ms) for the first page, the views, the filters and deep pages — a statement that exceeded it would be a 500', async () => {
    const panel = await reader();
    const timed: number[] = [];
    const timeIt = async (query: string) => {
      const started = performance.now();
      const response = await panel.get(`${LIST}${query}`);
      timed.push(performance.now() - started);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return response.body as { nextCursor: string | null; items: unknown[]; summary: { unpaid: { count: number } } };
    };
    for (let round = 0; round < 5; round += 1) {
      const first = await timeIt('?limit=100');
      expect(first.summary.unpaid.count).toBe(ORDERS * PER_ORDER);
      await timeIt('?limit=25');
      await timeIt('?view=overdue&limit=25');
      await timeIt('?dueFrom=2026-09-01&dueTo=2026-09-30&limit=25');
      await timeIt(`?customerId=${customerId}&limit=25`);
      app.clock.advance(61_000); // a new minute: the limit of the address is not what is measured
    }
    let cursor: string | null = '';
    for (let depth = 0; depth < 20 && cursor !== null; depth += 1) {
      const page = await timeIt(`?limit=100${cursor === '' ? '' : `&cursor=${cursor}`}`);
      cursor = page.nextCursor;
      if (depth % 3 === 2) app.clock.advance(61_000);
    }
    expect(timed.length).toBeGreaterThan(40);
    expect(p95(timed)).toBeLessThan(300);
  });

  it('EVM-055 AC1 the plan of the page walks the partial index on (due_date, id) — no sort of the issued milestones — also behind the keyset of a deep page', async () => {
    const { rows: orders } = await sql<{ id: string }>`select id from work_orders.work_orders`.execute(app.database.admin);
    const ids = orders.map((row) => row.id);
    const explain = async (statement: ReturnType<typeof sql>): Promise<string> => {
      const { rows } = await sql<{ 'QUERY PLAN': string }>`explain (analyze, format text) ${statement}`.execute(app.database.admin);
      return rows.map((row) => row['QUERY PLAN']).join('\n');
    };
    const first = await explain(sql`
      select id, work_order_id from payments.payment_milestones
      where status = 'invoiced' and deleted_at is null and work_order_id = any(${ids}::uuid[])
      order by due_date, id limit 101`);
    expect(first).toMatch(/payment_milestones_unpaid_idx/);
    expect(first).not.toMatch(/\bSort\b/);
    const { rows } = await sql<{ due_date: string; id: string }>`
      select to_char(due_date, 'YYYY-MM-DD') as due_date, id from payments.payment_milestones
      where status = 'invoiced' and deleted_at is null order by due_date, id offset 7000 limit 1`.execute(app.database.admin);
    const deep = await explain(sql`
      select id from payments.payment_milestones
      where status = 'invoiced' and deleted_at is null and work_order_id = any(${ids}::uuid[])
        and (due_date, id) > (${rows[0]?.due_date}::date, ${rows[0]?.id}::uuid)
      order by due_date, id limit 101`);
    expect(deep).toMatch(/payment_milestones_unpaid_idx/);
    expect(deep).not.toMatch(/\bSort\b/);
  });

  it('EVM-055 AC1 AC3 the number of statements does not depend on the size of the page or of the data: the transaction, the set of orders, the orders, the tiles, the longest, the page — a constant — and ONE batch of the customers of the page', async () => {
    const panel = await reader();
    const counts: Array<{ domain: number; payments: number; orders: number; customers: number }> = [];
    for (const limit of [1, 25, 100]) {
      statements.length = 0;
      expect((await panel.get(`${LIST}?limit=${limit}`)).status).toBe(200);
      // the session of the caller is not the work of the summary (its sliding touch is written once a minute)
      const own = statements.filter((text) => !text.includes('"identity"."sessions"'));
      const of = (table: string) => own.filter((text) => text.includes(table)).length;
      counts.push({
        domain: own.length - of('"customers"."customers"'),
        payments: of('"payments"."payment_milestones"'),
        orders: of('"work_orders"."work_orders"'),
        customers: of('"customers"."customers"'),
      });
      app.clock.advance(61_000);
    }
    for (const count of counts) expect(count).toMatchObject({ domain: 7, payments: 4, orders: 1 });
    expect(counts.map((count) => count.customers)).toEqual([0, 1, 1]);
  });
});

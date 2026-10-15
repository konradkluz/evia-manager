import { performance } from 'node:perf_hooks';
import { Kysely, PostgresDialect, sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../src/platform/config/config.ts';
import type { Database } from '../../src/platform/database/database.ts';
import { createPool } from '../../src/platform/database/database.ts';
import type { Logger } from '../../src/platform/logging/logger.ts';
import { APP_CONFIG, DATABASE, LOGGER } from '../../src/platform/tokens.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role, type UserFixture } from '../support/identity-fixtures.ts';
import { projectionTools } from '../support/projection.ts';
import { generateWorkOrders } from '../support/work-order-fixtures.ts';

/**
 * EVM-056 AC6 (ADR-0017 tests 1–3): 10 000 synthetic orders with stages, waits and payment milestones in every status — written in bulk
 * SQL and brought into the projection by `rebuild` — sorted "Najpilniejsze" and filtered by the payment views under a fixed clock:
 * p95 < 300 ms over at least 50 measurements after a warm-up, no N+1 (exactly ONE statement of `payments` per page, whatever its size),
 * the plans in the output, and an order outside the policy that changes nothing.
 */
const PATH = '/api/v1/work-orders';
const TOTAL = 10_000;
const TODAY = '2026-10-08';
const statements: string[] = [];

let app: IdentityApp;
let rebuildMs = 0;
beforeAll(async () => {
  app = await createIdentityApp({
    now: `${TODAY}T08:00:00.000Z`,
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
  const coordinators: UserFixture[] = [];
  for (let index = 0; index < 10; index += 1) {
    coordinators.push(await createUser(app.database.admin, app.clock, { role: 'editor', displayName: `Opiekun syntetyczny ${index + 1}` }));
  }
  await generateWorkOrders(
    app.database.admin,
    TOTAL,
    coordinators.map((user) => user.id),
  );
  const admin = app.database.admin;
  await sql`
    insert into procedures.procedures (work_order_id, code, name, position, created_at, updated_at)
    select id, 'process_one', 'Proces syntetyczny', 1, now(), now() from work_orders.work_orders`.execute(admin);
  // stage 1: every third order waits for the customer (1..60 days ago), stage 2 has a deadline (30 days back .. 60 ahead)
  await sql`
    insert into procedures.procedure_stages (procedure_id, work_order_id, code, name, position, status, waiting_on, waiting_since,
      due_date, output_document_kind_codes, created_at, updated_at)
    select p.id, p.work_order_id, s.code, 'Etap syntetyczny', s.position,
      case when s.position = 1 and r.n % 3 = 0 then 'waiting' else 'todo' end,
      case when s.position = 1 and r.n % 3 = 0 then 'customer' end,
      case when s.position = 1 and r.n % 3 = 0 then date '2026-10-08' - (1 + (r.n % 60))::int end,
      case when s.position = 2 then date '2026-10-08' + ((r.n % 90) - 30)::int end,
      '{}', now(), now()
    from procedures.procedures p
    join (select work_order_id, row_number() over (order by work_order_id) as n from procedures.procedures) r on r.work_order_id = p.work_order_id
    cross join (values ('stage_1', 1), ('stage_2', 2)) as s(code, position)`.execute(admin);
  // milestone 1 in every status (issued: due 30 days back .. 29 ahead), milestone 2 planned
  await sql`
    insert into payments.payment_milestones (work_order_id, name, position, status, amount_minor, currency, invoice_number,
      invoiced_on, due_date, paid_on, created_at, updated_at)
    select w.id, 'Transza syntetyczna', m.position,
      case when m.position = 2 then 'planned' else (array['invoiced', 'paid', 'planned', 'cancelled'])[1 + r.n % 4] end,
      100000 + r.n, 'PLN',
      case when m.position = 1 and r.n % 4 in (0, 1) then 'FV/SYNT/' || r.n end,
      case when m.position = 1 and r.n % 4 in (0, 1) then date '2026-10-08' + ((r.n % 60) - 30)::int - 7 end,
      case when m.position = 1 and r.n % 4 in (0, 1) then date '2026-10-08' + ((r.n % 60) - 30)::int end,
      case when m.position = 1 and r.n % 4 = 1 then date '2026-10-08' + ((r.n % 60) - 30)::int end,
      now(), now()
    from work_orders.work_orders w
    join (select id, row_number() over (order by id) as n from work_orders.work_orders) r on r.id = w.id
    cross join (values (1), (2)) as m(position)`.execute(admin);
  const started = performance.now();
  const report = await projectionTools(admin).maintenance.rebuild();
  rebuildMs = performance.now() - started;
  expect(report).toMatchObject({ rebuilt: TOTAL, skipped: 0 });
  await sql`analyze overview.work_order_summaries`.execute(admin);
  await sql`analyze payments.payment_milestones`.execute(admin);
}, 600_000);
afterAll(async () => {
  await app.close();
});

async function session(role: Role = 'editor') {
  const owner = await createUser(app.database.admin, app.clock, { role });
  const created = await createSession(app.database.admin, app.clock, owner);
  return { userId: owner.id, cookie: created.cookie };
}
const get = (cookie: string, query: string) => request(app.app.getHttpServer()).get(`${PATH}${query}`).set('Cookie', cookie);
const p95 = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
interface Page {
  items: Array<{ id: string; payment?: { state: string } }>;
  nextCursor: string | null;
}

describe('performance and N+1 of the payments on 10 000 synthetic orders (EVM-056 AC6; ADR-0017 tests 1–3)', () => {
  it('EVM-056 AC6 the rebuild of 10 000 orders filled the signals of payments (the time of the whole run is in the output)', async () => {
    process.stdout.write(`EVM-056 AC6 rebuild of ${TOTAL} orders with milestones: ${Math.round(rebuildMs)} ms\n`);
    const { rows } = await sql<{ invoiced: string; paid: string }>`
      select count(*) filter (where invoiced_count > 0)::text as invoiced, count(*) filter (where paid_count > 0)::text as paid
      from overview.work_order_summaries`.execute(app.database.admin);
    expect(rows[0]).toEqual({ invoiced: String(TOTAL / 4), paid: String(TOTAL / 4) });
  });

  it('EVM-056 AC6 p95 of the response time is below 300 ms for "Najpilniejsze" with "Nieopłacone", the other payment combinations and deep pages', async () => {
    const viewer = await session();
    const queries = [
      '?sort=urgency&view=unpaid',
      '?sort=urgency&view=unpaid&limit=100',
      '?sort=urgency',
      '?sort=urgency&limit=100',
      '?view=overdue_payments',
      '?view=overdue_payments&sort=urgency&limit=100',
      '?view=unpaid&sort=nextDueDate&limit=100',
      '?view=unpaid&status=in_progress,new',
    ];
    for (const query of queries) expect((await get(viewer.cookie, query)).status, query).toBe(200); // warm-up
    const durations: number[] = [];
    for (let round = 0; round < 7; round += 1) {
      for (const query of queries) {
        const started = performance.now();
        const response = await get(viewer.cookie, query);
        durations.push(performance.now() - started);
        expect(response.status, query).toBe(200);
      }
    }
    let cursor: string | null = '';
    for (let depth = 0; depth < 10 && cursor !== null; depth += 1) {
      const started = performance.now();
      const response = await get(viewer.cookie, `?sort=urgency&view=unpaid&limit=100${cursor === '' ? '' : `&cursor=${cursor}`}`);
      durations.push(performance.now() - started);
      expect(response.status).toBe(200);
      cursor = (response.body as Page).nextCursor;
    }
    expect(durations.length).toBeGreaterThanOrEqual(50);
    const value = p95(durations);
    process.stdout.write(`EVM-056 AC6 p95 over ${durations.length} measurements: ${value.toFixed(1)} ms\n`);
    expect(value).toBeLessThan(300);
  });

  it('EVM-056 AC6 no N+1: a page with every state of payment reads `payments` in exactly ONE statement, whatever its size — and the number of statements does not grow', async () => {
    const viewer = await session();
    for (const sort of ['number', 'urgency']) {
      const counts: Record<string, { all: number; page: number; payments: number }> = {};
      for (const limit of [5, 25, 100]) {
        statements.length = 0;
        const response = await get(viewer.cookie, `?sort=${sort}&limit=${limit}`);
        expect(response.status).toBe(200);
        const items = (response.body as Page).items;
        expect(items).toHaveLength(limit);
        // by number the four statuses of the generator alternate: the page holds every state of the column
        if (sort === 'number' && limit === 100)
          expect(new Set(items.map((item) => item.payment?.state))).toEqual(new Set(['overdue', 'unpaid', 'paid', 'none']));
        counts[String(limit)] = {
          all: statements.length,
          page: statements.filter((text) => text.includes('"overview"."work_order_summaries"')).length,
          payments: statements.filter((text) => text.includes('"payments"."payment_milestones"')).length,
        };
      }
      expect(counts['100'], sort).toMatchObject({ page: 1, payments: 1 });
      expect(counts['5'], sort).toEqual(counts['100']);
      expect(counts['25'], sort).toEqual(counts['100']);
      // 1 page + the batches: titles, coordinators, parties (two), customers, sites and the totals of payments (ADR-0017 test 2)
      expect(counts['100']?.all, sort).toBeLessThanOrEqual(8);
    }
  });

  it('EVM-056 AC6 an order outside the policy influences neither the order nor the totals: the oldest overdue milestone of all is deleted and absent', async () => {
    const admin = app.database.admin;
    const { rows } = await sql<{ id: string }>`
      select id from work_orders.work_orders where deleted_at is null and status not in ('settled', 'cancelled')
      order by number desc limit 1`.execute(admin);
    const victim = rows[0]?.id ?? '';
    await sql`update payments.payment_milestones set status = 'invoiced', amount_minor = 99999999999, invoice_number = 'FV/SYNT/X',
        invoiced_on = date '2020-01-01', due_date = date '2020-01-01', paid_on = null
      where work_order_id = ${victim} and position = 2`.execute(admin);
    await projectionTools(admin).maintenance.rebuild({ only: [victim] });
    const viewer = await session();
    const before = (await get(viewer.cookie, '?sort=urgency&view=unpaid&limit=1')).body as Page;
    expect(before.items[0]?.id).toBe(victim); // the oldest overdue milestone of all leads while the order is live
    await sql`update work_orders.work_orders set deleted_at = now() where id = ${victim}`.execute(admin);
    await projectionTools(admin).maintenance.rebuild({ only: [victim] });
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const reader = await session(role);
      for (const query of ['?sort=urgency&view=unpaid&limit=100', '?view=overdue_payments&sort=urgency&limit=100']) {
        const after = (await get(reader.cookie, query)).body as Page;
        expect(
          after.items.map((item) => item.id),
          `${role} ${query}`,
        ).not.toContain(victim);
      }
    }
  });

  it('EVM-056 AC6 the plans of "Najpilniejsze" with "Nieopłacone" and of the totals (EXPLAIN ANALYZE, BUFFERS) are in the output of the run', async () => {
    const explain = async (label: string, statement: ReturnType<typeof sql>): Promise<string> => {
      const { rows } = await sql<{ 'QUERY PLAN': string }>`explain (analyze, buffers, format text) ${statement}`.execute(
        app.database.admin,
      );
      const text = rows.map((row) => row['QUERY PLAN']).join('\n');
      process.stdout.write(`--- EXPLAIN ${label}\n${text}\n`);
      return text;
    };
    const urgency = await explain(
      'sort urgency, view unpaid, limit 26',
      sql`select * from (
          select s.work_order_id as id,
            case when s.status not in ('settled', 'cancelled') and least(case when s.earliest_invoiced_due_date < ${TODAY}::date
              then s.earliest_invoiced_due_date end, case when s.next_due_date < ${TODAY}::date then s.next_due_date end) is not null then 1
              when s.status not in ('settled', 'cancelled') and s.longest_waiting_since < ${TODAY}::date - 14 then 2
              when s.status not in ('settled', 'cancelled') and s.next_due_date >= ${TODAY}::date then 3 else 4 end as g
          from overview.work_order_summaries s
          where s.deleted_at is null and s.status not in ('settled', 'cancelled') and s.invoiced_count > 0) page
        order by g, id limit 26`,
    );
    const { rows } = await sql<{ id: string }>`
      select work_order_id as id from overview.work_order_summaries where invoiced_count > 0 limit 100`.execute(app.database.admin);
    const totals = await explain(
      'totals of a page of 100 orders',
      sql`select work_order_id, currency, sum(amount_minor), coalesce(sum(amount_minor) filter (where due_date < ${TODAY}::date), 0)
        from payments.payment_milestones where work_order_id = any(${rows.map((row) => row.id)}::uuid[])
          and status = 'invoiced' and deleted_at is null group by work_order_id, currency`,
    );
    for (const plan of [urgency, totals]) {
      const time = /Execution Time: ([0-9.]+) ms/.exec(plan);
      expect(Number(time?.[1] ?? Number.POSITIVE_INFINITY)).toBeLessThan(150);
    }
  });
});

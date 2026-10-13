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
import { createSession, createUser, type UserFixture } from '../support/identity-fixtures.ts';
import { projectionTools } from '../support/projection.ts';
import { insertParty } from '../support/site-fixtures.ts';
import { generateWorkOrders } from '../support/work-order-fixtures.ts';

/**
 * EVM-034 AC6 (ADR-0017 tests 1-3): 10 000 synthetic orders with "Czekamy na…" and deadlines — written in bulk SQL and brought into
 * the projection by `rebuild` (so the same run exercises the rebuild), filters and sorts under a fixed clock, p95 < 300 ms over at
 * least 50 measurements after a warm-up, no N+1 (the number of statements does not depend on the page), the plan in the output.
 */
const PATH = '/api/v1/work-orders';
const TOTAL = 10_000;
const TODAY = '2026-10-03';
const statements: string[] = [];

let app: IdentityApp;
let osd = '';
let manager = '';
let coordinators: UserFixture[];
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
  coordinators = [];
  for (let index = 0; index < 20; index += 1) {
    coordinators.push(await createUser(app.database.admin, app.clock, { role: 'editor', displayName: `Opiekun syntetyczny ${index + 1}` }));
  }
  osd = await insertParty(app.database.admin, { kind: 'distribution_system_operator', displayName: 'Operator syntetyczny' });
  manager = await insertParty(app.database.admin, { kind: 'property_manager', displayName: 'Zarzadca syntetyczny' });
  await generateWorkOrders(
    app.database.admin,
    TOTAL,
    coordinators.map((user) => user.id),
  );
  const admin = app.database.admin;
  await sql`
    insert into procedures.procedures (work_order_id, code, name, position, created_at, updated_at)
    select id, 'process_one', 'Proces syntetyczny', 1, now(), now() from work_orders.work_orders`.execute(admin);
  // stage 1: every second order waits for the OSD (days 1..120 ago), stage 2: every third waits for the customer, stage 3 has a deadline
  await sql`
    insert into procedures.procedure_stages (procedure_id, work_order_id, code, name, position, status, waiting_on, waiting_on_party_id,
      waiting_since, due_date, output_document_kind_codes, created_at, updated_at)
    select p.id, p.work_order_id, s.code, 'Etap syntetyczny', s.position,
      case when s.position = 1 and r.n % 2 = 0 then 'waiting' when s.position = 2 and r.n % 3 = 0 then 'waiting' else 'todo' end,
      case when s.position = 1 and r.n % 2 = 0 then 'party' when s.position = 2 and r.n % 3 = 0 then 'customer' end,
      case when s.position = 1 and r.n % 2 = 0 then ${osd}::uuid end,
      case when (s.position = 1 and r.n % 2 = 0) or (s.position = 2 and r.n % 3 = 0)
        then date '2026-10-03' - (1 + (r.n % 120))::int end,
      case when s.position = 3 then date '2026-10-03' + ((r.n % 90) - 30)::int end,
      '{}', now(), now()
    from procedures.procedures p
    join (select work_order_id, row_number() over (order by work_order_id) as n from procedures.procedures) r on r.work_order_id = p.work_order_id
    cross join (values ('stage_1', 1), ('stage_2', 2), ('stage_3', 3)) as s(code, position)`.execute(admin);
  const started = performance.now();
  const report = await projectionTools(admin).maintenance.rebuild();
  rebuildMs = performance.now() - started;
  expect(report).toMatchObject({ rebuilt: TOTAL, skipped: 0 });
  await sql`analyze overview.work_order_summaries`.execute(admin);
  await sql`analyze overview.work_order_waits`.execute(admin);
}, 600_000);
afterAll(async () => {
  await app.close();
});

async function session(user?: UserFixture) {
  const owner = user ?? (await createUser(app.database.admin, app.clock, { role: 'editor' }));
  const created = await createSession(app.database.admin, app.clock, owner);
  return { userId: owner.id, cookie: created.cookie };
}
const get = (cookie: string, query: string) => request(app.app.getHttpServer()).get(`${PATH}${query}`).set('Cookie', cookie);
const p95 = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;

describe('performance and N+1 on 10 000 synthetic orders with "Czekamy na…" (EVM-034 AC6; ADR-0017 tests 1-3)', () => {
  it('EVM-034 AC6 the rebuild of 10 000 orders in batches of 500 filled the projection (the time of the whole run is in the output)', async () => {
    process.stdout.write(
      `EVM-034 AC6 rebuild of ${TOTAL} orders: ${Math.round(rebuildMs)} ms (${Math.round(rebuildMs / (TOTAL / 500))} ms per batch of 500)\n`,
    );
    const { rows } = await sql<{ summaries: string; waits: string }>`
      select (select count(*) from overview.work_order_summaries)::text as summaries,
             (select count(*) from overview.work_order_waits)::text as waits`.execute(app.database.admin);
    expect(rows[0]?.summaries).toBe(String(TOTAL));
    expect(Number(rows[0]?.waits)).toBeGreaterThan(TOTAL / 2);
    // a batch holds the locks of the projection for far less than the lock_timeout of the commands of users (5 s)
    expect(rebuildMs / (TOTAL / 500)).toBeLessThan(5_000);
  });

  it('EVM-034 AC6 p95 of the response time is below 300 ms for the filters, the view and the sorts of "Czekamy na…" and for deep pages', async () => {
    const viewer = await session();
    const queries = [
      '?view=waiting_on_dso_over_14_days',
      '?view=waiting_on_dso_over_14_days&limit=100',
      '?waitingOn=party&waitingOnPartyKind=distribution_system_operator&waitingLongerThanDays=14',
      '?waitingOn=customer&waitingLongerThanDays=30&limit=50',
      '?waitingLongerThanDays=90&sort=longestWaitingSince',
      '?view=all_open&sort=longestWaitingSince&limit=100',
      '?view=all_open&sort=nextDueDate&limit=100',
      '?sort=nextDueDate&status=in_progress,on_hold',
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
    for (const sort of ['longestWaitingSince', 'nextDueDate']) {
      let cursor: string | null = '';
      for (let depth = 0; depth < 10 && cursor !== null; depth += 1) {
        const started = performance.now();
        const response = await get(viewer.cookie, `?sort=${sort}&limit=100${cursor === '' ? '' : `&cursor=${cursor}`}`);
        durations.push(performance.now() - started);
        expect(response.status).toBe(200);
        cursor = (response.body as { nextCursor: string | null }).nextCursor;
      }
    }
    expect(durations.length).toBeGreaterThanOrEqual(50);
    const value = p95(durations);
    process.stdout.write(`EVM-034 AC6 p95 over ${durations.length} measurements: ${value.toFixed(1)} ms\n`);
    expect(value).toBeLessThan(300);
  });

  it('EVM-034 AC6 no N+1: the number of statements does not depend on the size of the page — one for the page, one batch of the titles, one of the names', async () => {
    const viewer = await session();
    const counts: Record<string, { all: number; page: number; titles: number; parties: number }> = {};
    for (const limit of [1, 5, 25, 100]) {
      statements.length = 0;
      const response = await get(viewer.cookie, `?view=waiting_on_dso_over_14_days&limit=${limit}`);
      expect(response.status).toBe(200);
      expect((response.body as { items: unknown[] }).items).toHaveLength(limit);
      counts[String(limit)] = {
        all: statements.length,
        page: statements.filter((text) => text.includes('"overview"."work_order_summaries"')).length,
        titles: statements.filter((text) => text.includes('"work_orders"."work_orders"')).length,
        parties: statements.filter((text) => text.includes('"parties"."parties"')).length,
      };
    }
    // one order may have no coordinator and no party: then its batch lookups are skipped — never more statements than for 100
    expect(counts['1']?.all).toBeLessThanOrEqual(counts['100']?.all ?? 0);
    expect(counts['100']?.all).toBeLessThanOrEqual(7); // 1 page + at most 6 batch lookups (ADR-0017 test 2)
    expect(counts['5']).toEqual(counts['100']);
    expect(counts['25']).toEqual(counts['100']);
    expect(counts['100']).toMatchObject({ page: 1, titles: 1 });
    expect(counts['100']?.parties).toBeLessThanOrEqual(2);
  });

  it('EVM-034 AC6 an order outside the policy does not influence the result, the order or the "+n": the oldest wait of all is deleted and absent', async () => {
    const admin = app.database.admin;
    const { rows } = await sql<{ id: string }>`
      select id from work_orders.work_orders where deleted_at is null order by number desc limit 1`.execute(admin);
    const victim = rows[0]?.id ?? '';
    await sql`insert into procedures.procedures (work_order_id, code, name, position, created_at, updated_at)
      values (${victim}, 'process_two', 'Proces dodatkowy', 2, now(), now())`.execute(admin);
    await sql`insert into procedures.procedure_stages (procedure_id, work_order_id, code, name, position, status, waiting_on,
        waiting_on_party_id, waiting_since, output_document_kind_codes, created_at, updated_at)
      select p.id, p.work_order_id, 'stage_old', 'Etap', 1, 'waiting', 'party', ${manager}, date '2020-01-01', '{}', now(), now()
      from procedures.procedures p where p.work_order_id = ${victim} and p.code = 'process_two'`.execute(admin);
    await projectionTools(admin).maintenance.rebuild({ only: [victim] });
    const viewer = await session();
    const before = (await get(viewer.cookie, '?sort=longestWaitingSince&limit=1')).body as { items: Array<{ id: string }> };
    expect(before.items[0]?.id).toBe(victim); // the oldest wait of all leads while the order is live
    await sql`update work_orders.work_orders set deleted_at = now() where id = ${victim}`.execute(admin);
    await projectionTools(admin).maintenance.rebuild({ only: [victim] });
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const user = await createUser(admin, app.clock, { role });
      const created = await createSession(admin, app.clock, user);
      const after = (await get(created.cookie, '?sort=longestWaitingSince&limit=100')).body as { items: Array<{ id: string }> };
      expect(
        after.items.map((item) => item.id),
        role,
      ).not.toContain(victim);
      expect(after.items[0]?.id, role).not.toBe(victim);
      const filtered = (await get(created.cookie, '?waitingLongerThanDays=365')).body as { items: Array<{ id: string }> };
      expect(
        filtered.items.map((item) => item.id),
        role,
      ).not.toContain(victim);
    }
  });

  it('EVM-034 AC6 the plans of the view and of the sort (EXPLAIN ANALYZE, BUFFERS) are in the output of the run', async () => {
    const explain = async (label: string, statement: ReturnType<typeof sql>): Promise<string> => {
      const { rows } = await sql<{ 'QUERY PLAN': string }>`explain (analyze, buffers, format text) ${statement}`.execute(
        app.database.admin,
      );
      const text = rows.map((row) => row['QUERY PLAN']).join('\n');
      process.stdout.write(`--- EXPLAIN ${label}\n${text}\n`);
      return text;
    };
    const view = await explain(
      'view waiting_on_dso_over_14_days, sort longestWaitingSince, limit 26',
      sql`select s.work_order_id, s.number from overview.work_order_summaries s
        where s.deleted_at is null and s.status not in ('settled', 'cancelled')
          and exists (select 1 from overview.work_order_waits w where w.work_order_id = s.work_order_id
            and w.waiting_on = 'party' and w.party_kind = 'distribution_system_operator' and w.waiting_since < ${TODAY}::date - 14::int)
        order by coalesce(s.longest_waiting_since, 'infinity'::date), s.work_order_id limit 26`,
    );
    const byDue = await explain(
      'sort nextDueDate, limit 101',
      sql`select s.work_order_id from overview.work_order_summaries s where s.deleted_at is null
        order by coalesce(s.next_due_date, 'infinity'::date), s.work_order_id limit 101`,
    );
    for (const plan of [view, byDue]) {
      const time = /Execution Time: ([0-9.]+) ms/.exec(plan);
      expect(Number(time?.[1] ?? Number.POSITIVE_INFINITY)).toBeLessThan(150);
    }
  });
});

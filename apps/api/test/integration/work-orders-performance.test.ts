import { performance } from 'node:perf_hooks';
import { Kysely, PostgresDialect, sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../src/platform/database/database.ts';
import { createPool } from '../../src/platform/database/database.ts';
import type { AppConfig } from '../../src/platform/config/config.ts';
import type { Logger } from '../../src/platform/logging/logger.ts';
import { APP_CONFIG, DATABASE, LOGGER } from '../../src/platform/tokens.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type UserFixture } from '../support/identity-fixtures.ts';
import { generateWorkOrders } from '../support/work-order-fixtures.ts';

const PATH = '/api/v1/work-orders';
const TOTAL = 10_000;

/** Every statement the application sends, in order (Kysely `log` hook): what the test of N+1 counts. */
const statements: string[] = [];

let app: IdentityApp;
let coordinators: UserFixture[];
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
  coordinators = [];
  for (let index = 0; index < 20; index += 1) {
    coordinators.push(await createUser(app.database.admin, app.clock, { role: 'editor', displayName: `Opiekun syntetyczny ${index + 1}` }));
  }
  await generateWorkOrders(
    app.database.admin,
    TOTAL,
    coordinators.map((user) => user.id),
  );
  await sql`analyze work_orders.work_orders`.execute(app.database.admin);
  await sql`analyze work_orders.work_order_assignments`.execute(app.database.admin);
});
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

describe('performance and N+1 on 10 000 synthetic orders (EVM-017 AC4)', () => {
  it('EVM-017 AC4 the generator made 10 000 orders in the numbers of several years (a year holds at most 9999)', async () => {
    const { rows } = await sql<{ n: string; years: string }>`
      select count(*)::text as n, count(distinct substring(number from 4 for 4))::text as years from work_orders.work_orders`.execute(
      app.database.admin,
    );
    expect(rows[0]).toEqual({ n: String(TOTAL), years: '4' });
  });

  it('EVM-017 AC4 p95 of the response time is below 300 ms for the filters of the panel, sorts and deep pages', async () => {
    const viewer = await session();
    const mine = await session(coordinators[3]);
    const queries: Array<[string, string]> = [
      [viewer.cookie, '?view=all_open'],
      [viewer.cookie, '?view=all_open&sort=-createdAt&limit=100'],
      [viewer.cookie, '?view=all_open&sort=number&limit=50'],
      [viewer.cookie, '?view=all_open&status=in_progress,on_hold&limit=25'],
      [viewer.cookie, `?view=all_open&coordinatorId=${coordinators[7]?.id}`],
      [viewer.cookie, '?status=settled&sort=createdAt'],
      [mine.cookie, '?view=mine'],
      [mine.cookie, '?view=mine&sort=-createdAt'],
    ];
    for (const [cookie, query] of queries) expect((await get(cookie, query)).status, query).toBe(200); // warm-up
    const durations: number[] = [];
    for (let round = 0; round < 6; round += 1) {
      for (const [cookie, query] of queries) {
        const started = performance.now();
        const response = await get(cookie, query);
        durations.push(performance.now() - started);
        expect(response.status, query).toBe(200);
      }
    }
    // deep pages: follow the cursor ten pages into the list
    let cursor: string | null = '';
    for (let depth = 0; depth < 10 && cursor !== null; depth += 1) {
      const started = performance.now();
      const response = await get(viewer.cookie, `?view=all_open&limit=100${cursor === '' ? '' : `&cursor=${cursor}`}`);
      durations.push(performance.now() - started);
      expect(response.status).toBe(200);
      cursor = (response.body as { nextCursor: string | null }).nextCursor;
    }
    expect(durations.length).toBeGreaterThan(50);
    expect(p95(durations)).toBeLessThan(300);
  });

  it('EVM-017 AC4 the number of statements does not depend on the size of the page: one for the page, one batch for the coordinators', async () => {
    const viewer = await session();
    const counts: Record<string, { all: number; orders: number; names: number }> = {};
    for (const limit of [1, 5, 25, 100]) {
      statements.length = 0;
      const response = await get(viewer.cookie, `?view=all_open&limit=${limit}`);
      expect(response.status).toBe(200);
      expect((response.body as { items: unknown[] }).items).toHaveLength(limit);
      counts[String(limit)] = {
        all: statements.length,
        orders: statements.filter((text) => text.includes('"work_orders"."work_orders"')).length,
        names: statements.filter((text) => text.includes('"display_name"')).length,
      };
    }
    expect(counts['5']).toEqual(counts['100']);
    expect(counts['1']).toEqual(counts['100']);
    expect(counts['25']).toEqual(counts['100']);
    expect(counts['100']).toMatchObject({ orders: 1, names: 1 });
  });

  it('EVM-017 AC4 the plan of the default sorts walks an index (no sort of the 10 000 rows) — the indexes of the migration are the ones used', async () => {
    const explain = async (statement: ReturnType<typeof sql>): Promise<string> => {
      const { rows } = await sql<{ 'QUERY PLAN': string }>`explain (analyze, buffers, format text) ${statement}`.execute(
        app.database.admin,
      );
      return rows.map((row) => row['QUERY PLAN']).join('\n');
    };
    const byNumber = await explain(sql`
      select wo.id, wo.number from work_orders.work_orders wo
      where wo.deleted_at is null and wo.status not in ('settled', 'cancelled')
      order by wo.number desc limit 26`);
    expect(byNumber).toMatch(/Index Scan Backward using work_orders_number_key/);
    expect(byNumber).not.toMatch(/\bSort\b/);
    const byCreated = await explain(sql`
      select wo.id, wo.created_at from work_orders.work_orders wo
      where wo.deleted_at is null and wo.status not in ('settled', 'cancelled')
      order by wo.created_at desc, wo.id desc limit 26`);
    expect(byCreated).toMatch(/Index Scan Backward using work_orders_created_at_id_idx/);
    expect(byCreated).not.toMatch(/\bSort\b/);
    const forCoordinator = await explain(sql`
      select wo.id from work_orders.work_orders wo
      left join work_orders.work_order_assignments a
        on a.work_order_id = wo.id and a.role = 'coordinator' and a.deleted_at is null
      where wo.deleted_at is null and a.user_id = ${coordinators[0]?.id ?? ''}
      order by wo.number desc limit 26`);
    expect(forCoordinator).toMatch(/work_order_assignments_coordinator_user_idx|work_order_assignments_one_coordinator_idx/);
  });
});

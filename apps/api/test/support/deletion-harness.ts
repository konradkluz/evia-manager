/**
 * The harness of the tests of the deletion and the restoration of a work order (EVM-060): one application with the real modules and a
 * database per test file, a clock set to a new hour before every test (the per-address limits never add up, and a step-up of one test is
 * not fresh in the next), the browsers of the three roles and the synthetic orders with their milestones. Test use only.
 */
import { Kysely, PostgresDialect, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import type { AppConfig } from '../../src/platform/config/config.ts';
import { createPool, type Database } from '../../src/platform/database/database.ts';
import type { Logger } from '../../src/platform/logging/logger.ts';
import { APP_CONFIG, DATABASE, LOGGER } from '../../src/platform/tokens.ts';
import type { WorkOrderStatus } from '../../src/modules/work-orders/domain/work-order-status.ts';
import { PANEL_ORIGIN } from './app.ts';
import { insertCustomer } from './customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from './identity-app.ts';
import { createPasskey, createSession, createUser, type Role } from './identity-fixtures.ts';
import { PanelClient } from './panel-client.ts';
import { insertMilestones, type MilestoneSpec } from './payment-fixtures.ts';
import { insertSite } from './site-fixtures.ts';
import { clearWorkOrderCreation, insertWorkOrders } from './work-order-fixtures.ts';

/** "Today": 2026-10-16 in Europe/Warsaw. */
export const TODAY = new Date('2026-10-16T08:00:00.000Z');
export const BASE = '/api/v1/work-orders';
export const MINUTE = 60_000;
/** Words that exist only in the title and the customer of a synthetic order: they must be in no audit record and no log line. */
export const TITLE = 'Wallbox-znacznik-tytulu-synt';
export const CUSTOMER_EMAIL_PREFIX = 'klient-znacznik';

export interface SignInOptions {
  readonly channel?: 'web' | 'mobile';
  /** `fresh` — a passkey just now; a number — that many minutes ago; absent — no passkey in the session at all. */
  readonly key?: 'fresh' | number;
  /** The exact age of the last passkey authentication, in milliseconds (the edge of the window). */
  readonly keyAgeMs?: number;
}

export type Browser = Awaited<ReturnType<Harness['signIn']>>;

export interface Harness {
  readonly app: () => IdentityApp;
  readonly admin: () => IdentityApp['database']['admin'];
  readonly signIn: (role: Role, options?: SignInOptions) => Promise<{ userId: string; sessionId: string; panel: PanelClient }>;
  /** The Administrator with a passkey authenticated just now. */
  readonly administrator: () => Promise<{ userId: string; sessionId: string; panel: PanelClient }>;
  /** An order with a customer, a site and the milestones; `id` and the ids of the milestones. */
  readonly order: (
    milestones?: readonly MilestoneSpec[],
    options?: { readonly status?: WorkOrderStatus; readonly deletedAt?: Date },
  ) => Promise<{ id: string; number: string; milestoneIds: string[]; customerId: string }>;
  readonly rowOf: (orderId: string) => Promise<OrderRow | undefined>;
  readonly auditOf: (orderId: string) => Promise<AuditRow[]>;
  readonly auditText: (orderId: string) => Promise<string>;
  readonly summaryOf: (orderId: string) => Promise<{ deleted: boolean } | undefined>;
  readonly idempotencyRecords: () => Promise<number>;
  /** The SQL of every statement the application runs (only with `countStatements`): to prove a constant number of queries. */
  readonly statements: string[];
}

export interface OrderRow {
  version: number;
  deleted: boolean;
  deleted_by: string | null;
  updated_by: string | null;
  status: string;
}
export interface AuditRow {
  action: string;
  outcome: string;
  actor_user_id: string | null;
  reason_code: string | null;
  ip_prefix: string | null;
  trace_id: string;
  object_type: string;
}

export function useDeletionApp(options: { readonly now?: Date; readonly countStatements?: boolean } = {}): Harness {
  const statements: string[] = [];
  let current: IdentityApp | undefined;
  let tick = 0;
  let numbering = 0;
  const app = (): IdentityApp => {
    if (current === undefined) throw new Error('the application is not started');
    return current;
  };
  const admin = () => app().database.admin;

  beforeAll(async () => {
    current = await createIdentityApp(
      options.countStatements === true
        ? {
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
          }
        : {},
    );
  });
  afterAll(async () => {
    await current?.close();
  });
  beforeEach(async () => {
    tick += 1;
    app().clock.set(new Date((options.now ?? TODAY).getTime() + tick * 61 * MINUTE));
    await clearWorkOrderCreation(admin());
  });

  const signIn: Harness['signIn'] = async (role, signInOptions = {}) => {
    const user = await createUser(admin(), app().clock, { role });
    if (signInOptions.key !== undefined || signInOptions.keyAgeMs !== undefined) await createPasskey(admin(), app().clock, user);
    const ageMs = signInOptions.keyAgeMs ?? (signInOptions.key === 'fresh' ? 0 : (signInOptions.key ?? 0) * MINUTE);
    const hasKey = signInOptions.key !== undefined || signInOptions.keyAgeMs !== undefined;
    const session = await createSession(admin(), app().clock, user, {
      channel: signInOptions.channel ?? 'web',
      ...(hasKey ? { passkeyAuthenticatedAt: new Date(app().clock.now().getTime() - ageMs) } : {}),
    });
    const panel = new PanelClient(app().app.getHttpServer(), PANEL_ORIGIN);
    panel.cookie = session.cookie;
    panel.csrfToken = session.csrfToken;
    return { userId: user.id, sessionId: session.id, panel };
  };

  return {
    statements,
    app,
    admin,
    signIn,
    administrator: () => signIn('administrator', { key: 'fresh' }),
    order: async (milestones = [], orderOptions = {}) => {
      numbering += 1;
      const customerId = await insertCustomer(admin(), { email: `${CUSTOMER_EMAIL_PREFIX}${numbering}@example.invalid` });
      const siteId = await insertSite(admin());
      const number = `ZL-6${String(numbering).padStart(3, '0')}-0060`;
      const status = orderOptions.status ?? 'in_progress';
      const ids = await insertWorkOrders(admin(), [
        {
          number,
          title: `${TITLE} ${numbering}`,
          customerId,
          siteId,
          status,
          ...(status === 'settled' || status === 'cancelled' ? { closedAt: new Date('2026-10-02T08:00:00Z') } : {}),
          ...(orderOptions.deletedAt === undefined ? {} : { deletedAt: orderOptions.deletedAt }),
        },
      ]);
      const id = [...ids.values()][0] ?? '';
      return { id, number, customerId, milestoneIds: await insertMilestones(admin(), id, milestones) };
    },
    rowOf: async (orderId) =>
      (
        await sql<OrderRow>`
          select version, deleted_at is not null as deleted, deleted_by, updated_by, status
          from work_orders.work_orders where id = ${orderId}`.execute(admin())
      ).rows[0],
    auditOf: async (orderId) =>
      (
        await sql<AuditRow>`
          select action, outcome, actor_user_id, reason_code, host(ip_prefix) || '/' || masklen(ip_prefix) as ip_prefix, trace_id, object_type
          from audit.events where object_id = ${orderId} and action in ('work_order.deleted', 'work_order.undeleted') order by occurred_at, id`.execute(
          admin(),
        )
      ).rows,
    auditText: async (orderId) =>
      JSON.stringify((await sql`select * from audit.events where object_id = ${orderId}`.execute(admin())).rows),
    summaryOf: async (orderId) =>
      (
        await sql<{ deleted: boolean }>`
          select deleted_at is not null as deleted from overview.work_order_summaries where work_order_id = ${orderId}`.execute(admin())
      ).rows[0],
    idempotencyRecords: async () =>
      Number(
        (await sql<{ count: string }>`select count(*) as count from platform.idempotency_records`.execute(admin())).rows[0]?.count ?? 0,
      ),
  };
}

/**
 * Helpers of the tests of the synchronisation with a phone (EVM-097): an API under test that records its statements, an Editor with a signed-in phone, the pull
 * with the strict check of EVERY change of EVERY page, and the scenario of one order with all the entities of the aggregate. Synthetic data only.
 */
import { assertSyncProjectionStrict } from '@evia/contracts/sync';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { expect } from 'vitest';
import type { AppConfig } from '../../src/platform/config/config.ts';
import { createPool, type Database } from '../../src/platform/database/database.ts';
import type { createLogger } from '../../src/platform/logging/logger.ts';
import type { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { effectiveScopeRuleVersion } from '../../src/platform/sync/scope-rule.ts';
import { APP_CONFIG, DATABASE, LOGGER, METRICS } from '../../src/platform/tokens.ts';
import { createIdentityApp, type IdentityApp } from './identity-app.ts';
import { signedInPhone, type Phone } from './mobile-flows.ts';
import { insertProcedure } from './procedure-fixtures.ts';
import { insertCustomer } from './customer-fixtures.ts';
import { insertParty, insertSite } from './site-fixtures.ts';
import { insertEntries } from './timeline-fixtures.ts';
import { createUser, type UserFixture } from './identity-fixtures.ts';
import { totpAccount, type TotpAccount } from './totp-flows.ts';
import { insertScopeItems, insertWorkOrders, numberOf, type WorkOrderSpec } from './work-order-fixtures.ts';

export const PULL = '/api/v1/sync/changes';
export const DAY = 24 * 3_600_000;

export interface SyncApp {
  readonly app: IdentityApp;
  readonly statements: string[];
}

/** The API under test; every statement of the pool is recorded (to prove that the number of queries of a page does not depend on the data). */
export async function bootSync(env: Record<string, string | undefined> = {}): Promise<SyncApp> {
  const statements: string[] = [];
  const app = await createIdentityApp({
    env: { SYNC_FULL_DOWNLOADS_PER_DAY: '50', ...env },
    configure: (builder) =>
      builder.overrideProvider(DATABASE).useFactory({
        inject: [APP_CONFIG, LOGGER],
        factory: (config: AppConfig, logger: ReturnType<typeof createLogger>) =>
          new Kysely<Database>({
            dialect: new PostgresDialect({ pool: createPool({ url: config.databaseUrl, logger }) }),
            log: (event) => {
              if (event.level === 'query') statements.push(event.query.sql);
            },
          }),
      }),
  });
  return { app, statements };
}

export const adminDb = (app: IdentityApp) => app.database.admin;
export const ago = (app: IdentityApp, days: number): Date => new Date(app.clock.now().getTime() - days * DAY);

export const scopeVersion = (app: IdentityApp): number => {
  const { sync } = app.app.get<AppConfig>(APP_CONFIG, { strict: false });
  return effectiveScopeRuleVersion({ configured: sync.scopeRuleVersion, closedDays: sync.closedOrdersInScopeDays });
};

export const counter = (app: IdentityApp, name: string, labels: Record<string, string> = {}): number =>
  app.app
    .get<MetricsRegistry>(METRICS, { strict: false })
    .snapshot()
    .filter((sample) => sample.name === name && Object.entries(labels).every(([key, value]) => sample.labels[key] === value))
    .reduce((sum, sample) => sum + sample.value, 0);

export interface SyncBody {
  result: string;
  phase?: string;
  changes?: Array<Record<string, unknown>>;
  cursor?: string;
  hasMore?: boolean;
  reason?: string;
}

export const pull = (phone: Phone, query = '') => phone.get(`${PULL}${query === '' ? '' : `?${query}`}`, phone.authorised());

/** Pulls page after page until `hasMore` is false; EVERY change of EVERY page must pass the strict projection check (the page itself is not read through the generated schema). */
export async function drain(
  phone: Phone,
  query = '',
  from?: string,
): Promise<{ changes: Array<Record<string, unknown>>; pages: SyncBody[]; cursor: string }> {
  const changes: Array<Record<string, unknown>> = [];
  const pages: SyncBody[] = [];
  let cursor = from;
  for (let guard = 0; guard < 200; guard += 1) {
    const response = await pull(phone, [cursor === undefined ? '' : `cursor=${cursor}`, query].filter(Boolean).join('&'));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.body as SyncBody;
    expect(body.result).toBe('changes');
    expect(body.changes?.length ?? 0).toBeLessThanOrEqual(500);
    for (const change of body.changes ?? []) expect(assertSyncProjectionStrict(change), JSON.stringify(change)).toEqual({ ok: true });
    pages.push(body);
    changes.push(...(body.changes ?? []));
    cursor = body.cursor;
    if (body.hasMore !== true) return { changes, pages, cursor: cursor ?? '' };
  }
  throw new Error('the pull did not end');
}

export const entityOf = (change: Record<string, unknown>): Record<string, unknown> | undefined =>
  change['op'] === 'upsert' ? (change['entity'] as Record<string, unknown>) : undefined;

/** `type:id` of the upserts and `delete:type:id` of the markers. */
export const keysOf = (changes: Array<Record<string, unknown>>): string[] =>
  changes.map((change) => {
    const entity = entityOf(change);
    return entity === undefined
      ? `delete:${String(change['type'])}:${String(change['id'])}`
      : `${String(entity['type'])}:${String(entity['id'])}`;
  });

export const idsOfType = (changes: Array<Record<string, unknown>>, type: string): string[] =>
  changes.flatMap((change) => {
    const entity = entityOf(change);
    return entity?.['type'] === type ? [String(entity['id'])] : [];
  });

export const upsertOf = (changes: Array<Record<string, unknown>>, type: string, id: string): Record<string, unknown> | undefined =>
  changes.map(entityOf).find((entity) => entity?.['type'] === type && entity['id'] === id);

export async function editor(app: IdentityApp): Promise<{ account: TotpAccount; phone: Phone }> {
  const account = await totpAccount(app, { role: 'editor' });
  return { account, phone: await signedInPhone(app, account) };
}

/** The strings that must never reach a phone (SR-SYNC-04): they sit in columns the projections do not list. */
export const SENTINELS = {
  partyEmail: 'party-email@example.invalid',
  partyNotes: 'SENTINEL-PARTY-NOTES',
  partyLegalForm: 'natural_person',
  siteMeter: 'SENTINEL-PPE-0042',
  paymentCode: 'payment_milestone_status_changed',
} as const;

export interface Scenario {
  readonly orderId: string;
  readonly customerId: string;
  readonly siteId: string;
  readonly managerPartyId: string;
  readonly waitedPartyId: string;
  readonly strayPartyId: string;
  readonly coordinator: UserFixture;
  readonly responsible: UserFixture;
  readonly author: UserFixture;
  /** An account that no order names - not a coordinator, not an author, not responsible for a stage. */
  readonly stranger: UserFixture;
  readonly itemIds: string[];
  readonly procedureId: string;
  readonly stageIds: string[];
  readonly entryIds: string[];
  readonly paymentEntryId: string;
}

let sequence = 0;

/** One order with every kind of entity the aggregate holds, a sentinel in every column that must stay off the phone, and people nobody names. */
export async function scenario(app: IdentityApp, spec: Partial<WorkOrderSpec> = {}): Promise<Scenario> {
  const db = adminDb(app);
  sequence += 1;
  const coordinator = await createUser(db, app.clock, { role: 'editor' });
  const responsible = await createUser(db, app.clock, { role: 'editor' });
  const author = await createUser(db, app.clock, { role: 'editor' });
  const stranger = await createUser(db, app.clock, { role: 'administrator' });
  const managerPartyId = await insertParty(db, {
    kind: 'property_manager',
    displayName: 'Zarzadca Testowy',
    contactPersonName: 'Anna Testowa',
    phone: '+48600000111',
    email: SENTINELS.partyEmail,
    notes: SENTINELS.partyNotes,
    legalForm: SENTINELS.partyLegalForm,
  });
  const waitedPartyId = await insertParty(db, { kind: 'designer', displayName: 'Projektant Testowy', email: 'designer@example.invalid' });
  const strayPartyId = await insertParty(db, { kind: 'supplier', displayName: 'Dostawca Niewskazany', email: 'stray@example.invalid' });
  const customerId = await insertCustomer(db, { firstName: 'Jan', lastName: 'Testowy', email: 'customer@example.invalid' });
  const siteId = await insertSite(db, { managerPartyId, meteringPointId: SENTINELS.siteMeter });
  const ids = await insertWorkOrders(db, [
    { number: numberOf(2026, sequence), customerId, siteId, coordinatorId: coordinator.id, ...spec },
  ]);
  const orderId = ids.get(spec.number ?? numberOf(2026, sequence)) ?? '';
  const itemIds = await insertScopeItems(db, orderId, [{ position: 1 }, { position: 2, parameters: { power: 11 } }]);
  const procedure = await insertProcedure(db, orderId, {
    code: 'connection',
    name: 'Przylaczenie',
    stages: [
      {
        status: 'waiting',
        waitingOn: 'party',
        waitingOnPartyId: waitedPartyId,
        waitingSince: '2026-10-10',
        responsibleUserId: responsible.id,
      },
      {},
    ],
  });
  const entryIds = await insertEntries(db, orderId, author.id, [{ body: 'Pierwszy wpis' }, { kind: 'comment', body: 'Komentarz' }]);
  const [paymentEntryId = ''] = await insertEntries(db, orderId, author.id, [
    {
      kind: 'event',
      eventCode: SENTINELS.paymentCode,
      eventPayload: {
        objectType: 'payment_milestone',
        objectId: '0193a000-0000-7000-8000-0000000000aa',
        fromStatus: 'planned',
        toStatus: 'paid',
      },
    },
  ]);
  return {
    orderId,
    customerId,
    siteId,
    managerPartyId,
    waitedPartyId,
    strayPartyId,
    coordinator,
    responsible,
    author,
    stranger,
    itemIds,
    procedureId: procedure.id,
    stageIds: procedure.stageIds,
    entryIds,
    paymentEntryId,
  };
}

export type Row = 'scope_items' | 'stages' | 'entries' | 'parties' | 'orders' | 'procedures';

/** A soft delete the way the application does it: the version goes up with the change. */
export async function softDelete(app: IdentityApp, row: Row, id: string): Promise<void> {
  const db = adminDb(app);
  const at = app.clock.now();
  switch (row) {
    case 'scope_items':
      await sql`update work_orders.scope_items set deleted_at = ${at}, version = version + 1 where id = ${id}`.execute(db);
      return;
    case 'stages':
      await sql`update procedures.procedure_stages set deleted_at = ${at}, version = version + 1 where id = ${id}`.execute(db);
      return;
    case 'entries':
      await sql`update timeline.timeline_entries set deleted_at = ${at}, version = version + 1 where id = ${id}`.execute(db);
      return;
    case 'parties':
      await sql`update parties.parties set deleted_at = ${at}, version = version + 1 where id = ${id}`.execute(db);
      return;
    case 'orders':
      await sql`update work_orders.work_orders set deleted_at = ${at}, version = version + 1 where id = ${id}`.execute(db);
      return;
    case 'procedures':
      await sql`update procedures.procedures set deleted_at = ${at}, version = version + 1 where id = ${id}`.execute(db);
      return;
  }
}

export async function restore(app: IdentityApp, row: Exclude<Row, 'parties' | 'procedures'>, id: string): Promise<void> {
  const db = adminDb(app);
  switch (row) {
    case 'scope_items':
      await sql`update work_orders.scope_items set deleted_at = null, version = version + 1 where id = ${id}`.execute(db);
      return;
    case 'stages':
      await sql`update procedures.procedure_stages set deleted_at = null, version = version + 1 where id = ${id}`.execute(db);
      return;
    case 'entries':
      await sql`update timeline.timeline_entries set deleted_at = null, version = version + 1 where id = ${id}`.execute(db);
      return;
    case 'orders':
      await sql`update work_orders.work_orders set deleted_at = null, version = version + 1 where id = ${id}`.execute(db);
      return;
  }
}

/** The changes of the office that the tests make, each one the way the application makes it (the version goes up). */
export const renameParty = (app: IdentityApp, id: string, name: string) =>
  sql`update parties.parties set display_name = ${name}, version = version + 1 where id = ${id}`.execute(adminDb(app));
export const renameUser = (app: IdentityApp, id: string, name: string) =>
  sql`update identity.users set display_name = ${name}, version = version + 1 where id = ${id}`.execute(adminDb(app));
export const setQuantity = (app: IdentityApp, id: string, quantity: number) =>
  sql`update work_orders.scope_items set quantity = ${quantity}, version = version + 1 where id = ${id}`.execute(adminDb(app));
/** The stage stops waiting for the party and is in progress. */
export const startStage = (app: IdentityApp, id: string) =>
  sql`update procedures.procedure_stages set status = 'in_progress', waiting_on = null, waiting_on_party_id = null, waiting_since = null,
    version = version + 1 where id = ${id}`.execute(adminDb(app));
export const setSiteManager = (app: IdentityApp, siteId: string, partyId: string) =>
  sql`update sites.sites set manager_party_id = ${partyId}, version = version + 1 where id = ${siteId}`.execute(adminDb(app));
export const setWaitingParty = (app: IdentityApp, stageId: string, partyId: string) =>
  sql`update procedures.procedure_stages set waiting_on_party_id = ${partyId}, version = version + 1 where id = ${stageId}`.execute(
    adminDb(app),
  );

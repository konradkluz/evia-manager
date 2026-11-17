/**
 * What the integration tests of the automatic purge of site surveys share (EVM-139): the application with the in-memory register of deletions and the clock, a survey with SENTINELS
 * in every free field (they must be found in no register object, log line, audit record or `change_log` row after the purge), media with objects, and a few reads. A TEST helper
 * outside `src`; everything is synthetic.
 */
import { sql, type Kysely } from 'kysely';
import { expect } from 'vitest';
import { SiteSurveyPurgeJob } from '../../src/modules/work-orders/index.ts';
import type { Database } from '../../src/platform/database/database.ts';
import { DELETION_REGISTER } from '../../src/platform/deletion-register/deletion-register.ts';
import { InMemoryDeletionRegister } from '../../src/platform/deletion-register/in-memory-deletion-register.ts';
import type { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { CLOCK, METRICS } from '../../src/platform/tokens.ts';
import { createIdentityApp, type IdentityApp } from './identity-app.ts';
import { createUser } from './identity-fixtures.ts';
import { insertMedia } from './media-fixtures.ts';
import { insertProcedure } from './procedure-fixtures.ts';
import { insertSite } from './site-fixtures.ts';
import { insertScopeItems, insertWorkOrders } from './work-order-fixtures.ts';

export const NOW = '2027-05-01T08:00:00.000Z';
export const DAY = 86_400_000;
export const STREET = 'ul. Znacznik-usuwania-synt';
export const CITY = 'Usuwanowo-synt';
export const POSTAL = '99-139';
export const TITLE = 'Tytul-wizji-synt-139';
export const PHONE = '+48600139003';
export const NOTE = 'Notatka-synt-139-nazwisko';
export const REASON = 'Powod-synt-139-nazwisko';
export const FILE_NAME = 'Zdjecie-synt-139.JPG';
export const ITEM_NOTE = 'Notatka-pozycji-synt-139-kod-bramy';
export const BLOCKED = 'Blokada-synt-139-nazwisko';
export const STAGE_NOTE = 'Notatka-etapu-synt-139-telefon';
export const STAGE_NAME = 'Etap-reczny-synt-139-nazwisko';
export const SENTINELS = [
  STREET,
  CITY,
  POSTAL,
  TITLE,
  PHONE,
  '600139003',
  NOTE,
  REASON,
  FILE_NAME,
  ITEM_NOTE,
  BLOCKED,
  STAGE_NOTE,
  STAGE_NAME,
];

export interface Started {
  readonly current: IdentityApp;
  readonly register: InMemoryDeletionRegister;
}
export const open: IdentityApp[] = [];

/** Closes every application `start` opened - the `afterEach` of the test files. */
export async function closeStarted(): Promise<void> {
  for (const app of open.splice(0)) await app.close();
}

export async function start(mode: 'report' | 'enforce' | null = 'enforce'): Promise<Started> {
  let register: InMemoryDeletionRegister | undefined;
  const current = await createIdentityApp({
    now: NOW,
    env: mode === null ? {} : { SITE_SURVEY_PURGE_MODE: mode },
    configure: (builder) =>
      builder.overrideProvider(DELETION_REGISTER).useFactory({
        inject: [CLOCK],
        factory: (clock: IdentityApp['clock']) => {
          register = new InMemoryDeletionRegister(clock);
          return register;
        },
      }),
  });
  open.push(current);
  return { current, register: register as unknown as InMemoryDeletionRegister };
}

let numbering = 0;
export const nowOf = (app: IdentityApp) => app.clock.now();
export const inDays = (app: IdentityApp, days: number, extraMs = 0) => new Date(nowOf(app).getTime() + days * DAY + extraMs);

export interface Survey {
  readonly id: string;
  readonly number: string;
  readonly siteId: string;
  readonly creator: string;
}
export interface SurveyOptions {
  readonly deadline: Date;
  readonly status?: 'cancelled' | 'on_hold';
  readonly deletedAt?: Date;
  readonly siteCreatedHoursBefore?: number | null;
  readonly siteId?: string;
  readonly creator?: string;
}

/** An open survey with sentinels in every free field; the location is made 1 hour before the survey by the same person unless the options say otherwise. */
export async function survey(app: IdentityApp, options: SurveyOptions): Promise<Survey> {
  const admin = app.database.admin;
  numbering += 1;
  const number = `ZL-2092-${String(numbering).padStart(4, '0')}`;
  const creator = options.creator ?? (await createUser(admin, app.clock, { role: 'editor' })).id;
  const siteId = options.siteId ?? (await insertSite(admin, { street: STREET, city: CITY, postalCode: POSTAL, notes: NOTE }));
  const createdAt = new Date(nowOf(app).getTime() - 100 * DAY);
  if (options.siteId === undefined && options.siteCreatedHoursBefore !== null) {
    const siteAt = new Date(createdAt.getTime() - (options.siteCreatedHoursBefore ?? 1) * 3_600_000);
    await sql`update sites.sites set created_by = ${creator}, created_at = ${siteAt} where id = ${siteId}`.execute(admin);
  }
  const ids = await insertWorkOrders(admin, [
    {
      number,
      title: TITLE,
      siteId,
      createdAt,
      siteSurveyExpiresAt: options.deadline,
      ...(options.status === undefined
        ? {}
        : { status: options.status, ...(options.status === 'cancelled' ? { closedAt: createdAt } : {}) }),
      ...(options.deletedAt === undefined ? {} : { deletedAt: options.deletedAt }),
    },
  ]);
  const id = [...ids.values()][0] ?? '';
  await sql`update work_orders.work_orders set created_by = ${creator}, requester_phone = ${PHONE}, description = ${NOTE}, status_reason = ${REASON}
    where id = ${id}`.execute(admin);
  return { id, number, siteId, creator };
}

export async function addMedia(app: IdentityApp, order: Survey, count = 2): Promise<string[]> {
  const keys: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const inserted = await insertMedia(app.database.admin, {
      workOrderId: order.id,
      createdBy: order.creator,
      state: 'clean',
      fileName: FILE_NAME,
      session: { userId: order.creator, state: 'active', uploadId: `upload-${index}` },
    });
    await app.storage.putObjectIfAbsent({
      key: inserted.objectKey,
      body: Buffer.from('synthetic'),
      contentType: 'image/jpeg',
      cacheControl: 'private',
    });
    keys.push(inserted.objectKey);
  }
  return keys;
}

/** A scope item with a note and a process whose stage has a reason of a block, notes and a name typed by hand - the free text a survey may get (ADR-0024 pt 4). */
export async function addScopeAndProcess(app: IdentityApp, order: Survey): Promise<void> {
  const [itemId] = await insertScopeItems(app.database.admin, order.id, [{ position: 1 }]);
  await sql`update work_orders.scope_items set notes = ${ITEM_NOTE} where id = ${itemId}`.execute(app.database.admin);
  const process = await insertProcedure(app.database.admin, order.id, {
    stages: [{ name: STAGE_NAME, status: 'blocked', blockedReason: BLOCKED }],
  });
  await sql`update procedures.procedure_stages set notes = ${STAGE_NOTE} where id = ${process.stageIds[0]}`.execute(app.database.admin);
}

export const job = (app: IdentityApp) => app.app.get(SiteSurveyPurgeJob, { strict: false });
export const db = (app: IdentityApp): Kysely<Database> => app.database.admin;
export const one = async <T>(app: IdentityApp, query: ReturnType<typeof sql<T>>): Promise<T | undefined> =>
  (await query.execute(db(app))).rows[0];
export const rowOf = (app: IdentityApp, id: string) =>
  one<{
    title: string;
    description: string | null;
    requester_phone: string | null;
    status_reason: string | null;
    deleted_at: Date | null;
    purged_at: Date | null;
    version: number;
  }>(
    app,
    sql`select title, description, requester_phone, status_reason, deleted_at, site_survey_purged_at as purged_at, version
      from work_orders.work_orders where id = ${id}`,
  );
export const everything = async (app: IdentityApp): Promise<string> =>
  (
    await sql<{ t: string }>`
      select (select coalesce(json_agg(w order by w.id), '[]') from work_orders.work_orders w)::text
        || (select coalesce(json_agg(s order by s.id), '[]') from sites.sites s)::text
        || (select coalesce(json_agg(m order by m.id), '[]') from media.media_assets m)::text
        || (select coalesce(json_agg(f order by f.id), '[]') from media.stored_files f)::text
        || (select coalesce(json_agg(t order by t.id), '[]') from timeline.timeline_entries t)::text
        || (select coalesce(json_agg(i order by i.id), '[]') from work_orders.scope_items i)::text
        || (select coalesce(json_agg(p order by p.id), '[]') from procedures.procedures p)::text
        || (select coalesce(json_agg(g order by g.id), '[]') from procedures.procedure_stages g)::text as t`.execute(db(app))
  ).rows[0]?.t ?? '';
export const auditText = async (app: IdentityApp): Promise<string> =>
  (await sql<{ t: string }>`select coalesce(json_agg(e), '[]')::text as t from audit.events e`.execute(db(app))).rows[0]?.t ?? '';
export const changeLogText = async (app: IdentityApp): Promise<string> =>
  (await sql<{ t: string }>`select coalesce(json_agg(c), '[]')::text as t from sync.change_log c`.execute(db(app))).rows[0]?.t ?? '';
export const metric = (app: IdentityApp, name: string) =>
  app.app
    .get<MetricsRegistry>(METRICS, { strict: false })
    .snapshot()
    .find((sample) => sample.name === name)?.value;

export function expectNoSentinel(text: string): void {
  for (const sentinel of SENTINELS) expect(text, `sentinel ${sentinel}`).not.toContain(sentinel);
}

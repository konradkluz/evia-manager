import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertProcedure, type StageSpec } from '../support/procedure-fixtures.ts';
import { projectionTools, rebuildProjection, skipProjectionCheckOnce } from '../support/projection.ts';
import { insertParty, insertSite } from '../support/site-fixtures.ts';
import { clearWorkOrderCreation, insertWorkOrders, numberOf } from '../support/work-order-fixtures.ts';
import { requirePreCommitRegistry } from '../../src/platform/database/transactional.ts';
import { EVENT_BUS, METRICS } from '../../src/platform/tokens.ts';
import type { EventBus } from '../../src/platform/events/event-bus.ts';
import type { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';

const TODAY = '2026-10-03';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp({ now: `${TODAY}T08:00:00.000Z` });
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  current.clock.set(`${TODAY}T08:00:00.000Z`);
  await clearWorkOrderCreation(current.database.admin);
  await sql`delete from platform.idempotency_records`.execute(current.database.admin);
  await sql`delete from platform.security_alert_outbox`.execute(current.database.admin);
});

const admin = () => current.database.admin;
const BASE = '/api/v1/work-orders';

async function signIn(role: Role = 'editor') {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, { channel: 'web' });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;

let numbering = 0;
async function scene(stages: StageSpec[] | ((osd: string) => StageSpec[]) = [{}]) {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `jan${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const osd = await insertParty(admin(), { kind: 'distribution_system_operator', displayName: 'Operator Syntetyczny' });
  const ids = await insertWorkOrders(admin(), [{ number: numberOf(2026, numbering), customerId, siteId }]);
  const orderId = [...ids.values()][0] ?? '';
  const process = await insertProcedure(admin(), orderId, { stages: typeof stages === 'function' ? stages(osd) : stages });
  return { orderId, siteId, osd, stageIds: process.stageIds };
}

interface Summary {
  work_order_id: string;
  status: string;
  deleted_at: Date | null;
  site_type: string | null;
  waiting_count: number;
  longest_waiting_since: string | null;
  longest_waiting_on: string | null;
  longest_waiting_party_id: string | null;
  next_due_date: string | null;
}
const summaryOf = async (orderId: string): Promise<Summary | undefined> =>
  (
    await sql<Summary>`select work_order_id, status, deleted_at, site_type, waiting_count,
      to_char(longest_waiting_since, 'YYYY-MM-DD') as longest_waiting_since, longest_waiting_on, longest_waiting_party_id,
      to_char(next_due_date, 'YYYY-MM-DD') as next_due_date
      from overview.work_order_summaries where work_order_id = ${orderId}`.execute(admin())
  ).rows[0];
const waitsOf = async (orderId: string) =>
  (
    await sql<{ stage_id: string; waiting_on: string; party_kind: string | null; waiting_since: string }>`
      select stage_id, waiting_on, party_kind, to_char(waiting_since, 'YYYY-MM-DD') as waiting_since
      from overview.work_order_waits where work_order_id = ${orderId} order by waiting_since, stage_id`.execute(admin())
  ).rows;

const transition = (browser: Browser, orderId: string, stageId: string, body: unknown, ifMatch = '"1"') =>
  browser.panel.post(`${BASE}/${orderId}/procedure-stages/${stageId}/transitions`, body, { 'If-Match': ifMatch });
const patchStage = (browser: Browser, orderId: string, stageId: string, body: unknown, ifMatch = '"1"') =>
  browser.panel.patch(`${BASE}/${orderId}/procedure-stages/${stageId}`, body, { 'If-Match': ifMatch });

describe('the projection follows the change in its transaction (EVM-034 AC1, AC4, AC6; ADR-0017)', () => {
  it('EVM-034 AC1 a stage that moves into "waiting" for the OSD appears in the projection with the kind of the party and the day; leaving "waiting" removes it', async () => {
    const { orderId, stageIds, osd } = await scene([{}, {}]);
    const editor = await signIn('editor');
    const [first = '', second = ''] = stageIds;
    expect((await transition(editor, orderId, first, { to: 'waiting', waitingOn: 'party', waitingOnPartyId: osd })).status).toBe(200);
    expect((await transition(editor, orderId, second, { to: 'waiting', waitingOn: 'customer' })).status).toBe(200);
    expect(await summaryOf(orderId)).toMatchObject({
      waiting_count: 2,
      longest_waiting_since: TODAY,
      longest_waiting_on: expect.stringMatching(/party|customer/) as string,
    });
    const waits = await waitsOf(orderId);
    expect(waits.map((wait) => [wait.waiting_on, wait.party_kind, wait.waiting_since]).sort()).toEqual([
      ['customer', null, TODAY],
      ['party', 'distribution_system_operator', TODAY],
    ]);
    expect((await transition(editor, orderId, first, { to: 'done' }, '"2"')).status).toBe(200);
    expect((await waitsOf(orderId)).map((wait) => wait.stage_id)).toEqual([second]);
    expect(await summaryOf(orderId)).toMatchObject({ waiting_count: 1, longest_waiting_on: 'customer', longest_waiting_party_id: null });
  });

  it('EVM-034 AC4 the due date of an unfinished stage is the next due date; the stage that is done no longer counts', async () => {
    const { orderId, stageIds } = await scene([{ dueDate: '2026-10-20' }, { dueDate: '2026-10-10' }]);
    expect((await summaryOf(orderId))?.next_due_date).toBe('2026-10-10');
    const editor = await signIn('editor');
    expect((await transition(editor, orderId, stageIds[1] ?? '', { to: 'done' })).status).toBe(200);
    expect((await summaryOf(orderId))?.next_due_date).toBe('2026-10-20');
    expect((await patchStage(editor, orderId, stageIds[0] ?? '', { dueDate: '2026-11-05' })).status).toBe(200);
    expect((await summaryOf(orderId))?.next_due_date).toBe('2026-11-05');
  });

  it('EVM-034 AC6 the status of the order and its type of site reach the projection through their events', async () => {
    const { orderId, siteId } = await scene();
    const editor = await signIn('editor');
    expect((await editor.panel.post(`${BASE}/${orderId}/transitions`, { to: 'quoting' }, { 'If-Match': '"1"' })).status).toBe(200);
    expect((await summaryOf(orderId))?.status).toBe('quoting');
    expect((await summaryOf(orderId))?.site_type).toBe('single_family_house');
    const response = await editor.panel.patch(`/api/v1/sites/${siteId}`, { siteType: 'commercial' }, { 'If-Match': '"1"' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect((await summaryOf(orderId))?.site_type).toBe('commercial');
  });

  it('EVM-034 AC6 two commands on different stages of one order at the same time leave a projection that holds both (test 6, READ COMMITTED)', async () => {
    for (let round = 0; round < 5; round += 1) {
      const { orderId, stageIds, osd } = await scene([{}, {}, {}]);
      const [a, b, c] = stageIds;
      const editors = [await signIn('editor'), await signIn('administrator'), await signIn('editor')];
      const responses = await Promise.all([
        transition(editors[0] as Browser, orderId, a ?? '', { to: 'waiting', waitingOn: 'party', waitingOnPartyId: osd }),
        transition(editors[1] as Browser, orderId, b ?? '', { to: 'waiting', waitingOn: 'customer' }),
        editors[2]?.panel.post(`${BASE}/${orderId}/transitions`, { to: 'quoting' }, { 'If-Match': '"1"' }),
        patchStage(editors[2] as Browser, orderId, c ?? '', { dueDate: '2026-12-01' }),
      ]);
      for (const response of responses) expect(response?.status, JSON.stringify(response?.body)).toBe(200);
      expect(await summaryOf(orderId)).toMatchObject({ status: 'quoting', waiting_count: 2, next_due_date: '2026-12-01' });
      expect(await waitsOf(orderId)).toHaveLength(2);
    }
  });

  it('EVM-034 T8 the same change by the Administrator and by the Editor gives the same row of the projection (the role does not enter it)', async () => {
    const one = await scene([{ dueDate: '2026-10-12' }]);
    const two = await scene([{ dueDate: '2026-10-12' }]);
    const administrator = await signIn('administrator');
    const editor = await signIn('editor');
    const body = { to: 'waiting', waitingOn: 'party' };
    await transition(administrator, one.orderId, one.stageIds[0] ?? '', { ...body, waitingOnPartyId: one.osd });
    await transition(editor, two.orderId, two.stageIds[0] ?? '', { ...body, waitingOnPartyId: two.osd });
    const rows = [await summaryOf(one.orderId), await summaryOf(two.orderId)].map((row) => ({
      ...row,
      work_order_id: undefined,
      longest_waiting_party_id: undefined,
    }));
    expect(rows[0]).toEqual(rows[1]);
    expect(rows[0]).toMatchObject({ waiting_count: 1, longest_waiting_on: 'party', next_due_date: '2026-10-12' });
  });
});

describe('fail closed (EVM-034 AC6; ADR-0017 W2, W12)', () => {
  it('EVM-034 AC6 an event published in a transaction opened by a plain db.transaction() fails: no registry, no silent skip', async () => {
    const { orderId } = await scene();
    const bus = current.app.get<EventBus>(EVENT_BUS, { strict: false });
    await expect(
      admin()
        .transaction()
        .execute((tx) =>
          bus.publish(
            tx,
            {
              type: 'work_order.updated',
              actor: { type: 'user', userId: orderId },
              outcome: 'success',
              objectType: 'work_order',
              objectId: orderId,
            } as never,
            { origin: 'cli', traceId: '0'.repeat(32) },
          ),
        ),
    ).rejects.toThrow(/runInTransaction/);
    expect(() => requirePreCommitRegistry(admin())).toThrow();
  });

  it('EVM-034 AC6 W12 a recomputation that cannot get its lock fails the command (500) and rolls it back — no half of a change', async () => {
    const { orderId, stageIds } = await scene();
    const editor = await signIn('editor');
    let locked!: () => void;
    const hasLock = new Promise<void>((resolve) => (locked = resolve));
    let release!: () => void;
    const mayRelease = new Promise<void>((resolve) => (release = resolve));
    const holder = admin()
      .transaction()
      .execute(async (inner) => {
        await sql`select 1 from overview.work_order_summaries where work_order_id = ${orderId} for update`.execute(inner);
        locked();
        await mayRelease;
      });
    await hasLock;
    const response = await transition(editor, orderId, stageIds[0] ?? '', { to: 'in_progress' });
    release();
    await holder;
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ code: 'internal_error' });
    expect(JSON.stringify(response.body)).not.toMatch(/overview|lock|work_order_summaries|select/i);
    const { rows } = await sql<{ status: string; version: number }>`
      select status, version from procedures.procedure_stages where id = ${stageIds[0] ?? ''}`.execute(admin());
    expect(rows).toEqual([{ status: 'todo', version: 1 }]);
    const metrics = current.app.get<MetricsRegistry>(METRICS, { strict: false });
    expect(metrics.snapshot().find((sample) => sample.name === 'projection_recompute_failed_total')?.value).toBeGreaterThanOrEqual(1);
  }, 30_000);
});

describe('rebuild and verify (EVM-034 AC6; ADR-0017 W11, T7)', () => {
  it('EVM-034 AC6 rebuild fills an empty projection from the sources and a second rebuild changes nothing', async () => {
    const { orderId, osd } = await scene((party) => [
      { status: 'waiting', waitingOn: 'party', waitingOnPartyId: party, waitingSince: '2026-09-18', dueDate: '2026-10-09' },
    ]);
    await sql`delete from overview.work_order_summaries`.execute(admin());
    expect(await summaryOf(orderId)).toBeUndefined();
    const { maintenance } = projectionTools(admin());
    expect(await maintenance.rebuild()).toMatchObject({ rebuilt: 1, skipped: 0 });
    const first = await summaryOf(orderId);
    expect(first).toMatchObject({
      waiting_count: 1,
      longest_waiting_since: '2026-09-18',
      longest_waiting_on: 'party',
      longest_waiting_party_id: osd,
      next_due_date: '2026-10-09',
    });
    expect(await waitsOf(orderId)).toEqual([
      expect.objectContaining({ party_kind: 'distribution_system_operator', waiting_since: '2026-09-18' }) as unknown,
    ]);
    expect(await maintenance.rebuild()).toMatchObject({ rebuilt: 1 });
    expect(await summaryOf(orderId)).toEqual(first);
  });

  it('EVM-034 AC6 verify reports the numbers and the identifiers, by group of columns, and writes nothing to the projection', async () => {
    const { orderId, stageIds, osd } = await scene([{}, {}]);
    await sql`update procedures.procedure_stages set status = 'waiting', waiting_on = 'party', waiting_on_party_id = ${osd},
      waiting_since = '2026-09-18' where id = ${stageIds[0] ?? ''}`.execute(admin());
    await sql`update procedures.procedure_stages set due_date = '2026-10-30' where id = ${stageIds[1] ?? ''}`.execute(admin());
    skipProjectionCheckOnce();
    const { maintenance } = projectionTools(admin());
    const before = await summaryOf(orderId);
    const report = await maintenance.verify({ traceId: '1'.repeat(32) });
    expect(report).toMatchObject({ checked: 1, inSync: 0, missing: [] });
    expect(report.drift.waiting).toEqual([orderId]);
    expect(report.drift.deadline).toEqual([orderId]);
    expect(report.drift.authorization).toEqual([]);
    expect(JSON.stringify(report)).not.toMatch(/2026-09-18|2026-10-30|Operator/);
    expect(await summaryOf(orderId)).toEqual(before);
    await rebuildProjection(admin());
    expect(await maintenance.verify({ traceId: '1'.repeat(32) })).toMatchObject({ checked: 1, inSync: 1 });
  });

  it('EVM-034 AC6 W2 a difference of the authorisation column is a security alert (the outbox), not only a number', async () => {
    const { orderId } = await scene();
    await sql`update overview.work_order_summaries set deleted_at = now() where work_order_id = ${orderId}`.execute(admin());
    skipProjectionCheckOnce();
    const { maintenance } = projectionTools(admin());
    const report = await maintenance.verify({ traceId: '2'.repeat(32) });
    expect(report.drift.authorization).toEqual([orderId]);
    const { rows } = await sql<{ alert_code: string; trace_id: string }>`
      select alert_code, trace_id from platform.security_alert_outbox`.execute(admin());
    expect(rows).toEqual([{ alert_code: 'projection_authz_drift', trace_id: '2'.repeat(32) }]);
    await rebuildProjection(admin());
  });

  it('EVM-034 AC6 rebuild of named orders touches only those; an unknown identifier is skipped without an error', async () => {
    const one = await scene([{ dueDate: '2026-10-20' }]);
    const two = await scene([{ dueDate: '2026-10-21' }]);
    await sql`update overview.work_order_summaries set next_due_date = null`.execute(admin());
    skipProjectionCheckOnce();
    const { maintenance } = projectionTools(admin());
    const report = await maintenance.rebuild({ only: [one.orderId, '01a13115-0000-7000-8000-00000000dead'] });
    expect(report).toMatchObject({ rebuilt: 1 });
    expect((await summaryOf(one.orderId))?.next_due_date).toBe('2026-10-20');
    expect((await summaryOf(two.orderId))?.next_due_date).toBeNull();
    await rebuildProjection(admin());
  });
});

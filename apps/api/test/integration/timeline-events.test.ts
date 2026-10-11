import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertProcedure, type StageSpec } from '../support/procedure-fixtures.ts';
import { insertParty, insertSite } from '../support/site-fixtures.ts';
import { insertEntries } from '../support/timeline-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

const START = Date.parse('2026-10-11T08:00:00.000Z');
const BASE = '/api/v1/work-orders';
const REASON = 'powod-znacznik-synt';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});
let minute = 0;
beforeEach(async () => {
  minute = 0;
  current.clock.set(new Date(START));
  await clearWorkOrderCreation(current.database.admin);
  await sql`delete from platform.idempotency_records`.execute(current.database.admin);
});
/** A new minute for every write: the order of the journal is then the order of the calls. */
const tick = (): void => {
  minute += 1;
  current.clock.set(new Date(START + minute * 60_000));
};

const admin = () => current.database.admin;

async function signIn(role: Role = 'editor', channel: 'web' | 'mobile' = 'web', displayName?: string) {
  const user = await createUser(admin(), current.clock, { role, ...(displayName === undefined ? {} : { displayName }) });
  const session = await createSession(admin(), current.clock, user, { channel });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;

let numbering = 0;
async function order(options: { status?: 'accepted' | 'new' | 'in_progress'; deleted?: boolean; stages?: StageSpec[] } = {}) {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `jan${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [
    {
      number: `ZL-8${String(numbering).padStart(3, '0')}-0001`,
      customerId,
      siteId,
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(options.deleted === true ? { deletedAt: new Date('2026-10-02T08:00:00Z') } : {}),
    },
  ]);
  const id = [...ids.values()][0] ?? '';
  const process = await insertProcedure(admin(), id, {
    stages: options.stages ?? [{ name: 'Warunki przyłączenia i projekt umowy', status: 'in_progress' }],
  });
  return { id, stageIds: process.stageIds };
}

interface EventBody {
  code: string;
  objectType: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  waitingOn: string | null;
  waitingOnParty: { id: string; name: string | null; kind: string | null } | null;
  changedFields: string[];
}
interface Item {
  id: string;
  kind: string;
  body: string | null;
  origin: string;
  procedureStageId: string | null;
  procedureStageName: string | null;
  author: { id: string; displayName: string } | null;
  event: EventBody | null;
}
interface Page {
  items: Item[];
  nextCursor: string | null;
}
const pageOf = (body: unknown) => body as Page;
const codeOf = (body: unknown) => (body as { code?: string }).code;
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;

const journal = (browser: Browser, orderId: string, query = '') => browser.panel.get(`${BASE}/${orderId}/timeline${query}`);
const eventsOf = async (browser: Browser, orderId: string): Promise<Item[]> => {
  const response = await journal(browser, orderId, '?eventGroup=status_changes&limit=100');
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return pageOf(response.body).items;
};
const rawEvents = async (orderId: string) =>
  (
    await sql<{ event_code: string; event_payload: unknown; created_by: string | null; origin: string }>`
      select event_code, event_payload, created_by, origin from timeline.timeline_entries
      where work_order_id = ${orderId} and kind = 'event' order by created_at, id`.execute(admin())
  ).rows;

const transitionOrder = (browser: Browser, orderId: string, version: number, body: unknown, key?: string) => {
  const call = browser.panel.post(`${BASE}/${orderId}/transitions`, body).set('If-Match', `"${version}"`);
  return key === undefined ? call : call.set('Idempotency-Key', key);
};
const transitionStage = (browser: Browser, orderId: string, stageId: string, version: number, body: unknown, key?: string) => {
  const call = browser.panel.post(`${BASE}/${orderId}/procedure-stages/${stageId}/transitions`, body).set('If-Match', `"${version}"`);
  return key === undefined ? call : call.set('Idempotency-Key', key);
};
const patchStage = (browser: Browser, orderId: string, stageId: string, version: number, body: unknown, key?: string) => {
  const call = browser.panel.patch(`${BASE}/${orderId}/procedure-stages/${stageId}`, body).set('If-Match', `"${version}"`);
  return key === undefined ? call : call.set('Idempotency-Key', key);
};
const versionOf = (response: { headers: Record<string, unknown> }): number => Number(String(response.headers['etag']).replaceAll('"', ''));

const auditTotal = async (action: string): Promise<number> =>
  Number((await sql<{ n: string }>`select count(*)::text as n from audit.events where action = ${action}`.execute(admin())).rows[0]?.n);
const recordsTotal = async (): Promise<number> =>
  Number((await sql<{ n: string }>`select count(*)::text as n from platform.idempotency_records`.execute(admin())).rows[0]?.n);

describe('EVM-038 AC1 AC2 AC3 — the events of an order (SR-LOG-03, SR-DATA-01)', () => {
  it('EVM-038 AC1 creating an order writes exactly one event work_order_created with the actor as the author — and a repeat of the key writes none', async () => {
    const editor = await signIn('editor', 'web', 'Anna Testowa');
    const customerId = await insertCustomer(admin(), { email: 'jan-nowy@example.invalid' });
    const siteId = await insertSite(admin());
    const templateId =
      (await sql<{ id: string }>`select id from catalog.work_order_templates where code = 'garage_full_process'`.execute(admin())).rows[0]
        ?.id ?? '';
    const id = uuidv7();
    const key = uuidv7();
    const body = { id, customerId, siteId, templateId };
    const created = await editor.panel.post(BASE, body).set('Idempotency-Key', key);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const replay = await editor.panel.post(BASE, body).set('Idempotency-Key', key);
    expect(replay.headers['idempotent-replayed']).toBe('true');

    const items = await eventsOf(editor, id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'event',
      body: null,
      origin: 'system',
      procedureStageId: null,
      author: { id: editor.userId, displayName: 'Anna Testowa' },
      event: {
        code: 'work_order_created',
        objectType: 'work_order',
        fromStatus: null,
        toStatus: null,
        waitingOnParty: null,
        changedFields: [],
      },
    });
    expect(await rawEvents(id)).toEqual([
      {
        event_code: 'work_order_created',
        event_payload: { objectType: 'work_order', objectId: id },
        created_by: editor.userId,
        origin: 'system',
      },
    ]);
  });

  it('EVM-038 AC1 AC2 every transition of an order writes ONE event with the two status codes — also those that are audited — and the reason is nowhere in it', async () => {
    const editor = await signIn('editor');
    const { id } = await order({ status: 'accepted' });
    const hold = await transitionOrder(editor, id, 1, { to: 'on_hold', reason: REASON });
    expect(hold.status, JSON.stringify(hold.body)).toBe(200);
    tick();
    const resume = await transitionOrder(editor, id, versionOf(hold), { to: 'accepted' });
    expect(resume.status, JSON.stringify(resume.body)).toBe(200);
    tick();
    const cancelledBefore = await auditTotal('work_order.cancelled');
    const cancel = await transitionOrder(editor, id, versionOf(resume), { to: 'cancelled', reason: `${REASON}-anulowanie` });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect(await auditTotal('work_order.cancelled')).toBe(cancelledBefore + 1);

    const items = await eventsOf(editor, id);
    expect(items.map((item) => [item.event?.code, item.event?.fromStatus, item.event?.toStatus])).toEqual([
      ['work_order_status_changed', 'accepted', 'cancelled'],
      ['work_order_status_changed', 'on_hold', 'accepted'],
      ['work_order_status_changed', 'accepted', 'on_hold'],
    ]);
    const raw = await rawEvents(id);
    expect(raw).toHaveLength(3);
    expect(JSON.stringify(raw)).not.toContain(REASON);
    for (const row of raw)
      expect(Object.keys(row.event_payload as object).sort()).toEqual(['fromStatus', 'objectId', 'objectType', 'toStatus']);
  });

  it('EVM-038 AC1 a repeat of a transition with the same key, and a transition that is refused, write no second event', async () => {
    const editor = await signIn('editor');
    const { id, stageIds } = await order({ status: 'accepted' });
    const key = uuidv7();
    expect((await transitionOrder(editor, id, 1, { to: 'on_hold', reason: 'x' }, key)).status).toBe(200);
    const replay = await transitionOrder(editor, id, 1, { to: 'on_hold', reason: 'x' }, key);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    const stale = await transitionOrder(editor, id, 1, { to: 'cancelled', reason: 'x' });
    expect(stale.status).toBe(412);
    expect(await rawEvents(id)).toHaveLength(1);

    const stageKey = uuidv7();
    const stageId = stageIds[0] ?? '';
    const other = await order({ status: 'accepted' });
    const otherStage = other.stageIds[0] ?? '';
    expect((await transitionStage(editor, other.id, otherStage, 1, { to: 'done' }, stageKey)).status).toBe(200);
    const stageReplay = await transitionStage(editor, other.id, otherStage, 1, { to: 'done' }, stageKey);
    expect(stageReplay.headers['idempotent-replayed']).toBe('true');
    expect(await rawEvents(other.id)).toHaveLength(1);
    // a stage of another order: 404 and no event for either order
    expect((await transitionStage(editor, other.id, stageId, 1, { to: 'done' })).status).toBe(404);
    expect(await rawEvents(other.id)).toHaveLength(1);
    expect(await rawEvents(id)).toHaveLength(1);
  });

  it('EVM-038 AC3 AC2 a stage that moves to "Czekamy na…" (a party) writes one event: the codes, the party by identifier, the name and kind from the CURRENT data', async () => {
    const editor = await signIn('editor', 'web', 'Anna Testowa');
    const { id, stageIds } = await order({ status: 'in_progress' });
    const stageId = stageIds[0] ?? '';
    const party = await insertParty(admin(), { displayName: 'Stoen Operator', kind: 'distribution_system_operator' });
    const moved = await transitionStage(editor, id, stageId, 1, { to: 'waiting', waitingOn: 'party', waitingOnPartyId: party });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);

    const [item, ...rest] = await eventsOf(editor, id);
    expect(rest).toHaveLength(0);
    expect(item).toMatchObject({
      kind: 'event',
      procedureStageId: stageId,
      procedureStageName: 'Warunki przyłączenia i projekt umowy',
      author: { id: editor.userId, displayName: 'Anna Testowa' },
      event: {
        code: 'stage_status_changed',
        objectType: 'procedure_stage',
        fromStatus: 'in_progress',
        toStatus: 'waiting',
        waitingOn: 'party',
        waitingOnParty: { id: party, name: 'Stoen Operator', kind: 'distribution_system_operator' },
      },
    });
    const [raw] = await rawEvents(id);
    expect(raw?.event_payload).toEqual({
      objectType: 'procedure_stage',
      objectId: stageId,
      fromStatus: 'in_progress',
      toStatus: 'waiting',
      waitingOn: 'party',
      waitingOnPartyId: party,
    });
    expect(JSON.stringify(raw)).not.toMatch(/Stoen|Warunki/);

    // the names are read from the CURRENT data: a renamed party shows its new name, a deleted one has none
    await sql`update parties.parties set display_name = 'Nowa Nazwa Operatora' where id = ${party}`.execute(admin());
    expect((await eventsOf(editor, id))[0]?.event?.waitingOnParty).toEqual({
      id: party,
      name: 'Nowa Nazwa Operatora',
      kind: 'distribution_system_operator',
    });
    await sql`update parties.parties set deleted_at = ${new Date('2026-10-10T08:00:00Z')} where id = ${party}`.execute(admin());
    expect((await eventsOf(editor, id))[0]?.event?.waitingOnParty).toEqual({ id: party, name: null, kind: null });
  });

  it('EVM-038 AC1 AC2 the reason of a block and the day of completion are not in the event; a block, a completion and a return are one event each', async () => {
    const editor = await signIn('editor');
    const { id, stageIds } = await order({ status: 'in_progress' });
    const stageId = stageIds[0] ?? '';
    const blocked = await transitionStage(editor, id, stageId, 1, { to: 'blocked', blockedReason: REASON });
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(200);
    tick();
    const back = await transitionStage(editor, id, stageId, versionOf(blocked), { to: 'in_progress' });
    expect(back.status).toBe(200);
    tick();
    const done = await transitionStage(editor, id, stageId, versionOf(back), { to: 'done', completedOn: '2026-10-10' });
    expect(done.status).toBe(200);
    const items = await eventsOf(editor, id);
    expect(items.map((item) => [item.event?.fromStatus, item.event?.toStatus, item.event?.waitingOn])).toEqual([
      ['in_progress', 'done', null],
      ['blocked', 'in_progress', null],
      ['in_progress', 'blocked', null],
    ]);
    expect(JSON.stringify(await rawEvents(id))).not.toMatch(new RegExp(`${REASON}|2026-10-10`));
  });

  it('EVM-038 AC1 AC2 a change of the party, of the person and of the term: one event per KIND of change, with the NAMES of the fields only; no change, no event', async () => {
    const editor = await signIn('editor');
    const assignee = await createUser(admin(), current.clock, { role: 'editor', displayName: 'Piotr Nazwiskowy' });
    const { id, stageIds } = await order({ status: 'in_progress' });
    const stageId = stageIds[0] ?? '';
    const first = await insertParty(admin(), { displayName: 'Pierwszy Zarządca' });
    const second = await insertParty(admin(), { displayName: 'Drugi Zarządca' });
    const waiting = await transitionStage(editor, id, stageId, 1, { to: 'waiting', waitingOn: 'party', waitingOnPartyId: first });
    tick();

    const party = await patchStage(editor, id, stageId, versionOf(waiting), { waitingOn: 'party', waitingOnPartyId: second });
    expect(party.status, JSON.stringify(party.body)).toBe(200);
    tick();
    const person = await patchStage(editor, id, stageId, versionOf(party), { responsibleUserId: assignee.id, dueDate: '2026-12-01' });
    expect(person.status, JSON.stringify(person.body)).toBe(200);
    tick();
    // the same values again, and a new "since" alone: a new version, but nothing changed in what the journal tells
    const same = await patchStage(editor, id, stageId, versionOf(person), { responsibleUserId: assignee.id, dueDate: '2026-12-01' });
    expect(same.status).toBe(200);
    tick();
    const since = await patchStage(editor, id, stageId, versionOf(same), {
      waitingOn: 'party',
      waitingOnPartyId: second,
      waitingSince: '2026-10-05',
    });
    expect(since.status, JSON.stringify(since.body)).toBe(200);
    tick();
    // both kinds in one patch: two entries, one per kind (the party, then the term)
    const both = await patchStage(editor, id, stageId, versionOf(since), { waitingOn: 'customer', dueDate: null });
    expect(both.status, JSON.stringify(both.body)).toBe(200);

    const items = await eventsOf(editor, id);
    expect(items.map((item) => item.event?.code)).toEqual([
      'stage_updated',
      'stage_waiting_on_changed',
      'stage_updated',
      'stage_waiting_on_changed',
      'stage_status_changed',
    ]);
    expect(items[0]?.event).toMatchObject({ changedFields: ['dueDate'] });
    expect(items[1]?.event).toMatchObject({ waitingOn: 'customer', waitingOnParty: null });
    expect(items[2]?.event).toMatchObject({ changedFields: ['responsibleUserId', 'dueDate'] });
    expect(items[3]?.event).toMatchObject({ waitingOn: 'party', waitingOnParty: { id: second, name: 'Drugi Zarządca' } });
    const raw = JSON.stringify(await rawEvents(id));
    expect(raw).not.toMatch(/Piotr|Nazwiskowy|Zarządca|2026-12-01/);
    expect(raw).not.toContain(assignee.id);
  });
});

describe('EVM-038 AC4 — the filter "Zmiany statusów" (SR-INPUT-01, SR-API-04)', () => {
  it('EVM-038 AC4 eventGroup=status_changes returns only the events, in pages that keep their position; without it the entries and the events are together', async () => {
    const editor = await signIn('editor');
    const { id, stageIds } = await order({ status: 'in_progress' });
    const stageId = stageIds[0] ?? '';
    await insertEntries(admin(), id, editor.userId, [{ kind: 'note' }, { kind: 'comment' }]);
    const first = await transitionStage(editor, id, stageId, 1, { to: 'blocked', blockedReason: 'x' });
    tick();
    const second = await transitionStage(editor, id, stageId, versionOf(first), { to: 'in_progress' });
    tick();
    await transitionStage(editor, id, stageId, versionOf(second), { to: 'done' });

    const all = pageOf((await journal(editor, id)).body).items;
    expect(all.map((item) => item.kind).sort()).toEqual(['comment', 'event', 'event', 'event', 'note']);
    const filtered = await journal(editor, id, '?eventGroup=status_changes&limit=2');
    expect(pageOf(filtered.body).items.map((item) => item.kind)).toEqual(['event', 'event']);
    const next = await journal(editor, id, `?eventGroup=status_changes&limit=2&cursor=${pageOf(filtered.body).nextCursor}`);
    expect(pageOf(next.body).items.map((item) => item.kind)).toEqual(['event']);
    expect(pageOf(next.body).nextCursor).toBeNull();
    // the filter of a stage combines with it (AND)
    const staged = await journal(editor, id, `?eventGroup=status_changes&procedureStageId=${stageId}`);
    expect(pageOf(staged.body).items).toHaveLength(3);
    const noOther = await journal(editor, id, `?eventGroup=status_changes&procedureStageId=${uuidv7()}`);
    expect(pageOf(noOther.body).items).toHaveLength(0);
  });

  it('EVM-038 AC4 a group outside the list and a group together with kind are 400 validation_failed; a cursor of another filter is 400 invalid_cursor', async () => {
    const editor = await signIn('editor');
    const { id, stageIds } = await order({ status: 'in_progress' });
    const stageId = stageIds[0] ?? '';
    await insertEntries(admin(), id, editor.userId, [{ kind: 'note' }, { kind: 'note' }]);
    await transitionStage(editor, id, stageId, 1, { to: 'done' });
    for (const query of [
      '?eventGroup=payments',
      '?eventGroup=',
      '?eventGroup=status_changes&kind=note',
      '?kind=event',
      "?eventGroup=status_changes'--",
    ]) {
      const response = await journal(editor, id, query);
      expect(response.status, query).toBe(400);
      expect(codeOf(response.body), query).toBe('validation_failed');
    }
    const plain = pageOf((await journal(editor, id, '?limit=1')).body);
    const withGroup = await journal(editor, id, `?eventGroup=status_changes&cursor=${plain.nextCursor}`);
    expect(withGroup.status).toBe(400);
    expect(codeOf(withGroup.body)).toBe('invalid_cursor');
    const grouped = pageOf((await journal(editor, id, '?eventGroup=status_changes&limit=1')).body);
    expect(grouped.nextCursor).toBeNull();
  });
});

describe('EVM-038 AC5 — one transaction (SR-API-06; ASVS V2.3.3)', () => {
  /** A write of an event that fails — the journal is the only thing that breaks; removed in `finally`. */
  async function withFailingEventWrite(run: () => Promise<void>): Promise<void> {
    await sql`
      create function timeline.fail_event_write() returns trigger language plpgsql as $$
      begin
        if new.kind = 'event' then raise exception 'the journal refuses an event' using errcode = 'EV999'; end if;
        return new;
      end $$`.execute(admin());
    await sql`create trigger fail_event_write before insert on timeline.timeline_entries
      for each row execute function timeline.fail_event_write()`.execute(admin());
    try {
      await run();
    } finally {
      await sql`drop trigger fail_event_write on timeline.timeline_entries`.execute(admin());
      await sql`drop function timeline.fail_event_write()`.execute(admin());
    }
  }

  it('EVM-038 AC5 when the event cannot be written, the transition of a stage is not stored: status, version, audit and the idempotency record are as before', async () => {
    const editor = await signIn('editor');
    const { id, stageIds } = await order({ status: 'in_progress' });
    const stageId = stageIds[0] ?? '';
    const auditBefore = await auditTotal('procedure_stage.transitioned');
    const recordsBefore = await recordsTotal();
    await withFailingEventWrite(async () => {
      const response = await transitionStage(editor, id, stageId, 1, { to: 'blocked', blockedReason: REASON }, uuidv7());
      expect(response.status).toBe(500);
      expect(codeOf(response.body)).toBe('internal_error');
      expect(JSON.stringify(response.body)).not.toMatch(/journal refuses|EV999|timeline|trigger|powod/i);
    });
    const { rows } = await sql<{ status: string; version: number; blocked_reason: string | null }>`
      select status, version, blocked_reason from procedures.procedure_stages where id = ${stageId}`.execute(admin());
    expect(rows[0]).toEqual({ status: 'in_progress', version: 1, blocked_reason: null });
    expect(await auditTotal('procedure_stage.transitioned')).toBe(auditBefore);
    expect(await recordsTotal()).toBe(recordsBefore);
    expect(await rawEvents(id)).toHaveLength(0);
    // after the fault is gone the same command works
    expect((await transitionStage(editor, id, stageId, 1, { to: 'blocked', blockedReason: 'x' })).status).toBe(200);
  });

  it('EVM-038 AC5 the same for the PATCH of a stage, the transition of an order and the creation of an order', async () => {
    const editor = await signIn('editor');
    const stage = await order({ status: 'in_progress' });
    const held = await order({ status: 'accepted' });
    const customerId = await insertCustomer(admin(), { email: 'jan-awaria@example.invalid' });
    const siteId = await insertSite(admin());
    const templateId =
      (await sql<{ id: string }>`select id from catalog.work_order_templates where code = 'garage_full_process'`.execute(admin())).rows[0]
        ?.id ?? '';
    const newId = uuidv7();
    const stageId = stage.stageIds[0] ?? '';
    const counts = async () => ({
      updated: await auditTotal('procedure_stage.updated'),
      cancelled: await auditTotal('work_order.cancelled'),
      created: await auditTotal('work_order.created'),
      orders: Number((await sql<{ n: string }>`select count(*)::text as n from work_orders.work_orders`.execute(admin())).rows[0]?.n),
      records: await recordsTotal(),
    });
    const before = await counts();
    await withFailingEventWrite(async () => {
      const patched = await patchStage(editor, stage.id, stageId, 1, { dueDate: '2026-12-01' }, uuidv7());
      const cancelled = await transitionOrder(editor, held.id, 1, { to: 'cancelled', reason: REASON }, uuidv7());
      const created = await editor.panel.post(BASE, { id: newId, customerId, siteId, templateId }).set('Idempotency-Key', uuidv7());
      expect([patched.status, cancelled.status, created.status]).toEqual([500, 500, 500]);
    });
    expect(await counts()).toEqual(before);
    const { rows } = await sql<{ due_date: string | null; version: number }>`
      select to_char(due_date, 'YYYY-MM-DD') as due_date, version from procedures.procedure_stages where id = ${stageId}`.execute(admin());
    expect(rows[0]).toEqual({ due_date: null, version: 1 });
    const order1 = await sql<{
      status: string;
      version: number;
    }>`select status, version from work_orders.work_orders where id = ${held.id}`.execute(admin());
    expect(order1.rows[0]).toEqual({ status: 'accepted', version: 1 });
  });
});

describe('EVM-038 AC6 — only the server writes events (SR-INPUT-01, SR-AUTHZ-04)', () => {
  const create = (browser: Browser, orderId: string, body: unknown) =>
    browser.panel.post(`${BASE}/${orderId}/timeline`, body).set('Idempotency-Key', uuidv7());

  it('EVM-038 AC6 a client that sends kind=event, or the fields of an event, gets 400 and nothing is written; an entry cannot correct an event', async () => {
    const editor = await signIn('editor');
    const { id } = await order({ status: 'in_progress' });
    const [event] = await insertEntries(admin(), id, editor.userId, [{ kind: 'event' }]);
    const before = (await rawEvents(id)).length;
    const attempts: unknown[] = [
      { id: uuidv7(), kind: 'event', body: 'Zmiana statusu' },
      { id: uuidv7(), kind: 'event' },
      { id: uuidv7(), kind: 'note', noteCategory: 'other', body: 'Wpis', origin: 'system' },
      { id: uuidv7(), kind: 'note', noteCategory: 'other', body: 'Wpis', eventCode: 'stage_status_changed' },
      { id: uuidv7(), kind: 'note', noteCategory: 'other', body: 'Wpis', event_code: 'stage_status_changed', event_payload: {} },
      { id: uuidv7(), kind: 'note', noteCategory: 'other', body: 'Wpis', event: { code: 'stage_status_changed' } },
    ];
    for (const body of attempts) {
      const response = await create(editor, id, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(codeOf(response.body), JSON.stringify(body)).toBe('validation_failed');
    }
    const correct = await create(editor, id, {
      id: uuidv7(),
      kind: 'note',
      noteCategory: 'other',
      body: 'Poprawka',
      supersedesEntryId: event,
    });
    expect(correct.status).toBe(400);
    expect(errorsOf(correct.body)).toEqual([{ pointer: '/supersedesEntryId', code: 'unknown_entry' }]);
    expect((await rawEvents(id)).length).toBe(before);
    const { rows } = await sql<{
      n: string;
    }>`select count(*)::text as n from timeline.timeline_entries where work_order_id = ${id}`.execute(admin());
    expect(rows[0]?.n).toBe('1');
  });

  it('EVM-038 AC6 there is no route that changes an event ("Popraw wpis" does not exist for it)', async () => {
    const editor = await signIn('editor');
    const { id } = await order({ status: 'in_progress' });
    const [event] = await insertEntries(admin(), id, editor.userId, [{ kind: 'event' }]);
    const url = `${BASE}/${id}/timeline/${event}`;
    expect((await editor.panel.patch(url, { body: 'x' }, { 'If-Match': '"1"' })).status).toBe(404);
  });
});

describe('EVM-038 AC7 — roles, channel and the order the caller may not see (SR-AUTHZ-02, SR-AUTHZ-05)', () => {
  it('EVM-038 AC7 Administrator, Editor and Read-only see the events; no session is 401; a mobile token is 403', async () => {
    const editor = await signIn('editor');
    const { id, stageIds } = await order({ status: 'in_progress' });
    await transitionStage(editor, id, stageIds[0] ?? '', 1, { to: 'done' });
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const browser = await signIn(role);
      const response = await journal(browser, id, '?eventGroup=status_changes');
      expect(response.status, role).toBe(200);
      expect(pageOf(response.body).items).toHaveLength(1);
      expect(pageOf(response.body).items[0]?.event?.code).toBe('stage_status_changed');
      const detail = await browser.panel.get(`${BASE}/${id}/timeline/${pageOf(response.body).items[0]?.id}`);
      expect(detail.status, role).toBe(200);
      expect((detail.body as Item).event?.toStatus).toBe('done');
    }
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    const refused = await anonymous.get(`${BASE}/${id}/timeline?eventGroup=status_changes`);
    expect(refused.status).toBe(401);
    expect(JSON.stringify(refused.body)).not.toContain('stage_status_changed');
    const mobile = await signIn('editor', 'mobile');
    const channel = await journal(mobile, id, '?eventGroup=status_changes');
    expect(channel.status).toBe(403);
    expect(JSON.stringify(channel.body)).not.toContain('stage_status_changed');
  });

  it('EVM-038 AC7 SR-AUTHZ-02 the events of order B never appear in the journal of order A, also with a cursor made for A; a missing or deleted order is 404', async () => {
    const editor = await signIn('editor');
    const reader = await signIn('read_only');
    const orderA = await order({ status: 'in_progress', stages: [{}, {}] });
    const orderB = await order({ status: 'in_progress', stages: [{}, {}] });
    await transitionStage(editor, orderA.id, orderA.stageIds[0] ?? '', 1, { to: 'done' });
    tick();
    await transitionStage(editor, orderA.id, orderA.stageIds[1] ?? '', 1, { to: 'done' });
    tick();
    await transitionStage(editor, orderB.id, orderB.stageIds[0] ?? '', 1, { to: 'blocked', blockedReason: 'x' });

    const listA = await eventsOf(reader, orderA.id);
    const listB = await eventsOf(reader, orderB.id);
    expect(listA).toHaveLength(2);
    expect(listB).toHaveLength(1);
    expect(listA.every((item) => item.procedureStageId !== null && orderA.stageIds.includes(item.procedureStageId))).toBe(true);
    expect(listB.map((item) => item.id).some((itemId) => listA.map((item) => item.id).includes(itemId))).toBe(false);

    const cursor = pageOf((await journal(reader, orderA.id, '?eventGroup=status_changes&limit=1')).body).nextCursor;
    const crossed = await journal(reader, orderB.id, `?eventGroup=status_changes&limit=1&cursor=${cursor}`);
    expect(crossed.status).toBe(400);
    expect(codeOf(crossed.body)).toBe('invalid_cursor');
    // the stage of another order is only a filter that matches nothing
    const foreign = await journal(reader, orderA.id, `?eventGroup=status_changes&procedureStageId=${orderB.stageIds[0]}`);
    expect(pageOf(foreign.body).items).toHaveLength(0);

    const deleted = await order({ status: 'in_progress', deleted: true });
    for (const role of ['editor', 'read_only'] as const) {
      const browser = await signIn(role);
      expect((await journal(browser, uuidv7(), '?eventGroup=status_changes')).status).toBe(404);
      expect((await journal(browser, deleted.id, '?eventGroup=status_changes')).status).toBe(404);
    }
  });
});

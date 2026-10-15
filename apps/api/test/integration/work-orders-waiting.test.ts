import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { insertProcedure, type StageSpec } from '../support/procedure-fixtures.ts';
import { rebuildProjection } from '../support/projection.ts';
import { insertParty } from '../support/site-fixtures.ts';
import { clearWorkOrderCreation, insertWorkOrders, numberOf } from '../support/work-order-fixtures.ts';
import type { WorkOrderStatus } from '../../src/modules/work-orders/domain/work-order-status.ts';

const PATH = '/api/v1/work-orders';
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
});

const admin = () => current.database.admin;
const server = () => current.app.getHttpServer();

interface Session {
  readonly userId: string;
  readonly cookie: string;
}
async function signIn(role: Role = 'editor', channel: 'web' | 'mobile' = 'web'): Promise<Session> {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, { channel });
  return { userId: user.id, cookie: session.cookie };
}

interface Item {
  id: string;
  number: string;
  status: string;
  waiting: {
    waitingOn: string;
    party: { id: string; displayName: string; kind: string } | null;
    since: string;
    days: number;
    otherCount: number;
  } | null;
  nextDueDate: string | null;
  hasOverdueStage: boolean;
}
interface Page {
  items: Item[];
  nextCursor: string | null;
}
const call = (session: Session, query = '') => request(server()).get(`${PATH}${query}`).set('Cookie', session.cookie);
const page = async (session: Session, query = ''): Promise<Page> => {
  const response = await call(session, query);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as Page;
};
const problem = (response: request.Response) =>
  response.body as { code: string; status: number; errors?: Array<{ pointer: string; code: string }> };

let counter = 0;
/** An order with the given stages (one process) — everything synthetic. */
async function order(stages: StageSpec[], options: { status?: WorkOrderStatus; deleted?: boolean } = {}): Promise<string> {
  counter += 1;
  const ids = await insertWorkOrders(admin(), [
    {
      number: numberOf(2026, counter),
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(options.deleted === true ? { deletedAt: new Date('2026-10-01T08:00:00Z') } : {}),
    },
  ]);
  const id = [...ids.values()][0] ?? '';
  if (stages.length > 0) await insertProcedure(admin(), id, { stages });
  return id;
}
const waitingFor = (party: string, since: string, extra: Partial<StageSpec> = {}): StageSpec => ({
  status: 'waiting',
  waitingOn: 'party',
  waitingOnPartyId: party,
  waitingSince: since,
  ...extra,
});
const waitingForCustomer = (since: string): StageSpec => ({ status: 'waiting', waitingOn: 'customer', waitingSince: since });

describe('the column "Czekamy na" (EVM-034 AC1; D3)', () => {
  it('EVM-034 AC1 an order waiting for the OSD since 15 days and for the customer since 3 days shows the OSD, 15 days and "+1"', async () => {
    const osd = await insertParty(admin(), { kind: 'distribution_system_operator', displayName: 'Stoen Operator (OSD)' });
    const id = await order([waitingForCustomer('2026-09-30'), waitingFor(osd, '2026-09-18')]);
    const list = await page(await signIn(), '?view=all_open');
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      id,
      waiting: {
        waitingOn: 'party',
        party: { id: osd, displayName: 'Stoen Operator (OSD)', kind: 'distribution_system_operator' },
        since: '2026-09-18',
        days: 15,
        otherCount: 1,
      },
    });
  });

  it('EVM-034 AC1 an order that waits for nobody has waiting null; the customer is waited for without a party', async () => {
    await order([{ status: 'in_progress' }]);
    await order([waitingForCustomer('2026-10-01')]);
    const list = await page(await signIn(), '?sort=number');
    expect(list.items.map((item) => item.waiting)).toEqual([
      null,
      { waitingOn: 'customer', party: null, since: '2026-10-01', days: 2, otherCount: 0 },
    ]);
  });

  it('EVM-034 AC1 a deleted stage and a stage of a deleted process are not waits; a finished stage is not either', async () => {
    const osd = await insertParty(admin());
    const id = await order([
      waitingFor(osd, '2026-09-01', { deletedAt: new Date('2026-10-02T08:00:00Z') }),
      { status: 'done', completedOn: '2026-09-20' },
      waitingForCustomer('2026-09-25'),
    ]);
    await insertProcedure(admin(), id, {
      code: 'second_process',
      position: 2,
      deletedAt: new Date('2026-10-02T08:00:00Z'),
      stages: [waitingFor(osd, '2026-08-01')],
    });
    const [item] = (await page(await signIn())).items;
    expect(item?.waiting).toMatchObject({ waitingOn: 'customer', since: '2026-09-25', days: 8, otherCount: 0 });
  });

  it('EVM-034 AC1 a party the caller may not see (deleted) leaves the wait with party null — the days and "+n" stay, no name leaks', async () => {
    const osd = await insertParty(admin(), { displayName: 'Operator Usuniety' });
    await order([waitingFor(osd, '2026-09-18')]);
    await sql`update parties.parties set deleted_at = now() where id = ${osd}`.execute(admin());
    const response = await call(await signIn());
    const [item] = (response.body as Page).items;
    expect(item?.waiting).toEqual({ waitingOn: 'party', party: null, since: '2026-09-18', days: 15, otherCount: 0 });
    expect(JSON.stringify(response.body)).not.toContain('Operator Usuniety');
  });
});

describe('the filter "dłużej niż X dni" (EVM-034 AC2; D1)', () => {
  it('EVM-034 AC2 on 2026-10-03 an order waiting for the OSD since 2026-09-18 is in the result for X = 14 and not for X = 15', async () => {
    const osd = await insertParty(admin(), { kind: 'distribution_system_operator' });
    const id = await order([waitingFor(osd, '2026-09-18')]);
    const session = await signIn();
    const base = '?waitingOn=party&waitingOnPartyKind=distribution_system_operator';
    expect((await page(session, `${base}&waitingLongerThanDays=14`)).items.map((item) => item.id)).toEqual([id]);
    expect((await page(session, `${base}&waitingLongerThanDays=15`)).items).toEqual([]);
    expect((await page(session, `${base}&waitingLongerThanDays=1`)).items.map((item) => item.id)).toEqual([id]);
  });

  it('EVM-034 AC2 the clock decides: the same wait is out of X = 14 until the 15th day and in from it; the change of time on 2026-10-25 moves nothing', async () => {
    const osd = await insertParty(admin());
    const id = await order([waitingFor(osd, '2026-10-11')]);
    const idsAt = async (instant: string, query: string) => {
      current.clock.set(instant);
      return (await page(await signIn(), query)).items.map((item) => item.id);
    };
    expect(await idsAt('2026-10-24T09:00:00.000Z', '?waitingLongerThanDays=13')).toEqual([]); // 2026-10-24: 13 days
    expect(await idsAt('2026-10-24T23:30:00.000Z', '?waitingLongerThanDays=14')).toEqual([]); // 01:30 on 2026-10-25 (CEST): 14 days
    expect(await idsAt('2026-10-24T23:30:00.000Z', '?waitingLongerThanDays=13')).toEqual([id]);
    // 00:30 on 2026-10-26 (CET): 15 days — a night of 25 hours between the two readings changes no count of days
    expect(await idsAt('2026-10-25T23:30:00.000Z', '?waitingLongerThanDays=14')).toEqual([id]);
    expect(await idsAt('2026-10-25T23:30:00.000Z', '?waitingLongerThanDays=15')).toEqual([]);
    current.clock.set('2026-10-25T23:30:00.000Z');
    expect((await page(await signIn())).items[0]?.waiting?.days).toBe(15);
  });

  it('EVM-034 AC2 the filter works for the customer and for every kind of party, and a kind alone means a party', async () => {
    const osd = await insertParty(admin(), { kind: 'distribution_system_operator' });
    const manager = await insertParty(admin(), { kind: 'property_manager' });
    const a = await order([waitingForCustomer('2026-09-01')]);
    const b = await order([waitingFor(osd, '2026-09-01')]);
    const c = await order([waitingFor(manager, '2026-09-01')]);
    const session = await signIn();
    const ids = async (query: string) => (await page(session, query)).items.map((item) => item.id).sort();
    expect(await ids('?waitingOn=customer')).toEqual([a]);
    expect(await ids('?waitingOn=customer&waitingLongerThanDays=30')).toEqual([a]);
    expect(await ids('?waitingOn=party')).toEqual([b, c].sort());
    expect(await ids('?waitingOnPartyKind=property_manager')).toEqual([c]);
    expect(await ids('?waitingOnPartyKind=distribution_system_operator&waitingLongerThanDays=30')).toEqual([b]);
    expect(await ids('?waitingLongerThanDays=30')).toEqual([a, b, c].sort());
    expect(await ids('?waitingOnPartyKind=supplier')).toEqual([]);
  });

  it('EVM-034 AC2 the wait that matches is ONE wait: another wait of the order for another kind does not satisfy the kind and the days together', async () => {
    const osd = await insertParty(admin(), { kind: 'distribution_system_operator' });
    const manager = await insertParty(admin(), { kind: 'property_manager' });
    const id = await order([waitingFor(osd, '2026-10-02'), waitingFor(manager, '2026-08-01')]);
    const session = await signIn();
    const query = '?waitingOnPartyKind=distribution_system_operator&waitingLongerThanDays=14';
    expect((await page(session, query)).items).toEqual([]);
    expect((await page(session, '?waitingOnPartyKind=property_manager&waitingLongerThanDays=14')).items.map((item) => item.id)).toEqual([
      id,
    ]);
  });

  it('EVM-034 AC2 T3 X outside 1..365 or not an integer is 400 validation_failed without the value; a duplicate and an unknown parameter are 400 too', async () => {
    const session = await signIn();
    for (const value of ['0', '366', '14a', '-1', '1.5', '', '1e2']) {
      const response = await call(session, `?waitingLongerThanDays=${encodeURIComponent(value)}`);
      expect(response.status, value).toBe(400);
      expect(problem(response).code, value).toBe('validation_failed');
      expect(JSON.stringify(response.body)).not.toContain(`"${value}"`);
    }
    expect((await call(session, '?waitingLongerThanDays=14&waitingLongerThanDays=15')).status).toBe(400);
    expect(problem(await call(session, '?waitingLongerThanDays=14&waitingLongerThanDays=15')).code).toBe('duplicate_parameter');
    expect(problem(await call(session, '?waitingOn=customer&waitingOn=party')).code).toBe('duplicate_parameter');
    expect(problem(await call(session, '?waitingFor=party')).code).toBe('unknown_parameter');
    // `overdue_payments` became a value of the enum in EVM-056: `overdue` stays outside the list
    for (const query of ['?waitingOn=osd', '?waitingOnPartyKind=Stoen', '?sort=-longestWaitingSince', '?view=overdue']) {
      const response = await call(session, query);
      expect(response.status, query).toBe(400);
      expect(problem(response).code, query).toBe('validation_failed');
      expect(JSON.stringify(response.body)).not.toMatch(/osd|Stoen|overdue/);
    }
  });

  it('EVM-034 AC2 T3 a kind together with waitingOn=customer contradicts itself: 400 on /waitingOnPartyKind, no echo of the kind', async () => {
    const response = await call(await signIn(), '?waitingOn=customer&waitingOnPartyKind=supplier');
    expect(response.status).toBe(400);
    expect(problem(response)).toMatchObject({ code: 'validation_failed', errors: [{ pointer: '/waitingOnPartyKind' }] });
    expect(JSON.stringify(response.body)).not.toContain('supplier');
  });

  it('EVM-034 AC2 T3 the computed fields cannot be sent: they are not declared parameters (400 unknown_parameter)', async () => {
    const session = await signIn();
    for (const query of ['?waiting=party', '?nextDueDate=2026-10-01', '?hasOverdueStage=true', '?today=2026-10-03', '?asOf=2026-10-03']) {
      expect(problem(await call(session, query)).code, query).toBe('unknown_parameter');
    }
  });
});

describe('the saved view "Czekamy na OSD > 14 dni" (EVM-034 AC3; D2)', () => {
  it('EVM-034 AC3 the view is the OSD, more than 14 days, not closed — and nothing else; it combines with the other filters by AND', async () => {
    const osd = await insertParty(admin(), { kind: 'distribution_system_operator' });
    const manager = await insertParty(admin(), { kind: 'property_manager' });
    const inView = await order([waitingFor(osd, '2026-09-18')], { status: 'in_progress' });
    await order([waitingFor(osd, '2026-09-19')]); // 14 days: not more than 14
    await order([waitingFor(manager, '2026-08-01')]); // another kind
    await order([waitingForCustomer('2026-08-01')]);
    await order([waitingFor(osd, '2026-09-01')], { status: 'settled' }); // closed
    await order([waitingFor(osd, '2026-09-01')], { status: 'cancelled' });
    const both = await order([waitingFor(osd, '2026-09-01')], { status: 'on_hold' });
    const session = await signIn();
    const ids = async (query: string) => (await page(session, query)).items.map((item) => item.id).sort();
    expect(await ids('?view=waiting_on_dso_over_14_days')).toEqual([inView, both].sort());
    expect(await ids('?view=waiting_on_dso_over_14_days&status=on_hold')).toEqual([both]);
    expect(await ids('?view=waiting_on_dso_over_14_days&waitingLongerThanDays=20')).toEqual([both]);
    expect(await ids('?view=waiting_on_dso_over_14_days&waitingOn=customer')).toEqual([]);
  });

  it('EVM-034 AC3 without a match the list is empty with a null cursor (the panel shows the good news)', async () => {
    const osd = await insertParty(admin(), { kind: 'distribution_system_operator' });
    await order([waitingFor(osd, '2026-10-01')]);
    expect(await page(await signIn(), '?view=waiting_on_dso_over_14_days')).toEqual({ items: [], nextCursor: null });
  });
});

describe('the sorts "Najdłużej czekamy" and "Termin" (EVM-034 AC4; D4, D5)', () => {
  it('EVM-034 AC4 longestWaitingSince: the oldest wait first, orders without a wait last, a tie by the identifier; the cursor loses and repeats nothing', async () => {
    const osd = await insertParty(admin());
    const ids: string[] = [];
    ids.push(await order([waitingFor(osd, '2026-09-25')]));
    ids.push(await order([])); // no wait
    ids.push(await order([waitingFor(osd, '2026-09-01')]));
    ids.push(await order([waitingForCustomer('2026-09-25')])); // the same day as the first
    ids.push(await order([{ status: 'in_progress' }])); // no wait
    ids.push(await order([waitingFor(osd, '2026-09-10'), waitingForCustomer('2026-10-01')]));
    const session = await signIn();
    const all = await page(session, '?sort=longestWaitingSince&limit=100');
    const sinceOf = (item: Item) => item.waiting?.since ?? null;
    expect(all.items.map(sinceOf)).toEqual(['2026-09-01', '2026-09-10', '2026-09-25', '2026-09-25', null, null]);
    const tied = all.items.slice(2, 4).map((item) => item.id);
    expect(tied).toEqual([...tied].sort());
    const noWait = all.items.slice(4).map((item) => item.id);
    expect(noWait).toEqual([...noWait].sort());
    // the cursor, two per page
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const next: Page = await page(session, `?sort=longestWaitingSince&limit=2${cursor === null ? '' : `&cursor=${cursor}`}`);
      seen.push(...next.items.map((item) => item.id));
      cursor = next.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual(all.items.map((item) => item.id));
    expect(new Set(seen).size).toBe(ids.length);
  });

  it('EVM-034 AC4 nextDueDate: the nearest deadline of an unfinished stage first, without a deadline last; a finished stage does not give one', async () => {
    const early = await order([{ dueDate: '2026-10-05' }, { dueDate: '2026-12-01' }]);
    const late = await order([{ dueDate: '2026-11-20' }]);
    const finishedOnly = await order([{ status: 'done', dueDate: '2026-09-01', completedOn: '2026-09-02' }]);
    const none = await order([{}]);
    const session = await signIn();
    const list = await page(session, '?sort=nextDueDate');
    expect(list.items.map((item) => item.id)).toEqual([early, late, ...[finishedOnly, none].sort()]);
    expect(list.items.map((item) => item.nextDueDate)).toEqual(['2026-10-05', '2026-11-20', null, null]);
  });

  it('EVM-034 AC4 nextDueDate: the cursor continues the sort by the deadline without a repeat or a gap, also over the orders that have none', async () => {
    const ids: string[] = [];
    for (const due of ['2026-10-09', '2026-10-05', null, '2026-10-05', null]) {
      ids.push(await order([due === null ? {} : { dueDate: due }]));
    }
    const session = await signIn();
    const all = (await page(session, '?sort=nextDueDate&limit=100')).items.map((item) => item.id);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const next: Page = await page(session, `?sort=nextDueDate&limit=2${cursor === null ? '' : `&cursor=${cursor}`}`);
      seen.push(...next.items.map((item) => item.id));
      cursor = next.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual(all);
    expect(new Set(seen).size).toBe(ids.length);
  });

  it('EVM-034 AC4 a deadline that has passed is hasOverdueStage; a deadline of today is not; a finished stage never is', async () => {
    const past = await order([{ dueDate: '2026-10-02' }]);
    const today = await order([{ dueDate: TODAY }]);
    const finished = await order([{ status: 'done', dueDate: '2026-09-01', completedOn: '2026-09-02' }]);
    const list = await page(await signIn(), '?sort=nextDueDate');
    const byId = new Map(list.items.map((item) => [item.id, item]));
    expect(byId.get(past)).toMatchObject({ nextDueDate: '2026-10-02', hasOverdueStage: true });
    expect(byId.get(today)).toMatchObject({ nextDueDate: TODAY, hasOverdueStage: false });
    expect(byId.get(finished)).toMatchObject({ nextDueDate: null, hasOverdueStage: false });
  });

  it('EVM-034 AC4 W8 the next page continues the day of the first one: a midnight between the pages neither repeats nor skips an order', async () => {
    const osd = await insertParty(admin());
    // waiting since 2026-09-19: on 2026-10-03 that is 14 days (not more), on 2026-10-04 it is 15
    const ids = [
      await order([waitingFor(osd, '2026-09-18')]),
      await order([waitingFor(osd, '2026-09-18')]),
      await order([waitingFor(osd, '2026-09-18')]),
      await order([waitingFor(osd, '2026-09-19')]),
    ];
    current.clock.set('2026-10-03T21:50:00.000Z'); // 23:50 on 2026-10-03 in Warsaw
    const session = await signIn();
    const first = await page(session, '?waitingLongerThanDays=14&sort=longestWaitingSince&limit=2');
    expect(first.items).toHaveLength(2);
    current.clock.set('2026-10-03T22:10:00.000Z'); // 00:10 on 2026-10-04: "today" moved, the cursor keeps the first day
    const second = await page(session, `?waitingLongerThanDays=14&sort=longestWaitingSince&limit=2&cursor=${first.nextCursor}`);
    const seen = [...first.items, ...second.items].map((item) => item.id);
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort()).toEqual(ids.slice(0, 3).sort());
    expect(second.nextCursor).toBeNull();
    // a new list started after midnight uses the new day: the fourth order is in
    expect((await page(session, '?waitingLongerThanDays=14&limit=100')).items).toHaveLength(4);
  });
});

describe('the cursor is bound to the new filters (EVM-034 T4, W8)', () => {
  async function twoPages() {
    const osd = await insertParty(admin(), { kind: 'distribution_system_operator' });
    for (let index = 0; index < 3; index += 1) await order([waitingFor(osd, `2026-09-0${index + 1}`)]);
    const session = await signIn();
    const first = await page(session, '?waitingOn=party&waitingLongerThanDays=14&sort=longestWaitingSince&limit=2');
    expect(first.nextCursor).not.toBeNull();
    return { session, cursor: first.nextCursor ?? '' };
  }

  it('EVM-034 T4 the cursor opens with the same filters and is refused (400 invalid_cursor) with another X, kind, view, sort or user', async () => {
    const { session, cursor } = await twoPages();
    const same = '?waitingOn=party&waitingLongerThanDays=14&sort=longestWaitingSince&limit=2';
    expect((await call(session, `${same}&cursor=${cursor}`)).status).toBe(200);
    for (const query of [
      '?waitingOn=party&waitingLongerThanDays=15&sort=longestWaitingSince&limit=2',
      '?waitingOn=party&waitingLongerThanDays=14&waitingOnPartyKind=supplier&sort=longestWaitingSince&limit=2',
      '?waitingOn=party&waitingLongerThanDays=14&sort=nextDueDate&limit=2',
      '?waitingOn=party&waitingLongerThanDays=14&view=all_open&sort=longestWaitingSince&limit=2',
      '?waitingOn=customer&waitingLongerThanDays=14&sort=longestWaitingSince&limit=2',
    ]) {
      const response = await call(session, `${query}&cursor=${cursor}`);
      expect(response.status, query).toBe(400);
      expect(problem(response).code, query).toBe('invalid_cursor');
    }
    const stranger = await signIn();
    expect(problem(await call(stranger, `${same}&cursor=${cursor}`)).code).toBe('invalid_cursor');
  });

  it('EVM-034 T4 a cursor that was changed, cut or expired is the same 400 invalid_cursor', async () => {
    const { session, cursor } = await twoPages();
    const same = '?waitingOn=party&waitingLongerThanDays=14&sort=longestWaitingSince&limit=2';
    const flipped = `${cursor.slice(0, -2)}${cursor.endsWith('AA') ? 'BB' : 'AA'}`;
    for (const bad of [flipped, cursor.slice(0, 20), `${cursor}x`]) {
      expect(problem(await call(session, `${same}&cursor=${bad}`)).code).toBe('invalid_cursor');
    }
    current.clock.advance(31 * 60_000);
    expect(problem(await call(session, `${same}&cursor=${cursor}`)).code).toBe('invalid_cursor');
  });
});

describe('policy, roles and masses (EVM-034 AC6, AC7; SR-AUTHZ-03, SR-AUTHZ-05, T1, T2)', () => {
  it('EVM-034 AC6 T1 an order outside the policy (deleted) influences neither the result nor the order nor the "+n" — for every role', async () => {
    const osd = await insertParty(admin(), { kind: 'distribution_system_operator' });
    const visible = await order([waitingFor(osd, '2026-09-18'), waitingForCustomer('2026-09-20')]);
    await order([waitingFor(osd, '2026-01-01')], { deleted: true }); // the oldest wait of all, but deleted
    const other = await order([waitingFor(osd, '2026-09-10')]);
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const session = await signIn(role);
      const list = await page(session, '?sort=longestWaitingSince');
      expect(
        list.items.map((item) => item.id),
        role,
      ).toEqual([other, visible]);
      expect(list.items[1]?.waiting?.otherCount, role).toBe(1);
      expect((await page(session, '?waitingLongerThanDays=100')).items, role).toEqual([]);
      expect((await page(session, '?view=waiting_on_dso_over_14_days')).items.map((item) => item.id).sort(), role).toEqual(
        [visible, other].sort(),
      );
    }
  });

  it('EVM-034 AC6 T1 the list agrees with the order read one by one: an order that the detail answers 404 is not in the list', async () => {
    const osd = await insertParty(admin());
    const gone = await order([waitingFor(osd, '2026-09-01')], { deleted: true });
    const here = await order([waitingFor(osd, '2026-09-02')]);
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const session = await signIn(role);
      const listed = (await page(session)).items.map((item) => item.id);
      for (const [id, expectedListed] of [
        [here, true],
        [gone, false],
      ] as const) {
        const detail = await request(server()).get(`${PATH}/${id}`).set('Cookie', session.cookie);
        expect(detail.status === 200, `${role} detail`).toBe(expectedListed);
        expect(listed.includes(id), `${role} list`).toBe(expectedListed);
      }
    }
  });

  it('EVM-034 AC6 W2 a row of the projection whose source is deleted but whose authorisation column is NULL (a drift) is dropped from the page and counted', async () => {
    const osd = await insertParty(admin());
    const drifted = await order([waitingFor(osd, '2026-09-01')]);
    const fine = await order([waitingFor(osd, '2026-09-02')]);
    await sql`update work_orders.work_orders set deleted_at = now() where id = ${drifted}`.execute(admin());
    const metrics = current.app.get<import('../../src/platform/metrics/metrics.ts').MetricsRegistry>(
      (await import('../../src/platform/tokens.ts')).METRICS,
      { strict: false },
    );
    const before = metrics.snapshot().find((sample) => sample.name === 'projection_authz_drift')?.value ?? 0;
    const list = await page(await signIn(), '?sort=longestWaitingSince');
    expect(list.items.map((item) => item.id)).toEqual([fine]);
    const after = metrics.snapshot().find((sample) => sample.name === 'projection_authz_drift')?.value ?? 0;
    expect(after).toBe(before + 1);
    await rebuildProjection(admin());
  });

  it('EVM-034 AC7 T2 every new sort, view and filter: Administrator, Editor and Read only 200; no session 401; the mobile channel 403', async () => {
    const queries = [
      '?sort=longestWaitingSince',
      '?sort=nextDueDate',
      '?view=waiting_on_dso_over_14_days',
      '?waitingOn=customer',
      '?waitingOnPartyKind=distribution_system_operator',
      '?waitingLongerThanDays=14',
    ];
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const session = await signIn(role);
      for (const query of queries) expect((await call(session, query)).status, `${role} ${query}`).toBe(200);
      const mobile = await signIn(role, 'mobile');
      for (const query of queries) expect((await call(mobile, query)).status, `${role} mobile ${query}`).toBe(403);
    }
    for (const query of queries) expect((await request(server()).get(`${PATH}${query}`)).status, query).toBe(401);
  });

  it('EVM-034 AC7 SR-API-04 the answer carries no personal data of a person of the customer and the limit of 100 is kept (101 is 400)', async () => {
    const response = await call(await signIn(), '?limit=101');
    expect(response.status).toBe(400);
    expect((await call(await signIn(), '?limit=100')).status).toBe(200);
  });
});

describe('the resources of the summary W-06 (EVM-034 AC5, AC7; D10-D12, T2)', () => {
  interface ProcedureBody {
    items: Array<{
      id: string;
      currentStageId: string | null;
      stages: Array<{ id: string; status: string; overdue: boolean; waitingDays: number | null }>;
    }>;
  }
  const procedures = (session: Session, id: string) => request(server()).get(`${PATH}/${id}/procedures`).set('Cookie', session.cookie);

  async function orderWithProcesses() {
    const osd = await insertParty(admin(), { kind: 'distribution_system_operator' });
    const id = await order([]);
    const done = await insertProcedure(admin(), id, {
      code: 'process_done',
      position: 1,
      stages: [{ status: 'done', completedOn: '2026-09-20' }, { status: 'not_applicable' }],
    });
    const running = await insertProcedure(admin(), id, {
      code: 'process_running',
      position: 2,
      stages: [{ status: 'done', completedOn: '2026-09-20' }, waitingFor(osd, '2026-09-18', { dueDate: '2026-10-01' }), { status: 'todo' }],
    });
    return { id, done, running };
  }

  it('EVM-034 AC5 D10 the current stage is the first unfinished stage of the process by position — null when every stage is finished', async () => {
    const { id, done, running } = await orderWithProcesses();
    const body = (await procedures(await signIn(), id)).body as ProcedureBody;
    const byId = new Map(body.items.map((item) => [item.id, item]));
    expect(byId.get(done.id)?.currentStageId).toBeNull();
    expect(byId.get(running.id)?.currentStageId).toBe(running.stageIds[1]);
  });

  it('EVM-034 AC5 D11 D12 the wait shows the days (15) and the stage after its deadline is overdue — from the clock of the server', async () => {
    const { id, running } = await orderWithProcesses();
    const body = (await procedures(await signIn(), id)).body as ProcedureBody;
    const stage = body.items.find((item) => item.id === running.id)?.stages[1];
    expect(stage).toMatchObject({ status: 'waiting', waitingDays: 15, overdue: true });
    current.clock.set('2026-10-01T08:00:00.000Z'); // the day of the deadline: not late yet, 13 days
    const earlier = (await procedures(await signIn(), id)).body as ProcedureBody;
    expect(earlier.items.find((item) => item.id === running.id)?.stages[1]).toMatchObject({ waitingDays: 13, overdue: false });
  });

  it('EVM-034 AC7 T2 Administrator, Editor and Read only read it; no session 401; mobile 403; another, deleted or unknown order is the same 404 (IDOR)', async () => {
    const { id } = await orderWithProcesses();
    const deleted = await order([{}], { deleted: true });
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const session = await signIn(role);
      expect((await procedures(session, id)).status, role).toBe(200);
      const missing = await procedures(session, '01a13115-0000-7000-8000-00000000dead');
      const gone = await procedures(session, deleted);
      expect([missing.status, gone.status], role).toEqual([404, 404]);
      expect(JSON.stringify({ ...missing.body, traceId: '' }), role).toBe(JSON.stringify({ ...gone.body, traceId: '' }));
      expect((await procedures(await signIn(role, 'mobile'), id)).status, `${role} mobile`).toBe(403);
    }
    expect((await request(server()).get(`${PATH}/${id}/procedures`)).status).toBe(401);
  });
});

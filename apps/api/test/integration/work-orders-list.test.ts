import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MINUTE } from '../support/clock.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { ALL_STATUSES, insertWorkOrders, numberOf, type WorkOrderSpec } from '../support/work-order-fixtures.ts';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  await sql`delete from work_orders.work_order_assignments`.execute(current.database.admin);
  await sql`delete from work_orders.work_orders`.execute(current.database.admin);
});

const PATH = '/api/v1/work-orders';
const server = () => current.app.getHttpServer();

interface Session {
  readonly userId: string;
  readonly cookie: string;
}
interface Item {
  id: string;
  number: string;
  title: string;
  status: string;
  coordinator: { id: string; displayName: string } | null;
  createdAt: string;
}
interface Page {
  items: Item[];
  nextCursor: string | null;
}

/** A signed-in browser session of a NEW user of the role (a user has their own mass-read window). */
async function signIn(role: Role = 'editor', options: { channel?: 'web' | 'mobile' } = {}): Promise<Session> {
  const user = await createUser(current.database.admin, current.clock, { role });
  const session = await createSession(current.database.admin, current.clock, user, options);
  return { userId: user.id, cookie: session.cookie };
}
const call = (session: Session, query = '') => request(server()).get(`${PATH}${query}`).set('Cookie', session.cookie);
const page = async (session: Session, query = ''): Promise<Page> => {
  const response = await call(session, query);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as Page;
};
const numbers = (list: Page): string[] => list.items.map((item) => item.number);
const orders = (count: number, make: (index: number) => Partial<WorkOrderSpec> = () => ({})): WorkOrderSpec[] =>
  Array.from({ length: count }, (_, index) => ({ number: numberOf(2026, index + 1), ...make(index) }));

/** Follows `nextCursor` until the end; returns the pages. */
async function allPages(session: Session, query: string, limit: number): Promise<Page[]> {
  const pages: Page[] = [];
  let cursor: string | null = null;
  do {
    const next: Page = await page(
      session,
      `?${query}${query === '' ? '' : '&'}limit=${limit}${cursor === null ? '' : `&cursor=${cursor}`}`,
    );
    pages.push(next);
    cursor = next.nextCursor;
  } while (cursor !== null);
  return pages;
}
const problemOf = (response: request.Response) => response.body as { code: string; status: number; errors?: unknown };

describe('the default view and the columns of the list (EVM-017 AC1)', () => {
  it('EVM-017 AC1 the view "all_open" has no settled and no cancelled orders and is sorted by number, newest first', async () => {
    const session = await signIn();
    await insertWorkOrders(
      current.database.admin,
      ALL_STATUSES.map((status, index) => ({ number: numberOf(2026, index + 1), status })),
    );
    const list = await page(session, '?view=all_open');
    expect(numbers(list)).toEqual([
      numberOf(2026, 7), // on_hold
      numberOf(2026, 5), // completed
      numberOf(2026, 4), // in_progress
      numberOf(2026, 3), // accepted
      numberOf(2026, 2), // quoting
      numberOf(2026, 1), // new
    ]);
    expect(list.items.map((item) => item.status)).not.toContain('settled');
    expect(list.items.map((item) => item.status)).not.toContain('cancelled');
    expect(list.nextCursor).toBeNull();
  });

  it('EVM-017 AC1 without `view` there is no view predicate (the closed orders are listed): the default view is the choice of the panel', async () => {
    const session = await signIn();
    await insertWorkOrders(
      current.database.admin,
      ALL_STATUSES.map((status, index) => ({ number: numberOf(2026, index + 1), status })),
    );
    expect((await page(session)).items).toHaveLength(8);
  });

  it('EVM-017 AC1 each item is the number, title, status, coordinator {id, displayName} or null, and the creation time — and nothing else', async () => {
    const session = await signIn();
    const coordinator = await createUser(current.database.admin, current.clock, { role: 'editor', displayName: 'Opiekun Testowy' });
    await insertWorkOrders(current.database.admin, [
      {
        number: numberOf(2026, 1),
        title: 'Wallbox — dom #1',
        status: 'quoting',
        coordinatorId: coordinator.id,
        createdAt: new Date('2026-10-01T08:30:00.000Z'),
      },
      { number: numberOf(2026, 2) },
    ]);
    const list = await page(session, '?sort=number');
    const [first, second] = list.items;
    expect(first).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
      number: numberOf(2026, 1),
      title: 'Wallbox — dom #1',
      status: 'quoting',
      coordinator: { id: coordinator.id, displayName: 'Opiekun Testowy' },
      createdAt: '2026-10-01T08:30:00.000Z',
    });
    expect(second?.coordinator).toBeNull();
    expect(Object.keys(first ?? {}).sort()).toEqual(['coordinator', 'createdAt', 'id', 'number', 'status', 'title']);
    expect(JSON.stringify(list)).not.toContain(coordinator.email);
    expect(Object.keys(first?.coordinator ?? {}).sort()).toEqual(['displayName', 'id']);
  });

  it('EVM-017 AC1 an ended coordinator assignment is not the coordinator; the current one is shown', async () => {
    const session = await signIn();
    const former = await createUser(current.database.admin, current.clock, { role: 'editor', displayName: 'Były Opiekun' });
    const present = await createUser(current.database.admin, current.clock, { role: 'editor', displayName: 'Obecny Opiekun' });
    await insertWorkOrders(current.database.admin, [
      { number: numberOf(2026, 1), formerCoordinatorId: former.id },
      { number: numberOf(2026, 2), formerCoordinatorId: former.id, coordinatorId: present.id },
    ]);
    const list = await page(session, '?sort=number');
    expect(list.items.map((item) => item.coordinator?.displayName ?? null)).toEqual([null, 'Obecny Opiekun']);
    expect(numbers(await page(session, `?coordinatorId=${former.id}`))).toEqual([]);
  });

  it('EVM-017 AC1 an empty list is an empty array and a null cursor', async () => {
    expect(await page(await signIn())).toEqual({ items: [], nextCursor: null });
  });

  it('EVM-017 AC1 the response is never cached (SR-API-03)', async () => {
    const response = await call(await signIn());
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['content-type']).toContain('application/json');
  });
});

describe('filters, views and sorting (EVM-017 AC2; SR-INPUT-01, SR-INPUT-03)', () => {
  it('EVM-017 AC2 several statuses are an "or" within the filter; the list is normalised (order and duplicates do not matter)', async () => {
    const session = await signIn();
    await insertWorkOrders(
      current.database.admin,
      ALL_STATUSES.map((status, index) => ({ number: numberOf(2026, index + 1), status })),
    );
    const expected = [numberOf(2026, 4), numberOf(2026, 2)];
    expect(numbers(await page(session, '?status=quoting,in_progress'))).toEqual(expected);
    expect(numbers(await page(session, '?status=in_progress,quoting,in_progress'))).toEqual(expected);
    expect(numbers(await page(session, '?status=settled'))).toEqual([numberOf(2026, 6)]);
  });

  it('EVM-017 AC2 the filters combine with AND: a closed status inside the view "all_open" gives nothing', async () => {
    const session = await signIn();
    await insertWorkOrders(
      current.database.admin,
      ALL_STATUSES.map((status, index) => ({ number: numberOf(2026, index + 1), status })),
    );
    expect(await page(session, '?view=all_open&status=settled,cancelled')).toEqual({ items: [], nextCursor: null });
    expect(numbers(await page(session, '?view=all_open&status=new,settled'))).toEqual([numberOf(2026, 1)]);
  });

  it('EVM-017 AC2 "mine" is the orders whose coordinator is the user of the session; nobody else is taken from the request', async () => {
    const me = await signIn('editor');
    const other = await createUser(current.database.admin, current.clock, { role: 'editor' });
    await insertWorkOrders(current.database.admin, [
      { number: numberOf(2026, 1), coordinatorId: me.userId },
      { number: numberOf(2026, 2), coordinatorId: other.id },
      { number: numberOf(2026, 3) },
      { number: numberOf(2026, 4), coordinatorId: me.userId, status: 'settled' },
    ]);
    expect(numbers(await page(me, '?view=mine'))).toEqual([numberOf(2026, 4), numberOf(2026, 1)]);
    expect(numbers(await page(me, '?view=mine&status=new'))).toEqual([numberOf(2026, 1)]);
    // the same query of the other person is THEIR orders: the view follows the session, not the query
    const otherSession = await createSession(current.database.admin, current.clock, { id: other.id, email: other.email, role: 'editor' });
    expect(numbers(await page({ userId: other.id, cookie: otherSession.cookie }, '?view=mine'))).toEqual([numberOf(2026, 2)]);
  });

  it('EVM-017 AC2 a parameter that would name the user of "mine" (userId, coordinator, assigneeId) is 400 unknown_parameter', async () => {
    const session = await signIn();
    for (const query of [`?view=mine&userId=${randomUUID()}`, `?view=mine&coordinator=${randomUUID()}`, `?assigneeId=${randomUUID()}`]) {
      const response = await call(session, query);
      expect([response.status, problemOf(response).code], query).toEqual([400, 'unknown_parameter']);
    }
  });

  it('EVM-017 AC2 a coordinator filter shows the orders of ANY coordinator to every role (RR-13); an unknown or invalid id is an empty list, a malformed one is 400', async () => {
    const coordinator = await createUser(current.database.admin, current.clock, { role: 'editor' });
    const deactivated = await createUser(current.database.admin, current.clock, { role: 'editor', status: 'deactivated' });
    await insertWorkOrders(current.database.admin, [
      { number: numberOf(2026, 1), coordinatorId: coordinator.id },
      { number: numberOf(2026, 2) },
    ]);
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      expect(numbers(await page(await signIn(role), `?coordinatorId=${coordinator.id}`)), role).toEqual([numberOf(2026, 1)]);
    }
    const session = await signIn();
    expect(await page(session, `?coordinatorId=${randomUUID()}`)).toEqual({ items: [], nextCursor: null });
    expect(await page(session, `?coordinatorId=${deactivated.id}`)).toEqual({ items: [], nextCursor: null });
    for (const value of ['abc', '1', `${coordinator.id}x`, '']) {
      const response = await call(session, `?coordinatorId=${value}`);
      expect([response.status, problemOf(response).code], value).toEqual([400, 'validation_failed']);
    }
  });

  it('EVM-017 AC2 the sort is by number or by creation time, in both directions', async () => {
    const session = await signIn();
    const times = [5, 1, 4, 2, 3].map((minute) => new Date(Date.UTC(2026, 9, 1, 8, minute)));
    await insertWorkOrders(
      current.database.admin,
      orders(5, (index) => ({ createdAt: times[index] })),
    );
    const n = (...indexes: number[]) => indexes.map((index) => numberOf(2026, index));
    expect(numbers(await page(session, '?sort=-number'))).toEqual(n(5, 4, 3, 2, 1));
    expect(numbers(await page(session, '?sort=number'))).toEqual(n(1, 2, 3, 4, 5));
    expect(numbers(await page(session, '?sort=createdAt'))).toEqual(n(2, 4, 5, 3, 1));
    expect(numbers(await page(session, '?sort=-createdAt'))).toEqual(n(1, 3, 5, 4, 2));
  });

  it('EVM-017 AC2 the number is compared bytewise, not by the collation of the database: the order does not depend on pl-PL', async () => {
    const session = await signIn();
    await insertWorkOrders(current.database.admin, [
      { number: 'ZL-2026-0010' },
      { number: 'ZL-2026-0009' },
      { number: 'ZL-2025-9999' },
      { number: 'ZL-2026-0100' },
    ]);
    expect(numbers(await page(session, '?sort=number'))).toEqual(['ZL-2025-9999', 'ZL-2026-0009', 'ZL-2026-0010', 'ZL-2026-0100']);
  });

  it('EVM-017 AC2 an undeclared parameter is 400 unknown_parameter and a repeated one 400 duplicate_parameter (also a repeated sort)', async () => {
    const session = await signIn();
    for (const query of ['?q=abc', '?offset=1', '?page=2', '?__proto__=1', '?Status=new']) {
      const response = await call(session, query);
      expect([response.status, problemOf(response).code], query).toEqual([400, 'unknown_parameter']);
    }
    for (const query of [
      '?status=new&status=quoting',
      '?sort=number&sort=-number',
      '?limit=5&limit=6',
      '?view=mine&view=all_open',
      '?cursor=a&cursor=b',
    ]) {
      const response = await call(session, query);
      expect([response.status, problemOf(response).code], query).toEqual([400, 'duplicate_parameter']);
    }
  });

  it('EVM-017 AC2 a value outside the list is 400 validation_failed with a pointer and a code, never the value (sort, view, status, limit)', async () => {
    const session = await signIn();
    const bad = [
      '?sort=number_desc',
      '?sort=created_asc',
      '?sort=%2Bnumber',
      '?sort=title',
      '?sort=',
      '?view=everything',
      '?view=',
      '?status=',
      '?status=new,',
      '?status=,new',
      '?status=new,,quoting',
      '?status=archived',
      '?status=NEW',
      '?status=new;drop',
      `?status=${'new,'.repeat(100)}new`,
      '?limit=0',
      '?limit=101',
      '?limit=-1',
      '?limit=25abc',
      '?limit=1e2',
      '?limit=2.5',
      '?limit=',
      '?limit=%2025',
    ];
    for (const query of bad) {
      const response = await call(session, query);
      expect([response.status, problemOf(response).code], query).toEqual([400, 'validation_failed']);
      expect(JSON.stringify(response.body), query).not.toMatch(/archived|drop|everything|number_desc/);
    }
  });

  it('EVM-017 AC2 the filters are parameters, not SQL: a value built to inject is a validation error or an empty list, and the table is intact', async () => {
    const session = await signIn();
    await insertWorkOrders(current.database.admin, orders(3));
    for (const query of [
      "?status=new'--",
      '?status=new%27%3B%20drop%20table%20work_orders.work_orders%3B--',
      "?coordinatorId=' or 1=1 --",
    ]) {
      expect((await call(session, query)).status, query).toBe(400);
    }
    expect(numbers(await page(session))).toHaveLength(3);
  });
});

describe('cursor pagination (EVM-017 AC3; SR-API-04)', () => {
  it('EVM-017 AC3 60 orders in pages of 25 are 25, 25 and 10, with no repeat and no gap, in every sort; the last page has no cursor', async () => {
    const session = await signIn();
    await insertWorkOrders(current.database.admin, orders(60));
    for (const sort of ['-number', 'number', '-createdAt', 'createdAt']) {
      const pages = await allPages(session, `sort=${sort}`, 25);
      expect(
        pages.map((p) => p.items.length),
        sort,
      ).toEqual([25, 25, 10]);
      expect(pages.at(-1)?.nextCursor, sort).toBeNull();
      const all = pages.flatMap(numbers);
      expect(new Set(all).size, sort).toBe(60);
      const expected = Array.from({ length: 60 }, (_, index) => numberOf(2026, index + 1));
      expect(all, sort).toEqual(sort.startsWith('-') ? [...expected].reverse() : expected);
    }
  });

  it('EVM-017 AC3 orders with the SAME creation time are paged without a repeat or a gap (the id breaks the tie, in the direction of the sort)', async () => {
    const session = await signIn();
    const sameTime = new Date('2026-10-01T08:00:00.000Z');
    await insertWorkOrders(
      current.database.admin,
      orders(60, () => ({ createdAt: sameTime })),
    );
    for (const sort of ['createdAt', '-createdAt']) {
      const pages = await allPages(session, `sort=${sort}`, 25);
      const ids = pages.flatMap((p) => p.items.map((item) => item.id));
      expect(ids, sort).toHaveLength(60);
      expect(new Set(ids).size, sort).toBe(60);
      const sorted = [...ids].sort();
      expect(ids, sort).toEqual(sort === 'createdAt' ? sorted : [...sorted].reverse());
    }
  });

  it('EVM-017 AC3 paging with filters keeps them: the pages of a status filter hold only that status', async () => {
    const session = await signIn();
    await insertWorkOrders(
      current.database.admin,
      orders(60, (index) => ({ status: index % 2 === 0 ? 'new' : 'settled' })),
    );
    const pages = await allPages(session, 'status=new,settled', 25);
    expect(pages.flatMap(numbers)).toHaveLength(60);
    const open = await allPages(session, 'view=all_open', 7);
    expect(open.flatMap((p) => p.items.map((item) => item.status))).toEqual(Array(30).fill('new'));
  });

  it('EVM-017 AC3 the default page is 25 and limit 100 is allowed; limit 101 is 400', async () => {
    const session = await signIn();
    await insertWorkOrders(current.database.admin, orders(110));
    expect((await page(session)).items).toHaveLength(25);
    expect((await page(session, '?limit=100')).items).toHaveLength(100);
    expect((await page(session, '?limit=100')).nextCursor).not.toBeNull();
    const response = await call(session, '?limit=101');
    expect([response.status, problemOf(response).code]).toEqual([400, 'validation_failed']);
  });

  it('EVM-017 AC3 the cursor is opaque: base64url, within 512 characters, and shows neither the number nor the user', async () => {
    const session = await signIn();
    await insertWorkOrders(current.database.admin, orders(30));
    const { nextCursor } = await page(session, '?limit=10');
    expect(nextCursor).toMatch(/^[A-Za-z0-9_-]{20,512}$/);
    const decoded = Buffer.from(nextCursor ?? '', 'base64url').toString('latin1');
    expect(decoded).not.toContain('ZL-2026');
    expect(decoded).not.toContain(session.userId);
  });

  it('EVM-017 AC3 a cursor that was changed, is not ours, is empty or too long is 400 invalid_cursor with no detail', async () => {
    const session = await signIn();
    await insertWorkOrders(current.database.admin, orders(30));
    const { nextCursor } = await page(session, '?limit=10');
    const token = nextCursor ?? '';
    const middle = Math.floor(token.length / 2);
    const flipped = `${token.slice(0, middle)}${token[middle] === 'A' ? 'B' : 'A'}${token.slice(middle + 1)}`;
    for (const value of [
      flipped,
      token.slice(0, -2),
      `${token}AA`,
      'AAAA',
      'not-a-cursor',
      Buffer.from('[1,2]').toString('base64url'),
      'A'.repeat(512),
    ]) {
      const response = await call(session, `?limit=10&cursor=${value}`);
      expect([response.status, problemOf(response).code], value.slice(0, 20)).toEqual([400, 'invalid_cursor']);
      expect(Object.keys(response.body as object).sort()).toEqual(['code', 'status', 'title', 'traceId', 'type']);
    }
    for (const value of ['A'.repeat(513), 'a+b', 'a b', 'a=']) {
      const response = await call(session, `?cursor=${encodeURIComponent(value)}`);
      expect([response.status, problemOf(response).code], value.slice(0, 20)).toEqual([400, 'validation_failed']);
    }
  });

  it('EVM-017 AC3 a cursor used with other filters or another sort is 400 invalid_cursor; with the same filters in any order it works', async () => {
    const session = await signIn();
    await insertWorkOrders(
      current.database.admin,
      orders(30, (index) => ({ status: index % 2 === 0 ? 'new' : 'quoting' })),
    );
    const { nextCursor } = await page(session, '?view=all_open&status=new,quoting&limit=5');
    const cursor = nextCursor ?? '';
    for (const query of [
      `?view=all_open&status=new&limit=5&cursor=${cursor}`,
      `?view=all_open&status=new,quoting&sort=number&limit=5&cursor=${cursor}`,
      `?status=new,quoting&limit=5&cursor=${cursor}`,
      `?view=all_open&status=new,quoting&coordinatorId=${randomUUID()}&limit=5&cursor=${cursor}`,
      `?view=mine&status=new,quoting&limit=5&cursor=${cursor}`,
    ]) {
      const response = await call(session, query);
      expect([response.status, problemOf(response).code], query).toEqual([400, 'invalid_cursor']);
    }
    expect((await call(session, `?limit=5&status=quoting,new,quoting&view=all_open&cursor=${cursor}`)).status).toBe(200);
    expect((await call(session, `?view=all_open&status=new,quoting&limit=3&cursor=${cursor}`)).status).toBe(200); // `limit` is not part of the filters
  });

  it('EVM-017 AC3 a cursor of one user does not work for another, even with the same role and filters', async () => {
    const first = await signIn('editor');
    const second = await signIn('editor');
    await insertWorkOrders(current.database.admin, orders(30));
    const { nextCursor } = await page(first, '?limit=10');
    const response = await call(second, `?limit=10&cursor=${nextCursor}`);
    expect([response.status, problemOf(response).code]).toEqual([400, 'invalid_cursor']);
    expect((await call(first, `?limit=10&cursor=${nextCursor}`)).status).toBe(200);
  });

  it('EVM-017 AC3 a cursor expires after 30 minutes', async () => {
    const session = await signIn();
    await insertWorkOrders(current.database.admin, orders(30));
    const { nextCursor } = await page(session, '?limit=10');
    current.clock.advance(29 * MINUTE);
    expect((await call(session, `?limit=10&cursor=${nextCursor}`)).status).toBe(200);
    current.clock.advance(2 * MINUTE);
    const response = await call(session, `?limit=10&cursor=${nextCursor}`);
    expect([response.status, problemOf(response).code]).toEqual([400, 'invalid_cursor']);
  });
});

describe('the read policy is a condition of the query (EVM-017 AC6; SR-AUTHZ-03)', () => {
  const DELETED = [25, 26, 50]; // ranks: the last row of page 1, the first row of page 2, the last row of page 2

  it('EVM-017 AC6 a deleted order is on no page for the Editor, the Read-only role and the Administrator', async () => {
    const live = orders(60);
    const deletedAt = new Date('2026-10-02T08:00:00.000Z');
    await insertWorkOrders(current.database.admin, [...live, { number: 'ZL-2027-0001', title: 'Usunięte', deletedAt }]);
    for (const role of ['editor', 'read_only', 'administrator'] as const) {
      const pages = await allPages(await signIn(role), '', 25);
      expect(pages.flatMap(numbers), role).not.toContain('ZL-2027-0001');
      expect(pages.flatMap(numbers), role).toHaveLength(60);
    }
  });

  it('EVM-017 AC6 deleted orders ON the page boundaries do not change the pages: the same cursor, the same page count, the same items as if they never existed', async () => {
    const deletedAt = new Date('2026-10-02T08:00:00.000Z');
    const session = await signIn();
    for (const sort of ['number', '-number', 'createdAt', '-createdAt']) {
      // the ranks 25, 26 and 50 of the ORDER OF THE SORT: the last row of page 1, the first of page 2, the last of page 2
      const indexes = DELETED.map((rank) => (sort.startsWith('-') ? 63 - rank : rank - 1));
      const specs = orders(63).map((spec, index) => (indexes.includes(index) ? { ...spec, deletedAt } : spec));
      const control = orders(63).filter((_, index) => !indexes.includes(index));
      const deletedNumbers = indexes.map((index) => numberOf(2026, index + 1));
      await sql`delete from work_orders.work_orders`.execute(current.database.admin);
      await insertWorkOrders(current.database.admin, specs);
      const withDeleted = await allPages(session, `sort=${sort}`, 25);
      await sql`delete from work_orders.work_orders`.execute(current.database.admin);
      await insertWorkOrders(current.database.admin, control);
      const without = await allPages(session, `sort=${sort}`, 25);
      expect(
        withDeleted.map((p) => p.items.length),
        sort,
      ).toEqual([25, 25, 10]);
      expect(
        withDeleted.map((p) => p.items.length),
        sort,
      ).toEqual(without.map((p) => p.items.length));
      expect(
        withDeleted.map((p) => p.nextCursor === null),
        sort,
      ).toEqual([false, false, true]);
      expect(withDeleted.flatMap(numbers), sort).toEqual(without.flatMap(numbers));
      for (const deleted of deletedNumbers) expect(withDeleted.flatMap(numbers), sort).not.toContain(deleted);
    }
  });

  it('EVM-017 AC6 a deleted order does not appear through the coordinator filter or "mine" either', async () => {
    const me = await signIn('editor');
    await insertWorkOrders(current.database.admin, [
      { number: numberOf(2026, 1), coordinatorId: me.userId },
      { number: numberOf(2026, 2), coordinatorId: me.userId, deletedAt: new Date('2026-10-02T08:00:00.000Z') },
    ]);
    expect(numbers(await page(me, '?view=mine'))).toEqual([numberOf(2026, 1)]);
    expect(numbers(await page(me, `?coordinatorId=${me.userId}`))).toEqual([numberOf(2026, 1)]);
  });
});

describe('who may read the list (EVM-017 AC7; SR-AUTHZ-05)', () => {
  it('EVM-017 AC7 the Administrator, the Editor and the Read-only role read the list on the web channel', async () => {
    await insertWorkOrders(current.database.admin, orders(2));
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const response = await call(await signIn(role));
      expect([role, response.status]).toEqual([role, 200]);
    }
  });

  it('EVM-017 AC7 an anonymous caller gets 401 and no order, whatever the query', async () => {
    await insertWorkOrders(current.database.admin, orders(2));
    for (const query of ['', '?view=all_open', '?cursor=abc', '?bogus=1']) {
      const response = await request(server()).get(`${PATH}${query}`);
      expect([response.status, problemOf(response).code], query).toEqual([401, 'unauthenticated']);
      expect(JSON.stringify(response.body)).not.toContain('ZL-');
    }
  });

  it('EVM-017 AC7 the mobile channel is not allowed in M1 (403 forbidden), also for the roles of the web', async () => {
    for (const role of ['administrator', 'editor'] as const) {
      const response = await call(await signIn(role, { channel: 'mobile' }));
      expect([response.status, problemOf(response).code], role).toEqual([403, 'forbidden']);
    }
  });
});

describe('what is logged (EVM-017 AC1; SR-LOG-02, SR-API-04)', () => {
  it('EVM-017 AC1 the log has neither the titles, nor the cursor, nor the filter values, nor the names of coordinators', async () => {
    const session = await signIn();
    const coordinator = await createUser(current.database.admin, current.clock, { role: 'editor', displayName: 'Opiekun Do Logów' });
    await insertWorkOrders(
      current.database.admin,
      orders(30, () => ({ title: 'Jan Przykładowy — wallbox ul. Syntetyczna 7', coordinatorId: coordinator.id })),
    );
    const first = await page(session, `?limit=10&coordinatorId=${coordinator.id}&status=new`);
    await page(session, `?limit=10&coordinatorId=${coordinator.id}&status=new&cursor=${first.nextCursor}`);
    const text = current.logs.text;
    expect(text).toContain('/api/v1/work-orders');
    for (const secret of ['Przykładowy', 'Syntetyczna', 'Opiekun Do Logów', coordinator.id, first.nextCursor ?? 'x', 'coordinatorId']) {
      expect(text.includes(secret), secret).toBe(false);
    }
  });
});

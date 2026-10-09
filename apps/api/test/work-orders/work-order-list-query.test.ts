import { randomUUID } from 'node:crypto';
import { AUTHZ_MANIFEST } from '@evia/contracts/authz';
import { zWorkOrderSort, zWorkOrderStatus, zWorkOrderView } from '@evia/contracts/zod';
import { describe, expect, it } from 'vitest';
import {
  CLOSED_STATUSES,
  DEFAULT_LIMIT,
  SORT_RULES,
  WORK_ORDER_STATUSES,
  filterPartsOf,
  parsePosition,
  positionParts,
  resolveWorkOrderListQuery,
  workOrderListQuerySchema,
} from '../../src/modules/work-orders/domain/work-order-list-query.ts';

const parse = (query: Record<string, string>) => resolveWorkOrderListQuery.safeParse(query);
const ok = (query: Record<string, string>) => {
  const result = parse(query);
  if (!result.success) throw new Error(`expected a valid query: ${JSON.stringify(query)}`);
  return result.data;
};

describe('the query of the list of work orders (EVM-017 AC2, AC3; SR-INPUT-01, SR-INPUT-03)', () => {
  it('EVM-017 AC2 an empty query takes the defaults: no view, no statuses, `-number`, 25 per page, no cursor', () => {
    expect(ok({})).toEqual({
      statuses: [],
      view: undefined,
      coordinatorId: undefined,
      customerId: undefined,
      sort: '-number',
      limit: DEFAULT_LIMIT,
      cursor: undefined,
    });
  });

  it('EVM-017 AC2 the statuses are a normalised set: sorted, with no duplicates', () => {
    expect(ok({ status: 'quoting,new,quoting' }).statuses).toEqual(['new', 'quoting']);
    expect(ok({ status: 'settled' }).statuses).toEqual(['settled']);
    expect(ok({ status: WORK_ORDER_STATUSES.join(',') }).statuses).toEqual([...WORK_ORDER_STATUSES].sort());
  });

  it('EVM-017 AC2 an empty element, an unknown status, another case, a long list and a character outside a-z and _ are refused', () => {
    for (const status of [
      '',
      ',',
      'new,',
      ',new',
      'new,,quoting',
      'archived',
      'NEW',
      'new quoting',
      'new;quoting',
      'new-quoting',
      'in progress',
      `${'new,'.repeat(25)}new`,
    ])
      expect(parse({ status }).success, status).toBe(false);
  });

  it('EVM-017 AC2 the limit is an integer of 1..100: "25abc", "1e2", "-1", "0", "101", "2.5", a space and an empty string are refused', () => {
    for (const limit of ['25abc', '1e2', '-1', '0', '101', '2.5', ' 25', '', '1000', '+5'])
      expect(parse({ limit }).success, limit).toBe(false);
    expect(ok({ limit: '1' }).limit).toBe(1);
    expect(ok({ limit: '100' }).limit).toBe(100);
  });

  it('EVM-017 AC2 sort and view are closed lists; coordinatorId is a UUID', () => {
    for (const sort of ['-number', 'number', '-createdAt', 'createdAt']) expect(ok({ sort }).sort).toBe(sort);
    for (const sort of ['number_desc', 'created_asc', '+number', 'title', '', 'Number']) expect(parse({ sort }).success, sort).toBe(false);
    expect(ok({ view: 'mine' }).view).toBe('mine');
    expect(ok({ view: 'all_open' }).view).toBe('all_open');
    for (const view of ['', 'all', 'deleted', 'MINE']) expect(parse({ view }).success, view).toBe(false);
    const id = randomUUID();
    expect(ok({ coordinatorId: id }).coordinatorId).toBe(id);
    for (const coordinatorId of ['', 'abc', `${id}x`]) expect(parse({ coordinatorId }).success, coordinatorId).toBe(false);
  });

  it('EVM-039 AC2 customerId (the history of a customer) is a UUID like coordinatorId', () => {
    const id = randomUUID();
    expect(ok({ customerId: id }).customerId).toBe(id);
    for (const customerId of ['', 'abc', `${id}x`]) expect(parse({ customerId }).success, customerId).toBe(false);
  });

  it('EVM-017 AC3 the cursor is base64url within 512 characters; the query refuses another character or a longer one before anything decrypts it', () => {
    expect(ok({ cursor: 'A_-0'.repeat(128) }).cursor).toHaveLength(512);
    for (const cursor of ['', 'a+b', 'a/b', 'a=', 'a b', 'A'.repeat(513), 'zażółć']) expect(parse({ cursor }).success, cursor).toBe(false);
  });

  it('EVM-017 AC2 an unknown key is refused (the guard answers unknown_parameter first; the schema is the second line)', () => {
    expect(parse({ userId: randomUUID() }).success).toBe(false);
    expect(parse({ __proto__: 'x', constructor: 'y' }).success).toBe(false);
  });

  it('EVM-017 AC2 the closed orders are exactly settled and cancelled, and the lists of the code are the lists of the contract', () => {
    expect([...CLOSED_STATUSES]).toEqual(['settled', 'cancelled']);
    expect([...WORK_ORDER_STATUSES]).toEqual([...zWorkOrderStatus.options]);
    expect(Object.keys(SORT_RULES).sort()).toEqual([...zWorkOrderSort.options].sort());
    expect([...zWorkOrderView.options]).toEqual(['all_open', 'mine']);
    for (const status of CLOSED_STATUSES) expect(WORK_ORDER_STATUSES).toContain(status);
  });

  it('EVM-017 AC2 the declared query parameters of the contract are the keys of the schema (an undeclared one is 400 unknown_parameter)', () => {
    expect([...(AUTHZ_MANIFEST['listWorkOrders']?.query ?? [])].sort()).toEqual(Object.keys(workOrderListQuerySchema.shape).sort());
  });

  it('EVM-017 AC3 the filters of a cursor are the sort, the view, the normalised statuses and the coordinator — not the limit', () => {
    const id = randomUUID();
    const base = ok({ status: 'quoting,new', view: 'all_open', coordinatorId: id, sort: 'number', limit: '10' });
    expect(filterPartsOf(base)).toEqual(['number', 'all_open', 'new,quoting', id, '']);
    expect(filterPartsOf(ok({ status: 'new,quoting,new', view: 'all_open', coordinatorId: id, sort: 'number', limit: '99' }))).toEqual(
      filterPartsOf(base),
    );
    expect(filterPartsOf(ok({}))).toEqual(['-number', '', '', '', '']);
    expect(filterPartsOf(ok({ customerId: id }))).toEqual(['-number', '', '', '', id]);
  });
});

describe('the position of a cursor (EVM-017 AC3)', () => {
  const item = { id: randomUUID(), number: 'ZL-2026-0042', createdAt: new Date('2026-10-01T08:30:00.123Z') };

  it('EVM-017 AC3 by number the position is the number; by creation time the time with milliseconds and the id', () => {
    expect(positionParts('-number', item)).toEqual(['ZL-2026-0042']);
    expect(positionParts('number', item)).toEqual(['ZL-2026-0042']);
    expect(positionParts('createdAt', item)).toEqual(['2026-10-01T08:30:00.123Z', item.id]);
    expect(positionParts('-createdAt', item)).toEqual(['2026-10-01T08:30:00.123Z', item.id]);
  });

  it('EVM-017 AC3 a position is validated again after decryption: the type, the format and the sort it belongs to', () => {
    expect(parsePosition('-number', ['ZL-2026-0042'])).toEqual({ number: 'ZL-2026-0042' });
    expect(parsePosition('createdAt', ['2026-10-01T08:30:00.123Z', item.id])).toEqual({
      createdAt: new Date('2026-10-01T08:30:00.123Z'),
      id: item.id,
    });
    for (const parts of [[], ['a', 'b'], ["ZL-2026-0042'; drop table x;--"], ['x'.repeat(33)], ['ZL 2026'], ['']])
      expect(parsePosition('number', parts), JSON.stringify(parts)).toBeUndefined();
    for (const parts of [
      ['ZL-2026-0042'],
      ['yesterday', item.id],
      ['2026-10-01T08:30:00.123Z', 'not-an-id'],
      ['2026-10-01T08:30:00.123Z'],
      ['2026-10-01T08:30:00.123Z', item.id, 'x'],
    ])
      expect(parsePosition('-createdAt', parts), JSON.stringify(parts)).toBeUndefined();
  });
});

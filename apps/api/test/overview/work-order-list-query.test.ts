import { randomUUID } from 'node:crypto';
import { AUTHZ_MANIFEST } from '@evia/contracts/authz';
import { zWorkOrderSort, zWorkOrderStatus, zWorkOrderView } from '@evia/contracts/zod';
import { describe, expect, it } from 'vitest';
import {
  CLOSED_STATUSES,
  DEFAULT_LIMIT,
  SORT_RULES,
  WORK_ORDER_STATUSES,
  daysBetween,
  filterPartsOf,
  parsePosition,
  positionParts,
  resolveWorkOrderListQuery,
  workOrderListQuerySchema,
} from '../../src/modules/overview/domain/work-order-list-query.ts';

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
      waitingOn: undefined,
      waitingOnPartyKind: undefined,
      waitingLongerThanDays: undefined,
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
    // EVM-056 adds `urgency` ("Najpilniejsze", ascending only) to the closed list
    for (const sort of ['-number', 'number', '-createdAt', 'createdAt', 'longestWaitingSince', 'nextDueDate', 'urgency'])
      expect(ok({ sort }).sort).toBe(sort);
    for (const sort of [
      'number_desc',
      'created_asc',
      '+number',
      'title',
      '',
      'Number',
      '-longestWaitingSince',
      '-nextDueDate',
      '-urgency',
      'Urgency',
    ])
      expect(parse({ sort }).success, sort).toBe(false);
    expect(ok({ view: 'mine' }).view).toBe('mine');
    expect(ok({ view: 'all_open' }).view).toBe('all_open');
    expect(ok({ view: 'waiting_on_dso_over_14_days' }).view).toBe('waiting_on_dso_over_14_days');
    // EVM-056 adds the payment views; `deleted` is EVM-060
    expect(ok({ view: 'overdue_payments' }).view).toBe('overdue_payments');
    expect(ok({ view: 'unpaid' }).view).toBe('unpaid');
    for (const view of ['', 'all', 'deleted', 'MINE', 'overdue', 'Unpaid']) expect(parse({ view }).success, view).toBe(false);
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
    expect([...zWorkOrderView.options]).toEqual(['all_open', 'mine', 'waiting_on_dso_over_14_days', 'overdue_payments', 'unpaid']);
    for (const status of CLOSED_STATUSES) expect(WORK_ORDER_STATUSES).toContain(status);
  });

  it('EVM-017 AC2 the declared query parameters of the contract are the keys of the schema (an undeclared one is 400 unknown_parameter)', () => {
    expect([...(AUTHZ_MANIFEST['listWorkOrders']?.query ?? [])].sort()).toEqual(Object.keys(workOrderListQuerySchema.shape).sort());
  });

  it('EVM-017 AC3 the filters of a cursor are the sort, the view, the normalised statuses and the coordinator — not the limit', () => {
    const id = randomUUID();
    const base = ok({ status: 'quoting,new', view: 'all_open', coordinatorId: id, sort: 'number', limit: '10' });
    expect(filterPartsOf(base)).toEqual(['number', 'all_open', 'new,quoting', id, '', '', '', '', '', '']);
    expect(filterPartsOf(ok({ status: 'new,quoting,new', view: 'all_open', coordinatorId: id, sort: 'number', limit: '99' }))).toEqual(
      filterPartsOf(base),
    );
    expect(filterPartsOf(ok({}))).toEqual(['-number', '', '', '', '', '', '', '', '', '']);
    expect(filterPartsOf(ok({ customerId: id }))).toEqual(['-number', '', '', '', id, '', '', '', '', '']);
  });
});

describe('the position of a cursor (EVM-017 AC3)', () => {
  const item = {
    id: randomUUID(),
    number: 'ZL-2026-0042',
    createdAt: new Date('2026-10-01T08:30:00.123Z'),
    longestWaitingSince: null,
    nextDueDate: '2026-10-20',
  };

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

describe('"Czekamy na…" in the query (EVM-034 AC2, AC4; SR-INPUT-01, SR-INPUT-03, SR-API-04)', () => {
  it('EVM-034 AC2 waitingLongerThanDays is an integer of 1..365: 0, 366, "14a", "-1", "1.5", a space and an empty string are refused', () => {
    for (const waitingLongerThanDays of ['0', '366', '14a', '-1', '1.5', ' 14', '', '1e2', '0014x', '1000'])
      expect(parse({ waitingLongerThanDays }).success, waitingLongerThanDays).toBe(false);
    expect(ok({ waitingLongerThanDays: '1' }).waitingLongerThanDays).toBe(1);
    expect(ok({ waitingLongerThanDays: '14' }).waitingLongerThanDays).toBe(14);
    expect(ok({ waitingLongerThanDays: '365' }).waitingLongerThanDays).toBe(365);
  });

  it('EVM-034 AC2 waitingOn is customer or party; waitingOnPartyKind is a code of the dictionary of kinds, never an identifier or a name', () => {
    expect(ok({ waitingOn: 'customer' }).waitingOn).toBe('customer');
    expect(ok({ waitingOn: 'party', waitingOnPartyKind: 'distribution_system_operator' })).toMatchObject({
      waitingOn: 'party',
      waitingOnPartyKind: 'distribution_system_operator',
    });
    for (const waitingOn of ['', 'OSD', 'client', 'Customer']) expect(parse({ waitingOn }).success, waitingOn).toBe(false);
    for (const waitingOnPartyKind of ['', 'osd', randomUUID(), 'Stoen Operator', 'distribution_system_operator,other'])
      expect(parse({ waitingOnPartyKind }).success, waitingOnPartyKind).toBe(false);
  });

  it('EVM-034 AC2 a kind alone means a party; a kind together with waitingOn=customer contradicts itself and is refused on /waitingOnPartyKind', () => {
    expect(ok({ waitingOnPartyKind: 'supplier' })).toMatchObject({ waitingOn: 'party', waitingOnPartyKind: 'supplier' });
    const refused = parse({ waitingOn: 'customer', waitingOnPartyKind: 'supplier' });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues.map((issue) => issue.path.join('/'))).toEqual(['waitingOnPartyKind']);
    expect(JSON.stringify(refused.error?.issues)).not.toContain('supplier');
  });

  it('EVM-034 AC4 the two new sorts are ascending only, by a date with the order without it last, and the position is [day or infinity, id]', () => {
    expect(SORT_RULES.longestWaitingSince).toEqual({ key: 'longestWaitingSince', direction: 'asc' });
    expect(SORT_RULES.nextDueDate).toEqual({ key: 'nextDueDate', direction: 'asc' });
    const id = randomUUID();
    const item = { id, number: 'ZL-2026-0001', createdAt: new Date('2026-10-01T08:30:00.000Z') };
    expect(positionParts('longestWaitingSince', { ...item, longestWaitingSince: '2026-09-18', nextDueDate: null })).toEqual([
      '2026-09-18',
      id,
    ]);
    expect(positionParts('longestWaitingSince', { ...item, longestWaitingSince: null, nextDueDate: null })).toEqual(['infinity', id]);
    expect(positionParts('nextDueDate', { ...item, longestWaitingSince: null, nextDueDate: '2026-10-05' })).toEqual(['2026-10-05', id]);
    expect(parsePosition('nextDueDate', ['infinity', id])).toEqual({ day: 'infinity', id });
    expect(parsePosition('longestWaitingSince', ['2026-09-18', id])).toEqual({ day: '2026-09-18', id });
    for (const parts of [[], ['2026-09-18'], ['yesterday', id], ['2026-13-45', id], ['2026-09-18', 'not-an-id'], ['2026-09-18', id, 'x']])
      expect(parsePosition('nextDueDate', parts), JSON.stringify(parts)).toBeUndefined();
  });

  it('EVM-034 AC2 the filters of a cursor include the kind of wait and the number of days, so a cursor does not open with other ones', () => {
    const base = ok({ waitingOn: 'party', waitingOnPartyKind: 'distribution_system_operator', waitingLongerThanDays: '14' });
    expect(filterPartsOf(base)).toEqual(['-number', '', '', '', '', '', '', 'party', 'distribution_system_operator', '14']);
    expect(filterPartsOf(ok({ waitingLongerThanDays: '15' }))).not.toEqual(filterPartsOf(ok({ waitingLongerThanDays: '14' })));
    expect(filterPartsOf(ok({ view: 'waiting_on_dso_over_14_days' }))).not.toEqual(filterPartsOf(ok({ view: 'all_open' })));
  });

  it('EVM-034 AC2 the days between two dates is a difference of dates: a change of the clock on 2026-10-25 does not move it; never negative', () => {
    expect(daysBetween('2026-09-18', '2026-10-03')).toBe(15);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetween('2026-10-03', '2026-10-03')).toBe(0);
    expect(daysBetween('2026-10-04', '2026-10-03')).toBe(0);
  });

  it('EVM-072 AC4 the type of the site and the template are filters of the list (codes and a UUID), part of what a cursor is bound to', () => {
    const template = randomUUID();
    const base = ok({ siteType: 'multi_family_garage', templateId: template });
    expect(base).toMatchObject({ siteType: 'multi_family_garage', templateId: template });
    expect(filterPartsOf(base)).toEqual(['-number', '', '', '', '', 'multi_family_garage', template, '', '', '']);
    expect(filterPartsOf(ok({ siteType: 'commercial' }))).not.toEqual(filterPartsOf(ok({ siteType: 'other' })));
    for (const query of [{ siteType: 'castle' }, { siteType: '' }, { templateId: 'abc' }, { templateId: template + 'x' }])
      expect(resolveWorkOrderListQuery.safeParse(query).success, JSON.stringify(query)).toBe(false);
  });
});

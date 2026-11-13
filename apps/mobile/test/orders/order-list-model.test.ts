import type { QueueRecord } from '@evia/sync-core';
import {
  buildOrderList,
  filterOrders,
  queueFact,
  redactRows,
  unsentCount,
  type OrderListSource,
  type OrderRow,
  type QueueFact,
} from '../../src/orders/order-list-model';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 1);
const ids = (rows: readonly OrderRow[]): string[] => rows.map((r) => r.id);

const SOURCE: OrderListSource = {
  orders: [
    { id: 'o-old', number: 'ZL-2026-0042', status: 'in_progress', createdAt: T0 - 5 * DAY, customerId: 'c1', siteId: 's1' },
    { id: 'o-new', number: 'ZL-2026-0107', status: 'new', createdAt: T0 - DAY, customerId: 'c2', siteId: 's2' },
    { id: 'o-mid', number: 'ZL-2026-0099', status: 'accepted', createdAt: T0 - 3 * DAY, customerId: null, siteId: null },
    { id: 'o-same-a', number: 'ZL-2026-0001', status: 'new', createdAt: T0 - 9 * DAY, customerId: 'c1', siteId: 's2' },
    { id: 'o-same-b', number: 'ZL-2026-0002', status: 'new', createdAt: T0 - 9 * DAY, customerId: 'missing', siteId: 'missing' },
  ],
  customers: [
    { id: 'c1', displayName: 'Jan Łódzki Synthetic' },
    { id: 'c2', displayName: 'Firma Testowa Sp. z o.o.' },
  ],
  sites: [
    { id: 's1', street: 'ul. Żółkiewskiego', buildingNumber: '7', city: 'Łódź', parkingSpot: '15' },
    { id: 's2', street: 'ul. Fikcyjna', buildingNumber: '12', city: 'Piaseczno', parkingSpot: '' },
  ],
  stages: [
    { workOrderId: 'o-old', name: 'Montaż', position: 3, status: 'todo' },
    { workOrderId: 'o-old', name: 'Wizja lokalna', position: 1, status: 'done' },
    { workOrderId: 'o-old', name: 'Zgłoszenie do OSD', position: 2, status: 'waiting' },
    { workOrderId: 'o-new', name: 'Pominięty', position: 1, status: 'not_applicable' },
  ],
};

const quickRecord = (patch: Partial<QueueRecord> & { payload?: Record<string, unknown> } = {}): QueueRecord => ({
  mutationId: 'm-quick',
  type: 'CreateQuickWorkOrder',
  commandVersion: 1,
  payload: {
    workOrderId: 'o-quick',
    title: 'SYNTHETIC-TITLE',
    newCustomer: { displayName: 'Zofia Świętosławska', phone: '+48000000000' },
    newSite: { street: 'ul. Nowa', buildingNumber: '3', city: 'Gdynia', parkingSpotNumber: 'B-12' },
  },
  objectId: 'o-quick',
  orderingKey: 'o-quick',
  createdAt: T0,
  ownerUserId: 'u1',
  state: 'pending',
  attempts: 0,
  ...patch,
});
const noteRecord = (orderingKey: string): QueueRecord => ({
  mutationId: `m-note-${orderingKey}`,
  type: 'CreateNote',
  commandVersion: 1,
  payload: { id: 'n1', workOrderId: orderingKey, body: 'SYNTHETIC-NOTE-BODY' },
  objectId: 'n1',
  orderingKey,
  createdAt: T0,
  ownerUserId: 'u1',
  state: 'pending',
  attempts: 0,
});

const FACTS: QueueFact[] = [queueFact(quickRecord(), true), queueFact(noteRecord('o-old'), true)];

describe('buildOrderList (EVM-103 AC1)', () => {
  it('EVM-103 AC1: rows carry number, customer, address, status and the first unfinished stage; newest first, ties by id', () => {
    const rows = buildOrderList(SOURCE, []);
    expect(ids(rows)).toEqual(['o-new', 'o-mid', 'o-old', 'o-same-a', 'o-same-b']);
    const old = rows.find((r) => r.id === 'o-old');
    expect(old).toMatchObject({
      number: 'ZL-2026-0042',
      customer: 'Jan Łódzki Synthetic',
      street: 'ul. Żółkiewskiego 7',
      city: 'Łódź',
      spot: '15',
      status: 'in_progress',
      stage: 'Zgłoszenie do OSD',
      awaitingNumber: false,
      unsent: false,
    });
    // a stage that is not applicable never shows; a missing customer or site leaves empty fields
    expect(rows.find((r) => r.id === 'o-new')?.stage).toBe('');
    expect(rows.find((r) => r.id === 'o-mid')).toMatchObject({ customer: '', street: '', city: '', spot: '' });
    expect(rows.find((r) => r.id === 'o-same-b')).toMatchObject({ customer: '', street: '' });
  });

  it('EVM-103 AC1: the same order of ids in either direction of the tie (stable by id)', () => {
    const swapped = { ...SOURCE, orders: [...SOURCE.orders].reverse() };
    expect(ids(buildOrderList(swapped, []))).toEqual(ids(buildOrderList(SOURCE, [])));
  });

  it('EVM-103 AC3: a quick work order that only the queue knows is a row "Oczekuje na numer" with its address and customer', () => {
    const rows = buildOrderList(SOURCE, FACTS);
    const quick = rows.find((r) => r.id === 'o-quick');
    expect(quick).toMatchObject({
      number: null,
      awaitingNumber: true,
      unsent: true,
      status: 'new',
      customer: 'Zofia Świętosławska',
      street: 'ul. Nowa 3',
      city: 'Gdynia',
      spot: 'B-12',
    });
    expect(rows.find((r) => r.id === 'o-old')?.unsent).toBe(true);
    expect(unsentCount(rows)).toBe(2);
  });

  it('EVM-103 AC3: a quick work order pointing at an existing customer and site takes them from the replica; a replica order wins over a fact', () => {
    const pointing = queueFact(
      quickRecord({ payload: { workOrderId: 'o-quick', title: 't', customerId: 'c2', siteId: 's1' }, mutationId: 'm-p' }),
      true,
    );
    const quick = buildOrderList(SOURCE, [pointing]).find((r) => r.id === 'o-quick');
    expect(quick).toMatchObject({ customer: 'Firma Testowa Sp. z o.o.', street: 'ul. Żółkiewskiego 7', city: 'Łódź' });
    const same = queueFact(quickRecord({ payload: { workOrderId: 'o-new' }, orderingKey: 'o-new', mutationId: 'm-s' }), true);
    const rows = buildOrderList(SOURCE, [same, same]);
    expect(rows.filter((r) => r.id === 'o-new')).toHaveLength(1);
    expect(rows.find((r) => r.id === 'o-new')).toMatchObject({ number: 'ZL-2026-0107', awaitingNumber: false, unsent: true });
    expect(rows).toHaveLength(SOURCE.orders.length);
    // a payload without customer or site, and a non-record payload value, leave the fields empty
    const bare = queueFact(quickRecord({ payload: { workOrderId: 'o-quick', newCustomer: 'x', newSite: [] } }), true);
    expect(buildOrderList(SOURCE, [bare]).find((r) => r.id === 'o-quick')).toMatchObject({ customer: '', street: '' });
    // a note for an order that is no longer in scope adds no row
    expect(buildOrderList(SOURCE, [queueFact(noteRecord('gone'), true)])).toHaveLength(SOURCE.orders.length);
  });

  it('EVM-103 AC6: the keys are normalised copies in memory only; the number, the address and the customer are separate', () => {
    const old = buildOrderList(SOURCE, []).find((r) => r.id === 'o-old');
    expect(old?.keys.number).toBe('zl-2026-0042');
    expect(old?.keys.address).toBe('ul. zolkiewskiego 7 lodz 15');
    expect(old?.keys.customer).toBe('jan lodzki synthetic');
  });
});

describe('queueFact (EVM-103 AC5, security K2)', () => {
  it('EVM-103 AC5: without data only the id, the type, the key, the state and the time are mapped - no title, customer or address', () => {
    const fact = queueFact(quickRecord({ state: 'needs_attention' }), false);
    expect(Object.keys(fact).sort()).toEqual(['createdAt', 'mutationId', 'orderingKey', 'state', 'type']);
    expect(JSON.stringify(fact)).not.toMatch(/SYNTHETIC|Zofia|Nowa|Gdynia|B-12/);
    expect(queueFact(noteRecord('o-old'), true)).not.toHaveProperty('customerName');
    expect(Object.keys(queueFact(noteRecord('o-old'), true)).sort()).toEqual(['createdAt', 'mutationId', 'orderingKey', 'state', 'type']);
  });

  it('EVM-103 AC1: with data the typed customer and place are mapped and the title never is', () => {
    const fact = queueFact(quickRecord(), true);
    expect(fact.customerName).toBe('Zofia Świętosławska');
    expect(fact.site).toEqual({ street: 'ul. Nowa', buildingNumber: '3', city: 'Gdynia', parkingSpot: 'B-12' });
    expect(JSON.stringify(fact)).not.toContain('SYNTHETIC-TITLE');
    expect(JSON.stringify(buildOrderList(SOURCE, [fact]))).not.toContain('SYNTHETIC-TITLE');
  });

  it('EVM-103 AC5: a hidden-mode read still lists a waiting work order, as an anonymous row', () => {
    const rows = buildOrderList({ ...SOURCE, customers: [], sites: [], stages: [] }, [
      queueFact(quickRecord(), false),
      queueFact(noteRecord('o-old'), false),
    ]);
    expect(rows.find((r) => r.id === 'o-quick')).toMatchObject({ awaitingNumber: true, customer: '', street: '', city: '', spot: '' });
    expect(unsentCount(rows)).toBe(2);
  });
});

describe('filterOrders (EVM-103 AC2, AC3)', () => {
  const rows = buildOrderList(SOURCE, FACTS);

  it('EVM-103 AC2: no query is the whole list, "Oczekuje na numer" on top, then newest first', () => {
    expect(ids(filterOrders(rows, '', 'all'))).toEqual(['o-quick', 'o-new', 'o-mid', 'o-old', 'o-same-a', 'o-same-b']);
    expect(ids(filterOrders(rows, '   ', 'all'))).toEqual(ids(filterOrders(rows, '', 'all')));
  });

  it('EVM-103 AC2: from one character, by a fragment of the number, without case or Polish diacritics ("lodz" finds "Łódź")', () => {
    expect(ids(filterOrders(rows, '4', 'all'))).toContain('o-old');
    expect(ids(filterOrders(rows, '0042', 'all'))).toEqual(['o-old']);
    expect(ids(filterOrders(rows, 'zl-2026-01', 'all'))).toEqual(['o-new']);
    expect(ids(filterOrders(rows, 'LODZ', 'all'))).toEqual(['o-old', 'o-same-a']);
    expect(ids(filterOrders(rows, 'zolkiewskiego', 'all'))).toEqual(['o-old']);
    expect(ids(filterOrders(rows, 'Łódź', 'all'))).toEqual(['o-old', 'o-same-a']);
    expect(ids(filterOrders(rows, 'swietoslawska', 'all'))).toEqual(['o-quick']);
  });

  it('EVM-103 AC2: the place number and the street are found; an unknown phrase gives nothing', () => {
    expect(ids(filterOrders(rows, 'B-12', 'all'))).toEqual(['o-quick']);
    expect(ids(filterOrders(rows, '15', 'all'))).toContain('o-old');
    expect(filterOrders(rows, 'nie-ma-takiego', 'all')).toEqual([]);
  });

  it('EVM-103 AC2: relevance is number, then address, then customer; then the base order; waiting orders stay on top', () => {
    const set: OrderListSource = {
      orders: [
        { id: 'by-customer', number: 'ZL-1', status: 'new', createdAt: T0, customerId: 'c', siteId: null },
        { id: 'by-address', number: 'ZL-2', status: 'new', createdAt: T0 - DAY, customerId: null, siteId: 's' },
        { id: 'by-number', number: 'ZL-ABC-3', status: 'new', createdAt: T0 - 2 * DAY, customerId: null, siteId: null },
        { id: 'by-number-newer', number: 'ZL-ABC-4', status: 'new', createdAt: T0 - DAY / 2, customerId: null, siteId: null },
      ],
      customers: [{ id: 'c', displayName: 'Abc Klient' }],
      sites: [{ id: 's', street: 'Abc', buildingNumber: '1', city: 'X', parkingSpot: '' }],
      stages: [],
    };
    const waiting = queueFact(quickRecord({ payload: { workOrderId: 'w', newCustomer: { displayName: 'Abc' } }, orderingKey: 'w' }), true);
    const list = buildOrderList(set, [waiting]);
    expect(ids(filterOrders(list, 'abc', 'all'))).toEqual(['w', 'by-number-newer', 'by-number', 'by-address', 'by-customer']);
  });

  it('EVM-103 AC3: "Niewysłane" shows the orders with elements in the queue; the count is independent of the query; chip and query work together', () => {
    expect(ids(filterOrders(rows, '', 'unsent'))).toEqual(['o-quick', 'o-old']);
    expect(unsentCount(rows)).toBe(2);
    expect(ids(filterOrders(rows, 'lodz', 'unsent'))).toEqual(['o-old']);
    expect(filterOrders(rows, 'piaseczno', 'unsent')).toEqual([]);
    expect(unsentCount(filterOrders(rows, 'piaseczno', 'all'))).toBe(0);
    expect(unsentCount(rows)).toBe(2);
    expect(filterOrders(buildOrderList(SOURCE, []), '', 'unsent')).toEqual([]);
  });

  it('EVM-103 AC2: special characters are literal - no error, no wildcard, no pattern (security K3)', () => {
    const special = `" % _ * ( ) ' \\ [ ] ^ $ . | ?`;
    expect(() => filterOrders(rows, special, 'all')).not.toThrow();
    expect(filterOrders(rows, special, 'all')).toEqual([]);
    for (const char of ['%', '_', '*', '(', ')', "'", '"', '\\', '[', ']', '^', '$', '|', '?', '😀', '.*', '[a-z]+', '(a+)+$']) {
      expect(filterOrders(rows, char, 'all')).toEqual([]);
    }
    const dotted: OrderListSource = {
      ...SOURCE,
      orders: [{ id: 'p', number: 'A%B_C', status: 'new', createdAt: T0, customerId: null, siteId: null }],
    };
    const list = buildOrderList(dotted, []);
    expect(ids(filterOrders(list, '%', 'all'))).toEqual(['p']);
    expect(ids(filterOrders(list, 'a%b_c', 'all'))).toEqual(['p']);
    expect(filterOrders(list, 'a_b', 'all')).toEqual([]);
    expect(filterOrders(list, '%_', 'all')).toEqual([]);
    expect(filterOrders(list, 'a.b', 'all')).toEqual([]);
  });

  it('EVM-103 AC2: a 10 kB query and an emoji query finish at once and match nothing', () => {
    const started = performance.now();
    expect(filterOrders(rows, 'a'.repeat(10_000), 'all')).toEqual([]);
    expect(filterOrders(rows, '😀'.repeat(5_000), 'all')).toEqual([]);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('redactRows (EVM-103 AC5)', () => {
  it('EVM-103 AC5: the hidden-data model has no name, address, place, stage or key; ids, numbers, statuses and the unsent flag stay', () => {
    const redacted = redactRows(buildOrderList(SOURCE, FACTS));
    expect(redacted).toHaveLength(6);
    for (const r of redacted) {
      expect(Object.keys(r).sort()).toEqual(
        ['awaitingNumber', 'city', 'createdAt', 'customer', 'id', 'keys', 'number', 'spot', 'stage', 'status', 'street', 'unsent'].sort(),
      );
      expect([r.customer, r.street, r.city, r.spot, r.stage, r.keys.number, r.keys.address, r.keys.customer]).toEqual([
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ]);
    }
    expect(JSON.stringify(redacted)).not.toMatch(/Łódź|Żółkiewskiego|Jan|Zofia|Fikcyjna|Gdynia/);
    expect(redacted.find((r) => r.id === 'o-old')).toMatchObject({ number: 'ZL-2026-0042', status: 'in_progress', unsent: true });
    expect(unsentCount(redacted)).toBe(2);
    // a query on the redacted model never filters and never reveals a match
    expect(filterOrders(redacted, 'lodz', 'all')).toEqual([]);
    expect(filterOrders(redacted, 'zl-2026-0042', 'all')).toEqual([]);
  });
});

describe('budget of the filter (EVM-103 AC7)', () => {
  it('EVM-103 AC7: 300 synthetic orders are filtered in about 50 ms or less (median of repeated runs)', () => {
    const orders = Array.from({ length: 300 }, (_, n) => ({
      id: `id-${String(n)}`,
      number: `ZL-2026-${String(n).padStart(4, '0')}`,
      status: 'in_progress',
      createdAt: T0 - n * 3_600_000,
      customerId: `c-${String(n % 40)}`,
      siteId: `s-${String(n % 60)}`,
    }));
    const source: OrderListSource = {
      orders,
      customers: Array.from({ length: 40 }, (_, n) => ({ id: `c-${String(n)}`, displayName: `Klient Syntetyczny ${String(n)}` })),
      sites: Array.from({ length: 60 }, (_, n) => ({
        id: `s-${String(n)}`,
        street: `ul. Testowa ${String(n)}`,
        buildingNumber: String(n),
        city: n % 2 === 0 ? 'Łódź' : 'Warszawa',
        parkingSpot: String(n),
      })),
      stages: [],
    };
    const list = buildOrderList(source, []);
    const times: number[] = [];
    for (let run = 0; run < 15; run += 1) {
      const started = performance.now();
      for (const query of ['z', 'zl', 'zl-2026-01', 'lodz', 'klient syntetyczny 1', 'ul. testowa 5']) filterOrders(list, query, 'all');
      times.push((performance.now() - started) / 6);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length / 2)]).toBeLessThan(50);
  });
});

import type { QueueRecord } from '@evia/sync-core';
import {
  buildOrderList,
  filterOrders,
  queueFact,
  redactRows,
  surveyCount,
  unsentCount,
  type OrderListSource,
  type SourceOrder,
} from '../../src/orders/order-list-model';

// EVM-137 AC2, AC4, AC5 (security W5, W9): the list with site surveys. Synthetic data only.
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 16, 12, 0, 0);
const S1 = '3a000000-0000-4000-8000-0000000000a1';
const S2 = '3a000000-0000-4000-8000-0000000000a2';
const O1 = '3a000000-0000-4000-8000-0000000000b1';
const SITE = '2a000000-0000-4000-8000-0000000000c1';
const order = (id: string, extra: Partial<SourceOrder> = {}): SourceOrder => ({
  id,
  number: `ZL-${id.slice(-2)}`,
  status: 'quoting',
  createdAt: NOW - DAY,
  customerId: null,
  siteId: null,
  survey: null,
  ...extra,
});
const source = (orders: SourceOrder[]): OrderListSource => ({
  orders,
  customers: [],
  sites: [{ id: SITE, street: 'ul. Tajna', buildingNumber: '9', city: 'Gdziestam', parkingSpot: '' }],
  stages: [],
});
const record = (type: QueueRecord['type'], orderingKey: string, payload: Record<string, unknown>, createdAt = NOW): QueueRecord => ({
  mutationId: `0194c2a0-0000-7000-8000-${orderingKey.slice(-12)}`,
  type,
  commandVersion: 1,
  payload,
  objectId: orderingKey,
  orderingKey,
  createdAt,
  ownerUserId: 'user-a-synthetic',
  state: 'pending',
  attempts: 0,
});
const surveyCommand = (id: string, createdAt = NOW): QueueRecord =>
  record(
    'CreateSiteSurvey',
    id,
    {
      workOrderId: id,
      newSite: { id: SITE, siteType: 'other', street: 'ul. Fikcyjna', buildingNumber: '12', postalCode: '05-500', city: 'Piaseczno' },
    },
    createdAt,
  );

describe('the list shows site surveys without the address (EVM-137 AC4)', () => {
  it('EVM-137 AC4: a survey of the replica carries its term and its row has NO address, whatever the site says (W5)', () => {
    const rows = buildOrderList(
      source([
        order(S1, { siteId: SITE, survey: { expiresAt: NOW + 80 * DAY, extensionCount: 0 } }),
        order(O1, { siteId: SITE, status: 'in_progress' }),
      ]),
      [],
    );
    const survey = rows.find((r) => r.id === S1);
    expect(survey?.survey).toEqual({ expiresAt: NOW + 80 * DAY, extensionCount: 0 });
    expect([survey?.street, survey?.city, survey?.spot]).toEqual(['', '', '']);
    // an ordinary order keeps its address (no regression)
    expect(rows.find((r) => r.id === O1)).toMatchObject({ survey: null, street: 'ul. Tajna 9', city: 'Gdziestam' });
  });

  it('EVM-137 AC4: the search finds a survey by its address, but the found row still has none to print', () => {
    const rows = buildOrderList(source([order(S1, { siteId: SITE, survey: { expiresAt: NOW + DAY, extensionCount: 0 } })]), []);
    const found = filterOrders(rows, 'tajna 9', 'all');
    expect(found.map((r) => r.id)).toEqual([S1]);
    expect(found[0]?.street).toBe('');
  });

  it('EVM-137 AC4: the chip "Wizje lokalne" narrows the list to the surveys (also a cancelled one) and counts them', () => {
    const rows = buildOrderList(
      source([
        order(S1, { survey: { expiresAt: NOW + 80 * DAY, extensionCount: 0 } }),
        order(S2, { status: 'cancelled', survey: { expiresAt: NOW + 5 * DAY, extensionCount: 1 } }),
        order(O1, { status: 'in_progress' }),
      ]),
      [],
    );
    expect(surveyCount(rows)).toBe(2);
    expect(
      filterOrders(rows, '', 'survey')
        .map((r) => r.id)
        .sort(),
    ).toEqual([S1, S2]);
    expect(filterOrders(rows, '', 'all')).toHaveLength(3);
    expect(surveyCount(buildOrderList(source([order(O1)]), []))).toBe(0);
  });
});

describe('a survey that waits in the queue (EVM-137 AC2)', () => {
  it('EVM-137 AC2: it stands on the list as "Oczekuje na numer" with a 90 day term from the save, a quote, and elements waiting', () => {
    const rows = buildOrderList(source([]), [queueFact(surveyCommand(S1), true)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: S1,
      number: null,
      awaitingNumber: true,
      status: 'quoting',
      unsent: true,
      street: '',
      city: '',
      survey: { expiresAt: NOW + 90 * DAY, extensionCount: 0 },
    });
    expect(unsentCount(rows)).toBe(1);
  });

  it('EVM-137 AC2 AC4: it is found by its address while waiting, the row shows none; the survey is on top with the other waiting orders', () => {
    const rows = buildOrderList(source([order(O1)]), [queueFact(surveyCommand(S1), true)]);
    expect(rows[0]?.id).toBe(S1);
    expect(filterOrders(rows, 'fikcyjna', 'all').map((r) => r.id)).toEqual([S1]);
    expect(filterOrders(rows, '', 'survey').map((r) => r.id)).toEqual([S1]);
  });

  it('EVM-137 AC2: once the replica has the order the queue fact adds no second row (no duplicate after the number came)', () => {
    const rows = buildOrderList(source([order(S1, { survey: { expiresAt: NOW + 90 * DAY, extensionCount: 0 } })]), [
      queueFact(surveyCommand(S1), true),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.number).toBe('ZL-a1');
  });

  it('EVM-137 AC5 W5: without data (hidden mode) the fact of the survey has no address and the row is a plain row with a number or "Oczekuje na numer"', () => {
    const fact = queueFact(surveyCommand(S1), false);
    expect(JSON.stringify(fact)).not.toContain('Fikcyjna');
    expect(fact).not.toHaveProperty('site');
    const withData = queueFact(surveyCommand(S1), true);
    expect(withData.site).toEqual({ street: 'ul. Fikcyjna', buildingNumber: '12', city: 'Piaseczno', parkingSpot: '' });
  });
});

describe('the hidden-data mode (EVM-137 AC5, W9)', () => {
  it('EVM-137 AC5: redactRows leaves a survey as a plain row - number, status, the unsent flag - with no mark, term, address or key', () => {
    const rows = buildOrderList(source([order(S1, { siteId: SITE, survey: { expiresAt: NOW + 80 * DAY, extensionCount: 0 } })]), [
      queueFact(surveyCommand(S2), true),
    ]);
    const redacted = redactRows(rows);
    for (const r of redacted) {
      expect(r.survey).toBeNull();
      expect(r).toMatchObject({ street: '', city: '', spot: '', customer: '', keys: { number: '', address: '', customer: '' } });
    }
    expect(surveyCount(redacted)).toBe(0);
    expect(redacted.find((r) => r.id === S2)).toMatchObject({ awaitingNumber: true, number: null, unsent: true });
    expect(redacted.find((r) => r.id === S1)).toMatchObject({ number: 'ZL-a1', status: 'quoting' });
  });
});

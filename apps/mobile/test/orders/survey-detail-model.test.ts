import type { QueueRecord } from '@evia/sync-core';
import { buildOrderDetail, buildPendingOrderDetail, type OrderDetailSource } from '../../src/orders/order-detail-model';
import { EMPTY_QUICK_SOURCE } from '../../src/orders/quick-order-model';

// EVM-137 AC2, AC4, AC7: the details of a site survey - from the queue (no number yet) and from the replica. Synthetic data only.
const WO = '0194c2a0-0000-7000-8000-0000000000d1';
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 16, 12, 0, 0);

const record = (patch: Partial<QueueRecord> & { type: QueueRecord['type']; payload: Record<string, unknown> }): QueueRecord => ({
  mutationId: `m-${patch.type}-${String(patch.createdAt ?? 0)}`,
  commandVersion: 1,
  objectId: WO,
  orderingKey: WO,
  createdAt: T0,
  ownerUserId: 'u1',
  state: 'pending',
  attempts: 0,
  ...patch,
});
const survey = (extra: Record<string, unknown> = {}): QueueRecord =>
  record({
    type: 'CreateSiteSurvey',
    payload: {
      workOrderId: WO,
      newSite: {
        id: 's1',
        siteType: 'other',
        street: 'ul. Fikcyjna',
        buildingNumber: '12',
        apartmentNumber: '4',
        postalCode: '05-500',
        city: 'Piaseczno',
      },
      ...extra,
    },
  });
const note = (id: string): QueueRecord =>
  record({ type: 'CreateNote', objectId: id, payload: { noteCategory: 'meeting', body: `wpis ${id}` }, createdAt: T0 + 1 });

describe('the details of a survey that waits in the queue (EVM-137 AC2)', () => {
  it('EVM-137 AC2: "Oczekuje na numer", the default title, a quote, no client and no template, the term 90 days from the save', () => {
    const detail = buildPendingOrderDetail(WO, [survey()], EMPTY_QUICK_SOURCE, null);
    expect(detail).toMatchObject({
      id: WO,
      number: null,
      awaitingNumber: true,
      title: 'Wizja lokalna',
      status: 'quoting',
      pendingMutationId: 'm-CreateSiteSurvey-0',
      customer: null,
      templateName: null,
      note: null,
      scope: [],
      processes: [],
      survey: { expiresAt: T0 + 90 * DAY, extensionCount: 0, requesterPhone: null, dial: null },
    });
  });

  it('EVM-137 AC4: the address is in the details (the only place) as street and building number with the apartment, postal code and city', () => {
    const detail = buildPendingOrderDetail(WO, [survey()], EMPTY_QUICK_SOURCE, null);
    expect(detail?.location).toMatchObject({ street: 'ul. Fikcyjna 12', city: '05-500 Piaseczno' });
  });

  it('EVM-137 AC2 AC4: the phone of the requester is shown as typed with a number for the dialer (K7: only a clean number)', () => {
    const typed = buildPendingOrderDetail(WO, [survey({ requesterPhone: '+48 600 000 011' })], EMPTY_QUICK_SOURCE, null)?.survey;
    expect(typed).toMatchObject({ requesterPhone: '+48 600 000 011', dial: '+48600000011' });
    const code = buildPendingOrderDetail(WO, [survey({ requesterPhone: '*#06#12345' })], EMPTY_QUICK_SOURCE, null)?.survey;
    expect(code?.dial).toBeNull();
  });

  it('EVM-137 AC2: the entries waiting behind the survey are in the journal as "Wyślemy po utworzeniu" items', () => {
    const detail = buildPendingOrderDetail(WO, [survey(), note('n1')], EMPTY_QUICK_SOURCE, null);
    expect(detail?.journal).toHaveLength(1);
    expect(detail?.journal[0]).toMatchObject({ source: 'pending', awaitsOrder: true, body: 'wpis n1' });
  });

  it('EVM-137 AC2: a title typed by another client of the contract is kept; a damaged payload (no place) gives a survey without a location, not a crash', () => {
    expect(buildPendingOrderDetail(WO, [survey({ title: 'Garaż pod blokiem' })], EMPTY_QUICK_SOURCE, null)?.title).toBe(
      'Garaż pod blokiem',
    );
    const broken = record({ type: 'CreateSiteSurvey', payload: { workOrderId: WO } });
    expect(buildPendingOrderDetail(WO, [broken], EMPTY_QUICK_SOURCE, null)).toMatchObject({
      location: null,
      survey: { requesterPhone: null },
    });
  });

  it('EVM-137 AC2: the survey of another order and an ordinary quick order are not mistaken for it', () => {
    expect(buildPendingOrderDetail('0194c2a0-0000-7000-8000-0000000000ff', [survey()], EMPTY_QUICK_SOURCE, null)).toBeNull();
  });
});

describe('the details of a survey from the replica (EVM-137 AC4, AC7)', () => {
  const source = (order: Partial<OrderDetailSource['order']> = {}, customer: OrderDetailSource['customer'] = null): OrderDetailSource => ({
    order: {
      id: WO,
      number: 'ZL-2026-0051',
      title: 'Wizja lokalna',
      status: 'quoting',
      customerId: customer === null ? null : 'c1',
      siteId: 's1',
      survey: { expiresAt: T0 + 80 * DAY, extensionCount: 1, requesterPhone: '+48 600 000 011' },
      ...order,
    },
    customer,
    site: {
      id: 's1',
      street: 'ul. Fikcyjna',
      buildingNumber: '12',
      postalCode: '05-500',
      city: 'Piaseczno',
      parkingSpot: '',
      garageLevel: '',
      connectionPowerKw: null,
      managerPartyId: null,
      operatorPartyId: null,
    },
    parties: [],
    scopeItems: [],
    stages: [],
    entries: [],
    users: [],
  });

  it('EVM-137 AC4: an open survey has its term, extensions, the phone with a dialer number and the address; no client', () => {
    const detail = buildOrderDetail(source(), [], 'u1');
    expect(detail).toMatchObject({
      number: 'ZL-2026-0051',
      customer: null,
      survey: { expiresAt: T0 + 80 * DAY, extensionCount: 1, requesterPhone: '+48 600 000 011', dial: '+48600000011' },
      location: { street: 'ul. Fikcyjna 12', city: '05-500 Piaseczno' },
    });
  });

  it('EVM-137 AC7: after the office gave a client (survey null, customer set) the details are an ordinary order with the same number and entries', () => {
    const detail = buildOrderDetail(
      { ...source({ survey: null }, { id: 'c1', displayName: 'Jan Przykładowy', phone: '+48 600 000 001' }), entries: [] },
      [note('n1')],
      'u1',
    );
    expect(detail).toMatchObject({ number: 'ZL-2026-0051', survey: null, customer: { name: 'Jan Przykładowy' } });
    expect(detail?.journal.map((item) => item.id)).toEqual(['n1']);
  });

  it('EVM-137 AC4: an ordinary order has survey null (no field of a survey leaks into it)', () => {
    expect(buildOrderDetail(source({ survey: undefined }), [], 'u1')?.survey).toBeNull();
  });

  it('EVM-137 AC4 W5: a survey without a phone has no phone to show and no dialer number', () => {
    const detail = buildOrderDetail(source({ survey: { expiresAt: T0 + DAY, extensionCount: 0, requesterPhone: null } }), [], 'u1');
    expect(detail?.survey).toMatchObject({ requesterPhone: null, dial: null });
  });
});

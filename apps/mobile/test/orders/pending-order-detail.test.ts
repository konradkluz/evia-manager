import type { QueueRecord } from '@evia/sync-core';
import { buildPendingOrderDetail } from '../../src/orders/order-detail-model';
import type { QuickOrderSource } from '../../src/orders/quick-order-model';
import type { TemplateSet } from '../../src/orders/templates';

// EVM-106 AC2: the details of a quick work order that waits in the queue (no number, data from the command). Synthetic data only.
const WO = '0194c2a0-0000-7000-8000-0000000000c1';
const TEMPLATE = '0194c2a0-0000-7000-8000-000000000a01';
const templates: TemplateSet = {
  fetchedAt: 1,
  items: [
    { id: TEMPLATE, code: 'house', name: 'Dom - sam montaż', siteTypeHint: null, itemCount: 3, procedureCount: 1, milestoneCount: 1 },
  ],
};
const none: QuickOrderSource = { customers: [], sites: [] };

const record = (patch: Partial<QueueRecord> & { payload: Record<string, unknown>; type: QueueRecord['type'] }): QueueRecord => ({
  mutationId: `m-${String(Math.random())}`,
  commandVersion: 1,
  objectId: WO,
  orderingKey: WO,
  createdAt: 1000,
  ownerUserId: 'u1',
  state: 'pending',
  attempts: 0,
  ...patch,
});
const quick = (payload: Record<string, unknown> = {}): QueueRecord =>
  record({
    type: 'CreateQuickWorkOrder',
    payload: {
      workOrderId: WO,
      templateId: TEMPLATE,
      title: 'Dom - sam montaż',
      newCustomer: { id: 'c1', kind: 'person', displayName: 'Jan Przykładowy', phone: '+48 600 000 001' },
      newSite: {
        id: 's1',
        siteType: 'single_family_house',
        street: 'ul. Fikcyjna',
        buildingNumber: '12',
        postalCode: '05-500',
        city: 'Piaseczno',
      },
      note: 'Oględziny w piątek',
      ...payload,
    },
  });
const entry = (id: string, patch: Partial<QueueRecord> = {}): QueueRecord =>
  record({ type: 'CreateNote', objectId: id, orderingKey: WO, payload: { noteCategory: 'meeting', body: `treść ${id}` }, ...patch });

describe('details of an order waiting for its number (EVM-106 AC2)', () => {
  it('EVM-106 AC2: there is no number; title, customer, address, template name and note come from the queue', () => {
    const detail = buildPendingOrderDetail(WO, [quick()], none, templates);
    expect(detail).toMatchObject({
      id: WO,
      number: null,
      awaitingNumber: true,
      title: 'Dom - sam montaż',
      templateName: 'Dom - sam montaż',
      note: 'Oględziny w piątek',
      customer: { name: 'Jan Przykładowy', phone: '+48 600 000 001', dial: '+48600000001' },
      location: { street: 'ul. Fikcyjna 12', city: '05-500 Piaseczno', spot: null },
      scope: [],
      processes: [],
    });
  });

  it('EVM-106 AC2: an existing customer and place are taken from the replica by id; the garage spot is shown', () => {
    const source: QuickOrderSource = {
      customers: [{ id: 'c9', kind: 'company', displayName: 'Firma Przykład', phone: '+48 600 000 002' }],
      sites: [
        {
          id: 's9',
          siteType: 'multi_family_garage',
          street: 'ul. Garażowa',
          buildingNumber: '1',
          apartmentNumber: '',
          postalCode: '00-001',
          city: 'Warszawa',
          parkingSpotNumber: 'B-12',
        },
      ],
    };
    const detail = buildPendingOrderDetail(
      WO,
      [quick({ newCustomer: undefined, newSite: undefined, customerId: 'c9', siteId: 's9' })],
      source,
      null,
    );
    expect(detail?.customer?.name).toBe('Firma Przykład');
    expect(detail?.location).toMatchObject({ street: 'ul. Garażowa 1', spot: 'B-12' });
    expect(detail?.templateName).toBeNull();
  });

  it('EVM-106 AC2: entries behind the order are listed as waiting for its creation, newest first; a rejected one needs attention', () => {
    const detail = buildPendingOrderDetail(
      WO,
      [quick(), entry('n1', { createdAt: 2000 }), entry('n2', { createdAt: 3000, state: 'blocked' }), entry('other', { orderingKey: 'x' })],
      none,
      templates,
    );
    expect(detail?.journal.map((item) => [item.id, item.source, item.awaitsOrder])).toEqual([
      ['n2', 'attention', true],
      ['n1', 'pending', true],
    ]);
  });

  it('EVM-106 AC2: no such command, or a damaged payload, is "not available" - never a crash', () => {
    expect(buildPendingOrderDetail(WO, [], none, templates)).toBeNull();
    expect(buildPendingOrderDetail(WO, [entry('n1')], none, templates)).toBeNull();
    expect(buildPendingOrderDetail(WO, [quick({ title: 42 })], none, templates)).toBeNull();
    const odd = buildPendingOrderDetail(WO, [quick({ newCustomer: 'x', newSite: 7 })], none, templates);
    expect(odd?.customer).toBeNull();
    expect(odd?.location).toBeNull();
  });
});

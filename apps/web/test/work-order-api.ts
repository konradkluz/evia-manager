import type { CustomerCard, ScopeItem, SiteCard, WorkOrderDetails } from '@evia/contracts';
import { json, type Handler } from './api-fake.ts';

/** Synthetic data of the order ZL-2026-0042 of W-06 (EVM-018): the customer, the garage place and nine scope items. */
export const ORDER_ID = '01968f3e-0000-7000-8000-00000000d042';
export const COORDINATOR = { id: '11111111-1111-4111-8111-111111111111', displayName: 'Anna Testowa' };

export const HEADER: WorkOrderDetails = {
  id: ORDER_ID,
  number: 'ZL-2026-0042',
  title: 'Garaż — pełny proces',
  status: 'in_progress',
  customer: { id: '01968f3e-0000-7000-8000-00000000aaaa', displayName: 'Jan Przykładowy' },
  site: {
    id: '01968f3e-0000-7000-8000-00000000bbbb',
    siteType: 'multi_family_garage',
    street: 'ul. Testowa',
    buildingNumber: '7',
    postalCode: '00-001',
    city: 'Warszawa',
    parkingSpotNumber: '15',
    garageLevel: '-1',
  },
  coordinator: COORDINATOR,
  version: 3,
  createdAt: '2026-09-01T10:00:00.000Z',
};

export const CUSTOMER: CustomerCard = { displayName: 'Jan Przykładowy', phone: '+48600000001', email: 'jan.przykladowy@example.com' };

export const SITE: SiteCard = {
  siteType: 'multi_family_garage',
  street: 'ul. Testowa',
  buildingNumber: '7',
  postalCode: '00-001',
  city: 'Warszawa',
  parkingSpotNumber: '15',
  garageLevel: '-1',
  connectionPowerKw: 40,
  meteringPointId: 'PL-TEST-0001',
  notes: 'Wjazd od ul. Fikcyjnej, klucz u administratora.',
  distributionSystemOperator: { id: '01968f3e-0000-7000-8000-00000000c001', displayName: 'Operator Testowy' },
  manager: { id: '01968f3e-0000-7000-8000-00000000c002', displayName: 'Wspólnota Testowa' },
};

const NAMES = [
  'Dostawa ładowarki (z oferty)',
  'Instalacja zasilająca',
  'Montaż i uruchomienie',
  'Pomiary i odbiór',
  'Uzgodnienia z OSD',
  'Projekt instalacji',
  'Opinia ppoż',
  'Ekspertyza techniczna',
  'Zgody administracji / wspólnoty',
];

const PARAMETERS: ReadonlyArray<Pick<ScopeItem, 'parameterSetCode' | 'parameters'>> = [
  { parameterSetCode: 'charger_spec', parameters: { currentType: 'ac', powerKw: 11, phases: 3 } },
  { parameterSetCode: 'supply_circuit', parameters: { dedicatedCircuit: true, internalSupplyLine: true } },
];

/** One scope item of the order (position from 1); `overrides` may carry values outside the contract (an unknown set — P-12). */
export function scopeItem(position: number, overrides: Record<string, unknown> = {}): ScopeItem {
  const parameters = PARAMETERS[position - 1] ?? { parameterSetCode: null, parameters: {} };
  return {
    id: `01968f3e-0000-7000-8000-0000000e00${String(position)}`,
    position,
    code: `item_${String(position)}`,
    name: NAMES[position - 1] ?? `Pozycja ${String(position)}`,
    ...parameters,
    quantity: 1,
    ...overrides,
  };
}

export const SCOPE_ITEMS: ScopeItem[] = NAMES.map((_name, index) => scopeItem(index + 1));

export interface ReadHandlers {
  readonly header: Handler;
  readonly scope: Handler;
  readonly customer: Handler;
  readonly site: Handler;
}

/** The four reads of W-06 for one order (the routes of the fake API); `overrides` replaces any of them. */
export function workOrderRoutes(id = ORDER_ID, overrides: Partial<ReadHandlers> = {}): Record<string, Handler> {
  const base = `/api/v1/work-orders/${id}`;
  return {
    [`GET ${base}`]: overrides.header ?? (() => json(200, { ...HEADER, id }, { ETag: '"3"' })),
    [`GET ${base}/scope-items`]: overrides.scope ?? (() => json(200, { items: SCOPE_ITEMS })),
    [`GET ${base}/customer`]: overrides.customer ?? (() => json(200, CUSTOMER)),
    [`GET ${base}/site`]: overrides.site ?? (() => json(200, SITE)),
  };
}

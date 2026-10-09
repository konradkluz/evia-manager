/**
 * Demo data of the local environment (EVM-077 AC7; P9, SR-PRIV-08): all of it is plainly fictional — e-mail addresses in
 * `example.test`, telephone numbers in a range no operator assigns (`+48000…`), no PESEL, no tax numbers, invented streets in an
 * invented town. Identifiers are fixed (UUIDv7-shaped), so a second run finds its own records (`id_conflict`) and never
 * duplicates them; the records are written through the use cases of the domain, with the same rules as the panel.
 */

/** A fixed identifier: valid UUIDv7 shape (version 7, variant 8) with a recognisable prefix. */
export const demoId = (kind: number, index: number): string =>
  `01990000-0000-7000-8000-${kind.toString(16).padStart(4, '0')}${index.toString(16).padStart(8, '0')}`;

const KIND = { party: 1, customer: 2, site: 3, order: 4 } as const;

export const PARTIES = [
  {
    id: demoId(KIND.party, 1),
    kind: 'distribution_system_operator',
    legalForm: 'organization',
    displayName: 'Demo Operator Sieci (dane fikcyjne)',
  },
  {
    id: demoId(KIND.party, 2),
    kind: 'property_manager',
    legalForm: 'organization',
    displayName: 'Demo Zarządca Nieruchomości (dane fikcyjne)',
    contactPersonName: 'Anna Przykładowa',
    phone: '+48000000201',
    email: 'zarzad@example.test',
  },
  {
    id: demoId(KIND.party, 3),
    kind: 'housing_community',
    legalForm: 'organization',
    displayName: 'Demo Wspólnota Mieszkaniowa (dane fikcyjne)',
    email: 'wspolnota@example.test',
  },
] as const;

export const CUSTOMERS = [
  {
    id: demoId(KIND.customer, 1),
    kind: 'person',
    firstName: 'Jan',
    lastName: 'Demonstracyjny',
    phone: '+48000000101',
    email: 'jan.demo@example.test',
  },
  {
    id: demoId(KIND.customer, 2),
    kind: 'person',
    firstName: 'Maria',
    lastName: 'Przykładowska',
    phone: '+48000000102',
    email: 'maria.demo@example.test',
  },
  { id: demoId(KIND.customer, 3), kind: 'person', firstName: 'Piotr', lastName: 'Testowy', phone: '+48000000103' },
  {
    id: demoId(KIND.customer, 4),
    kind: 'company',
    companyName: 'Demo Instalacje sp. z o.o. (dane fikcyjne)',
    contactPersonName: 'Ewa Fikcyjna',
    phone: '+48000000104',
    email: 'biuro@example.test',
    postalAddress: { street: 'Demonstracyjna', buildingNumber: '10', postalCode: '00-010', city: 'Miasto Demo' },
  },
  {
    id: demoId(KIND.customer, 5),
    kind: 'company',
    companyName: 'Przykładowa Logistyka S.A. (dane fikcyjne)',
    phone: '+48000000105',
    email: 'flota@example.test',
  },
] as const;

export const SITES = [
  {
    id: demoId(KIND.site, 1),
    siteType: 'single_family_house',
    street: 'Przykładowa',
    buildingNumber: '1',
    postalCode: '00-001',
    city: 'Miasto Demo',
    connectionPowerKw: 11,
    distributionSystemOperatorPartyId: PARTIES[0].id,
  },
  {
    id: demoId(KIND.site, 2),
    siteType: 'multi_family_garage',
    street: 'Demonstracyjna',
    buildingNumber: '5',
    apartmentNumber: '12',
    postalCode: '00-002',
    city: 'Miasto Demo',
    parkingSpotNumber: 'P-17',
    garageLevel: '-1',
    distributionSystemOperatorPartyId: PARTIES[0].id,
    managerPartyId: PARTIES[2].id,
  },
  {
    id: demoId(KIND.site, 3),
    siteType: 'multi_family_garage',
    street: 'Testowa',
    buildingNumber: '8',
    postalCode: '00-003',
    city: 'Miasto Demo',
    parkingSpotNumber: 'P-03',
    garageLevel: '-2',
    managerPartyId: PARTIES[1].id,
  },
  {
    id: demoId(KIND.site, 4),
    siteType: 'commercial',
    street: 'Fikcyjna',
    buildingNumber: '22',
    postalCode: '00-004',
    city: 'Miasto Demo',
    connectionPowerKw: 40.5,
  },
  { id: demoId(KIND.site, 5), siteType: 'other', street: 'Wymyślona', buildingNumber: '3', postalCode: '00-005', city: 'Miasto Demo' },
] as const;

export type TargetStatus = 'new' | 'quoting' | 'accepted' | 'in_progress' | 'completed';

/** The statuses are reached by the transitions of the domain (the table in domain-model.md), never by writing a status. */
export const ORDERS: ReadonlyArray<{
  id: string;
  customer: number;
  site: number;
  template: number;
  title: string;
  status: TargetStatus;
}> = [
  { id: demoId(KIND.order, 1), customer: 0, site: 0, template: 0, title: 'Demo: wallbox w domu jednorodzinnym', status: 'new' },
  {
    id: demoId(KIND.order, 2),
    customer: 1,
    site: 1,
    template: 1,
    title: 'Demo: stanowisko w garażu wielorodzinnym',
    status: 'in_progress',
  },
  { id: demoId(KIND.order, 3), customer: 1, site: 1, template: 0, title: 'Demo: drugie stanowisko w tym samym garażu', status: 'quoting' },
  { id: demoId(KIND.order, 4), customer: 3, site: 3, template: 0, title: 'Demo: ładowarki dla firmy', status: 'completed' },
  { id: demoId(KIND.order, 5), customer: 2, site: 2, template: 1, title: 'Demo: wallbox z umową administracji', status: 'accepted' },
  { id: demoId(KIND.order, 6), customer: 4, site: 4, template: 0, title: 'Demo: punkt ładowania na obiekcie', status: 'new' },
];

/** The path through the table of transitions from a new order to each target status (no step-up, no reason needed). */
export const PATH: Record<TargetStatus, readonly TargetStatus[]> = {
  new: [],
  quoting: ['quoting'],
  accepted: ['accepted'],
  in_progress: ['accepted', 'in_progress'],
  completed: ['accepted', 'in_progress', 'completed'],
};

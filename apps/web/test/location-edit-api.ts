import type { CurrentSession, Party, Site, SiteCard, SiteOrders } from '@evia/contracts';
import { ACTIVE_SESSION, json, parseBody, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi } from './render.tsx';
import { HEADER, ORDER_ID, SITE, workOrderRoutes } from './work-order-api.ts';

/** Synthetic site, parties and other orders of EVM-036 (W-06 → W-20): one garage shared by two orders, an OSD and a housing community. */
export const SITE_ID = SITE.siteId;
export const OSD_ID = '01968f3e-0000-7000-8000-00000000c001';
export const MANAGER_ID = '01968f3e-0000-7000-8000-00000000c002';
export const OTHER_ORDER_ID = '01968f3e-0000-7000-8000-00000000d017';
export const PATH = `/work-orders/${ORDER_ID}`;
export const SITE_ROUTE = `/api/v1/sites/${SITE_ID}`;
export const OSD_ROUTE = `/api/v1/parties/${OSD_ID}`;
export const MANAGER_ROUTE = `/api/v1/parties/${MANAGER_ID}`;
export const PARTY_SEARCH = 'POST /api/v1/parties/search';
export const PARTY_CREATE = 'POST /api/v1/parties';

const STAMPS = { createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-02T10:00:00.000Z' } as const;

export const STORED_SITE: Site = {
  id: SITE_ID,
  siteType: 'multi_family_garage',
  street: 'ul. Testowa',
  buildingNumber: '7',
  postalCode: '00-001',
  city: 'Warszawa',
  parkingSpotNumber: '15',
  garageLevel: '-1',
  connectionPowerKw: 40,
  meteringPointId: 'PL-TEST-0001',
  distributionSystemOperatorPartyId: OSD_ID,
  managerPartyId: MANAGER_ID,
  notes: 'Wjazd od ul. Fikcyjnej, klucz u administratora.',
  version: 4,
  ...STAMPS,
};

export const STORED_OSD: Party = {
  id: OSD_ID,
  kind: 'distribution_system_operator',
  legalForm: 'organization',
  displayName: 'Operator Testowy',
  contactPersonName: 'Anna Kontakt',
  phone: '+48600000002',
  email: 'przylacza@osd.test',
  notes: 'Wnioski tylko przez portal OSD.',
  version: 2,
  ...STAMPS,
};

export const STORED_MANAGER: Party = {
  id: MANAGER_ID,
  kind: 'housing_community',
  legalForm: 'organization',
  displayName: 'Wspólnota Testowa',
  version: 1,
  ...STAMPS,
};

/** The settled order of another customer in the same site; the answer carries no customer, no amount, no photo. */
export const OTHER_ORDERS: SiteOrders = {
  total: 1,
  items: [
    { id: OTHER_ORDER_ID, number: 'ZL-2026-0017', title: 'Przyłącze — garaż', status: 'settled', closedAt: '2026-09-30T12:00:00.000Z' },
  ],
};

export const roleSession = (role: 'editor' | 'read_only'): CurrentSession => ({
  ...ACTIVE_SESSION,
  user: { ...ACTIVE_SESSION.user, role },
});

/** The merge-patch the way the server applies it: `null` clears a field, the version goes up by one. */
function merge<T extends { version: number }>(stored: T, patch: Record<string, unknown>): T {
  const merged: Record<string, unknown> = { ...stored, ...patch };
  const kept = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== null));
  return { ...(kept as unknown as T), version: stored.version + 1 };
}

const etag = (version: number) => ({ ETag: `"${String(version)}"` });

/**
 * A fake API for the card "Lokalizacja" and its dialogs (EVM-036): the site and the two parties live in memory, a PATCH with the
 * right `If-Match` changes them (and the card of the order follows), a wrong one is `412`, somebody else's change is `change*`.
 */
export function locationServer(
  options: {
    readonly session?: CurrentSession;
    readonly orders?: Handler;
    readonly routes?: Record<string, Handler>;
  } = {},
) {
  let site: Site = { ...STORED_SITE };
  const parties: Record<string, Party> = { [OSD_ID]: { ...STORED_OSD }, [MANAGER_ID]: { ...STORED_MANAGER } };
  const ref = (id: string | undefined) => {
    const party = id === undefined ? undefined : parties[id];
    return party === undefined ? null : { id: party.id, displayName: party.displayName };
  };
  const card = (): SiteCard => ({
    siteId: site.id,
    siteType: site.siteType,
    street: site.street,
    buildingNumber: site.buildingNumber,
    ...(site.apartmentNumber === undefined ? {} : { apartmentNumber: site.apartmentNumber }),
    postalCode: site.postalCode,
    city: site.city,
    ...(site.parkingSpotNumber === undefined ? {} : { parkingSpotNumber: site.parkingSpotNumber }),
    ...(site.garageLevel === undefined ? {} : { garageLevel: site.garageLevel }),
    ...(site.connectionPowerKw === undefined ? {} : { connectionPowerKw: site.connectionPowerKw }),
    ...(site.meteringPointId === undefined ? {} : { meteringPointId: site.meteringPointId }),
    ...(site.notes === undefined ? {} : { notes: site.notes }),
    distributionSystemOperator: ref(site.distributionSystemOperatorPartyId),
    manager: ref(site.managerPartyId),
  });
  const guard = (request: { headers: Headers }, version: number): Response | undefined =>
    request.headers.get('if-match') === `"${String(version)}"` ? undefined : problem(412, 'version_conflict');

  const partyRoutes = (id: string): Record<string, Handler> => ({
    [`GET /api/v1/parties/${id}`]: () => {
      const party = parties[id];
      return party === undefined ? problem(404, 'not_found') : json(200, party, etag(party.version));
    },
    [`PATCH /api/v1/parties/${id}`]: (request) => {
      const party = parties[id];
      if (party === undefined) return problem(404, 'not_found');
      const refused = guard(request, party.version);
      if (refused !== undefined) return refused;
      const patch = parseBody(request.body) as Record<string, unknown>;
      const phone = patch['phone'];
      const normalised =
        typeof phone === 'string' ? { ...patch, phone: phone.replaceAll(/[^+\d]/g, '').replace(/^(\d{9})$/, '+48$1') } : patch;
      parties[id] = merge(party, normalised);
      return json(200, parties[id], etag(parties[id].version));
    },
  });

  const api = activeSessionApi({
    [SESSION_ROUTE]: () => json(200, options.session ?? ACTIVE_SESSION),
    ...workOrderRoutes(ORDER_ID, {
      header: () => json(200, HEADER, etag(3)),
      site: () => json(200, card()),
      siteOrders: options.orders ?? (() => json(200, OTHER_ORDERS)),
    }),
    [`GET ${SITE_ROUTE}`]: () => json(200, site, etag(site.version)),
    [`PATCH ${SITE_ROUTE}`]: (request) => {
      const refused = guard(request, site.version);
      if (refused !== undefined) return refused;
      site = merge(site, parseBody(request.body) as Record<string, unknown>);
      return json(200, site, etag(site.version));
    },
    ...partyRoutes(OSD_ID),
    ...partyRoutes(MANAGER_ID),
    [PARTY_SEARCH]: () => json(200, { items: [], nextCursor: null }),
    ...options.routes,
  });
  return {
    api,
    /** Somebody else saves a change of the site in the meantime. */
    changeSite(update: Partial<Site>) {
      site = { ...site, ...update, version: site.version + 1 };
    },
    changeParty(id: string, update: Partial<Party>) {
      const party = parties[id];
      if (party !== undefined) parties[id] = { ...party, ...update, version: party.version + 1 };
    },
    removeSite() {
      api.set(`GET ${SITE_ROUTE}`, () => problem(404, 'not_found'));
      api.set(`PATCH ${SITE_ROUTE}`, () => problem(404, 'not_found'));
    },
    get site() {
      return site;
    },
    party(id: string) {
      return parties[id];
    },
  };
}

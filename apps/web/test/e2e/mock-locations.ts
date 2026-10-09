/**
 * The part of the synthetic API that serves the card "Lokalizacja" and its dialogs (EVM-036): the site and the party as the contract
 * sends them, the edit as a merge-patch with `If-Match` (428, 400, 412), `Idempotency-Key` (replay, mismatch for another site) and the
 * rules of the real answers that the browser can feel (a field of the server is `read_only_field`, an unknown one `unknown_field`, a
 * party of the wrong kind `wrong_party_kind`, a gone one `unknown_party`), and "Inne zlecenia w tej lokalizacji" (metadata only).
 * What a person has changed is kept apart from the base records, so the specs of EVM-018 that put markup into the notes keep working.
 * Synthetic data only. The full stack (the database, the policies, the audit) is covered by the API integration tests.
 */
export interface Answer {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export interface LocationServer {
  readonly sites: ReadonlyArray<{
    id: string;
    siteType: string;
    street: string;
    buildingNumber: string;
    apartmentNumber?: string;
    postalCode: string;
    city: string;
    parkingSpotNumber?: string;
    garageLevel?: string;
  }>;
  readonly parties: ReadonlyArray<{ id: string; kind: string; displayName: string; legalForm?: string }>;
  /** The notes every site starts with (free text — a spec puts markup in it). */
  notes: string;
  /** What was changed through the dialogs, by id: the fields (`null` = cleared) and the version. */
  readonly siteEdits: Map<string, { fields: Record<string, unknown>; version: number }>;
  readonly partyEdits: Map<string, { fields: Record<string, unknown>; version: number }>;
  /** The other orders of the site of every order (metadata only); empty by default. */
  otherOrders: Array<{ id: string; number: string; title: string; status: string; closedAt?: string }>;
  /** `Idempotency-Key` → the scope and the answer of a patch. */
  readonly patchKeys: Map<string, { readonly scope: string; readonly answer: Answer }>;
  /** Somebody else's change is simulated by a spec through these: the ids whose reads are `404`. */
  readonly goneSites: Set<string>;
  readonly goneParties: Set<string>;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Answer => ({
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const problem = (status: number, code: string, extra: object = {}, headers: Record<string, string> = {}): Answer => ({
  status,
  headers: { 'Content-Type': 'application/problem+json', ...headers },
  body: JSON.stringify({ type: '/problems/' + code, title: code, status, code, traceId: '0123456789abcdef0123456789abcdef', ...extra }),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STAMPS = { createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-02T10:00:00.000Z' } as const;
const MANAGER_KINDS = ['building_administration', 'property_manager', 'housing_community'];
const SITE_PATCHABLE = [
  'siteType',
  'street',
  'buildingNumber',
  'apartmentNumber',
  'postalCode',
  'city',
  'parkingSpotNumber',
  'garageLevel',
  'connectionPowerKw',
  'meteringPointId',
  'distributionSystemOperatorPartyId',
  'managerPartyId',
  'notes',
];
const PARTY_PATCHABLE = ['legalForm', 'displayName', 'contactPersonName', 'phone', 'email', 'notes'];
const READ_ONLY = ['id', 'version', 'createdAt', 'updatedAt', 'searchText', 'createdBy', 'updatedBy', 'deletedAt', 'deletedBy'];

const cleaned = (record: Record<string, unknown>) => Object.fromEntries(Object.entries(record).filter(([, value]) => value !== null));

/** The site as the contract sends it: the base record, the connection power and the PPE of the synthetic server, then what was changed. */
export function siteOf(server: LocationServer, id: string): Record<string, unknown> | undefined {
  const site = server.sites.find((entry) => entry.id === id);
  if (site === undefined || server.goneSites.has(id)) return undefined;
  const osd = server.parties.find((entry) => entry.kind === 'distribution_system_operator');
  const manager = server.parties.find((entry) => entry.kind === 'housing_community');
  const edits = server.siteEdits.get(id);
  return {
    ...site,
    connectionPowerKw: 40,
    meteringPointId: 'PL-TEST-0001',
    notes: server.notes,
    ...(osd === undefined ? {} : { distributionSystemOperatorPartyId: osd.id }),
    ...(manager === undefined ? {} : { managerPartyId: manager.id }),
    ...cleaned({ ...edits?.fields }),
    // a field that was cleared stays cleared, also where the base record has a value
    ...Object.fromEntries(
      Object.entries(edits?.fields ?? {})
        .filter(([, value]) => value === null)
        .map(([key]) => [key, undefined]),
    ),
    id,
    version: edits?.version ?? 1,
    ...STAMPS,
  };
}

export function partyOf(server: LocationServer, id: string): Record<string, unknown> | undefined {
  const party = server.parties.find((entry) => entry.id === id);
  if (party === undefined || server.goneParties.has(id)) return undefined;
  const edits = server.partyEdits.get(id);
  return {
    legalForm: 'organization',
    ...party,
    ...cleaned({ ...edits?.fields }),
    ...Object.fromEntries(
      Object.entries(edits?.fields ?? {})
        .filter(([, value]) => value === null)
        .map(([key]) => [key, undefined]),
    ),
    id,
    version: edits?.version ?? 1,
    ...STAMPS,
  };
}

/** The card "Lokalizacja" of an order: the site as the card sends it (the parties as `{id, displayName}`). */
export function cardOf(server: LocationServer, siteId: string): Record<string, unknown> | undefined {
  const site = siteOf(server, siteId);
  if (site === undefined) return undefined;
  const ref = (id: unknown) => {
    const party = typeof id === 'string' ? partyOf(server, id) : undefined;
    return party === undefined ? null : { id: party['id'], displayName: party['displayName'] };
  };
  const fromServer = ['id', 'version', 'createdAt', 'updatedAt', 'distributionSystemOperatorPartyId', 'managerPartyId'];
  return {
    siteId: site['id'],
    ...Object.fromEntries(Object.entries(site).filter(([key]) => !fromServer.includes(key))),
    distributionSystemOperator: ref(site['distributionSystemOperatorPartyId']),
    manager: ref(site['managerPartyId']),
  };
}

export function answerSiteOrders(server: LocationServer): Answer {
  return json(200, { total: server.otherOrders.length, items: server.otherOrders.slice(0, 20) });
}

export type Role = 'administrator' | 'editor' | 'read_only';

export interface PatchRequest {
  readonly role: Role;
  readonly ifMatch: string | undefined;
  readonly key: string | undefined;
  readonly raw: string;
}

const etag = (version: unknown) => ({ ETag: `"${String(version)}"` });

export function answerRead(record: Record<string, unknown> | undefined, id: string): Answer {
  if (!UUID.test(id) || record === undefined) return problem(404, 'not_found');
  return json(200, record, etag(record['version']));
}

type Which = 'site' | 'party';

/**
 * `PATCH /sites/{id}` and `PATCH /parties/{id}`: the role first, then `If-Match` and the shape of the body, then the resource (404), the
 * replay of a key, the version (412), the rules of the domain, the change (the version goes up by one).
 */
export function answerPatch(server: LocationServer, which: Which, id: string, request: PatchRequest): Answer {
  if (request.role === 'read_only') return problem(403, 'forbidden');
  if (request.ifMatch === undefined) return problem(428, 'precondition_required');
  const match = /^"(\d+)"$/.exec(request.ifMatch);
  if (match === null) return problem(400, 'validation_failed', { errors: [{ pointer: '/headers/If-Match', code: 'invalid_format' }] });
  let patch: Record<string, unknown>;
  try {
    patch = JSON.parse(request.raw) as Record<string, unknown>;
  } catch {
    return problem(400, 'validation_failed');
  }
  const allowed = which === 'site' ? SITE_PATCHABLE : PARTY_PATCHABLE;
  const refused: Array<{ pointer: string; code: string }> = [];
  for (const key of Object.keys(patch)) {
    if (READ_ONLY.includes(key) || (which === 'party' && key === 'kind')) refused.push({ pointer: `/${key}`, code: 'read_only_field' });
    else if (!allowed.includes(key)) refused.push({ pointer: `/${key}`, code: 'unknown_field' });
  }
  if (refused.length > 0) return problem(400, 'validation_failed', { errors: refused });
  const current = UUID.test(id) ? (which === 'site' ? siteOf(server, id) : partyOf(server, id)) : undefined;
  if (current === undefined) return problem(404, 'not_found');
  const scope = `${which}|${id}|${request.raw}`;
  if (request.key !== undefined) {
    const seen = server.patchKeys.get(request.key);
    if (seen !== undefined) {
      return seen.scope === scope
        ? { ...seen.answer, headers: { ...seen.answer.headers, 'Idempotent-Replayed': 'true' } }
        : problem(422, 'idempotency_mismatch');
    }
  }
  if (Number(match[1]) !== current['version']) return problem(412, 'version_conflict');
  const next: Record<string, unknown> = cleaned({ ...current, ...patch });
  const errors: Array<{ pointer: string; code: string }> = [];
  if (which === 'site') {
    if (typeof next['postalCode'] === 'string' && !/^\d{2}-\d{3}$/.test(next['postalCode']))
      errors.push({ pointer: '/postalCode', code: 'invalid_format' });
    const power = next['connectionPowerKw'];
    if (power !== undefined && !(typeof power === 'number' && power > 0 && power <= 1000))
      errors.push({ pointer: '/connectionPowerKw', code: 'out_of_range' });
    if (next['siteType'] !== 'multi_family_garage') {
      for (const field of ['parkingSpotNumber', 'garageLevel'])
        if (next[field] !== undefined) errors.push({ pointer: `/${field}`, code: 'not_allowed_for_site_type' });
    }
    const checks: Array<[string, readonly string[]]> = [
      ['distributionSystemOperatorPartyId', ['distribution_system_operator']],
      ['managerPartyId', MANAGER_KINDS],
    ];
    for (const [field, kinds] of checks) {
      const partyId = patch[field];
      if (typeof partyId !== 'string') continue;
      const party = server.goneParties.has(partyId) ? undefined : server.parties.find((entry) => entry.id === partyId);
      if (party === undefined) errors.push({ pointer: `/${field}`, code: 'unknown_party' });
      else if (!kinds.includes(party.kind)) errors.push({ pointer: `/${field}`, code: 'wrong_party_kind' });
    }
  } else {
    if (typeof next['displayName'] !== 'string' || next['displayName'].trim() === '')
      errors.push({ pointer: '/displayName', code: 'required' });
    const phone = patch['phone'];
    if (typeof phone === 'string' && !/^[+\d\s()-]{9,}$/.test(phone)) errors.push({ pointer: '/phone', code: 'invalid_format' });
  }
  if (errors.length > 0) return problem(400, 'validation_failed', { errors });
  const fields = { ...(which === 'site' ? server.siteEdits : server.partyEdits).get(id)?.fields, ...patch };
  const normalised =
    which === 'party' && typeof patch['phone'] === 'string'
      ? { ...fields, phone: `+48${patch['phone'].replaceAll(/\D/g, '').slice(-9)}` }
      : fields;
  (which === 'site' ? server.siteEdits : server.partyEdits).set(id, { fields: normalised, version: Number(match[1]) + 1 });
  const saved = which === 'site' ? siteOf(server, id) : partyOf(server, id);
  const answer = json(200, saved, etag(Number(match[1]) + 1));
  if (request.key !== undefined) server.patchKeys.set(request.key, { scope, answer });
  return answer;
}

/**
 * The part of the synthetic API that serves W-14 "Klienci" (EVM-039): the list and the search with the order and the cursor of
 * the real API (surname before the first name, "Ł" after "L"), the details with the `ETag`, and the edit as a merge-patch with
 * `If-Match` (428, 400, 412), `Idempotency-Key` (replay, mismatch for another customer) and the rules of the real answers that the
 * browser can feel (a deleted customer is `404`, a field of the server is `read_only_field`). Synthetic data only. The full
 * stack (the database, the policies, the audit) is covered by the API integration tests.
 */
export interface MockCustomerRecord {
  id: string;
  displayName: string;
  phone: string;
  /** What the search looks at: name, city, e-mail (lower case, no diacritics). */
  text: string;
  kind?: 'person' | 'company';
  firstName?: string;
  lastName?: string;
  companyName?: string;
  taxId?: string | undefined;
  contactPersonName?: string | undefined;
  email?: string | undefined;
  notes?: string | undefined;
  postalAddress?: { street: string; buildingNumber: string; apartmentNumber?: string; postalCode: string; city: string } | undefined;
  version?: number;
  /** Soft-deleted: every read of it is `404`, like a customer that never existed. */
  deleted?: boolean;
}

export interface Answer {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Answer => ({
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const problem = (status: number, code: string, extra: object = {}): Answer => ({
  status,
  headers: { 'Content-Type': 'application/problem+json' },
  body: JSON.stringify({ type: '/problems/' + code, title: code, status, code, traceId: '0123456789abcdef0123456789abcdef', ...extra }),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PAGE = 25;

export const fold = (text: string): string =>
  text.normalize('NFD').replaceAll(/[̀-ͯ]/g, '').replaceAll('ł', 'l').replaceAll('Ł', 'l').toLowerCase();

/** The phone as E.164 (nine national digits get +48), or null when it is not a number. */
export function e164(text: string): string | null {
  const digits = text.replaceAll(/\D/g, '');
  if (!/^[+\d\s()-]+$/.test(text)) return null;
  if (digits.length === 9) return `+48${digits}`;
  if (digits.length === 11 && digits.startsWith('48')) return `+${digits}`;
  return null;
}

/** Surname before the first name; a company by its name. */
export const sortNameOf = (customer: MockCustomerRecord): string =>
  customer.kind === 'person' && customer.lastName !== undefined
    ? `${customer.lastName} ${customer.firstName ?? ''}`.trim()
    : customer.displayName;

const collator = new Intl.Collator('pl');
const visible = (customers: readonly MockCustomerRecord[]) => customers.filter((entry) => entry.deleted !== true);
const ordered = (customers: readonly MockCustomerRecord[]) =>
  visible(customers).toSorted((a, b) => collator.compare(sortNameOf(a), sortNameOf(b)) || a.id.localeCompare(b.id));

export const listItem = (customer: MockCustomerRecord) => ({
  id: customer.id,
  kind: customer.kind ?? 'person',
  displayName: customer.displayName,
  sortName: sortNameOf(customer),
  phone: customer.phone,
  email: customer.email ?? null,
});

/** The customer as `getCustomer` answers: no search text, no sort key, no deletion mark. */
export const customerBody = (customer: MockCustomerRecord) => ({
  id: customer.id,
  kind: customer.kind ?? 'person',
  ...(customer.firstName === undefined ? {} : { firstName: customer.firstName }),
  ...(customer.lastName === undefined ? {} : { lastName: customer.lastName }),
  ...(customer.companyName === undefined ? {} : { companyName: customer.companyName }),
  ...(customer.taxId === undefined ? {} : { taxId: customer.taxId }),
  ...(customer.contactPersonName === undefined ? {} : { contactPersonName: customer.contactPersonName }),
  phone: customer.phone,
  ...(customer.email === undefined ? {} : { email: customer.email }),
  ...(customer.postalAddress === undefined ? {} : { postalAddress: customer.postalAddress }),
  ...(customer.notes === undefined ? {} : { notes: customer.notes }),
  displayName: customer.displayName,
  version: customer.version ?? 1,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
});

/** A page of the ordered customers; the cursor is the position (opaque to the panel). */
function pageOf(items: readonly MockCustomerRecord[], cursor: string | null, limit: number) {
  const start = cursor === null ? 0 : Number(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!Number.isInteger(start) || start < 0) return null;
  const nextCursor = start + limit < items.length ? Buffer.from(String(start + limit)).toString('base64url') : null;
  return { items: items.slice(start, start + limit).map(listItem), nextCursor };
}

export function answerList(customers: readonly MockCustomerRecord[], query: URLSearchParams): Answer {
  const limit = Number(query.get('limit') ?? String(PAGE));
  const page = pageOf(ordered(customers), query.get('cursor'), limit);
  return page === null ? problem(400, 'invalid_cursor') : json(200, page, { 'Cache-Control': 'no-store' });
}

export function answerSearch(customers: readonly MockCustomerRecord[], raw: string): Answer {
  const { query, cursor, limit } = JSON.parse(raw) as { query?: string; cursor?: string; limit?: number };
  const phrase = (query ?? '').normalize('NFC').trim();
  if (Array.from(phrase).length < 3) {
    return problem(400, 'validation_failed', { errors: [{ pointer: '/query', code: 'too_short' }] });
  }
  const phoneLike = /^[+\d\s()-]+$/.test(phrase);
  const digits = phrase.replaceAll(/\D/g, '').replace(/^00/, '');
  const matching = ordered(customers).filter((entry) => (phoneLike ? entry.phone.includes(digits) : entry.text.includes(fold(phrase))));
  const page = pageOf(matching, cursor ?? null, limit ?? PAGE);
  return page === null ? problem(400, 'invalid_cursor') : json(200, page, { 'Cache-Control': 'no-store' });
}

export function answerRead(customers: readonly MockCustomerRecord[], id: string): Answer {
  if (!UUID.test(id)) return problem(400, 'validation_failed', { errors: [{ pointer: '/customerId', code: 'invalid_format' }] });
  const customer = visible(customers).find((entry) => entry.id === id);
  return customer === undefined
    ? problem(404, 'not_found')
    : json(200, customerBody(customer), { ETag: `"${String(customer.version ?? 1)}"`, 'Cache-Control': 'no-store' });
}

const READ_ONLY_FIELDS = [
  'id',
  'displayName',
  'sortName',
  'searchText',
  'version',
  'createdAt',
  'createdBy',
  'updatedAt',
  'updatedBy',
  'deletedAt',
];
const PATCHABLE = [
  'kind',
  'firstName',
  'lastName',
  'companyName',
  'taxId',
  'contactPersonName',
  'phone',
  'email',
  'postalAddress',
  'notes',
];

export interface PatchRequest {
  readonly role: 'administrator' | 'editor' | 'read_only';
  readonly ifMatch: string | undefined;
  readonly key: string | undefined;
  readonly raw: string;
}

/** `Idempotency-Key` → the customer and the body it was first used with, and the answer given. */
export type PatchKeys = Map<string, { readonly scope: string; readonly answer: Answer }>;

export function answerPatch(customers: MockCustomerRecord[], id: string, request: PatchRequest, keys: PatchKeys): Answer {
  // the order of the real API: the role first, then the shape of the headers and of the body, then the customer
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
  const unknown: Array<{ pointer: string; code: string }> = [];
  for (const key of Object.keys(patch)) {
    if (READ_ONLY_FIELDS.includes(key)) unknown.push({ pointer: `/${key}`, code: 'read_only_field' });
    else if (!PATCHABLE.includes(key)) unknown.push({ pointer: `/${key}`, code: 'unknown_field' });
  }
  if (unknown.length > 0) return problem(400, 'validation_failed', { errors: unknown });
  const customer = UUID.test(id) ? visible(customers).find((entry) => entry.id === id) : undefined;
  if (customer === undefined) return problem(404, 'not_found');
  const scope = `${id}|${request.raw}`;
  if (request.key !== undefined) {
    const seen = keys.get(request.key);
    if (seen !== undefined)
      return seen.scope === scope
        ? { ...seen.answer, headers: { ...seen.answer.headers, 'Idempotent-Replayed': 'true' } }
        : problem(422, 'idempotency_mismatch');
  }
  if (Number(match[1]) !== (customer.version ?? 1)) return problem(412, 'version_conflict');
  const errors: Array<{ pointer: string; code: string }> = [];
  const next = { ...customer };
  const kind = (patch['kind'] as 'person' | 'company' | undefined) ?? customer.kind ?? 'person';
  if (kind !== (customer.kind ?? 'person')) {
    // the fields of the previous kind are dropped
    delete next.firstName;
    delete next.lastName;
    delete next.companyName;
    delete next.taxId;
    delete next.contactPersonName;
    next.kind = kind;
  }
  for (const field of ['firstName', 'lastName', 'companyName'] as const) {
    if (typeof patch[field] === 'string') next[field] = patch[field];
  }
  const text = (field: 'taxId' | 'contactPersonName' | 'email' | 'notes') => {
    const value = patch[field];
    if (value === null) return undefined;
    return typeof value === 'string' ? (field === 'email' ? value.toLowerCase() : value) : next[field];
  };
  next.taxId = text('taxId');
  next.contactPersonName = text('contactPersonName');
  next.email = text('email');
  next.notes = text('notes');
  if (patch['postalAddress'] === null) next.postalAddress = undefined;
  else if (patch['postalAddress'] !== undefined) next.postalAddress = patch['postalAddress'] as MockCustomerRecord['postalAddress'];
  if (typeof patch['phone'] === 'string') {
    const phone = e164(patch['phone']);
    if (phone === null) errors.push({ pointer: '/phone', code: 'invalid_format' });
    else next.phone = phone;
  }
  if (typeof next.email === 'string' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next.email))
    errors.push({ pointer: '/email', code: 'invalid_format' });
  if (kind === 'person' && (next.firstName === undefined || next.lastName === undefined)) {
    if (next.firstName === undefined) errors.push({ pointer: '/firstName', code: 'required' });
    if (next.lastName === undefined) errors.push({ pointer: '/lastName', code: 'required' });
  }
  if (kind === 'company' && next.companyName === undefined) errors.push({ pointer: '/companyName', code: 'required' });
  if (errors.length > 0) return problem(400, 'validation_failed', { errors });
  next.displayName = kind === 'person' ? `${next.firstName ?? ''} ${next.lastName ?? ''}` : (next.companyName ?? '');
  next.version = (customer.version ?? 1) + 1;
  next.text = fold(`${next.displayName} ${next.email ?? ''} ${next.postalAddress?.city ?? ''}`);
  Object.assign(customer, next);
  const answer = json(200, customerBody(customer), { ETag: `"${String(customer.version)}"`, 'Cache-Control': 'no-store' });
  if (request.key !== undefined) keys.set(request.key, { scope, answer });
  return answer;
}

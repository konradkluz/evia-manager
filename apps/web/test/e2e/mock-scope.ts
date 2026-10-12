import type { Answer } from './mock-locations.ts';

/**
 * The part of the synthetic API that serves the editing of the data and of the scope of an order (EVM-035): the catalogue of the
 * items with the processes they bring, `PATCH` of the order and `POST` / `PATCH` / `DELETE` of a scope item with the rules of the
 * real answers that the browser can feel — `If-Match` (428, 400, 412), the role (403), a closed order (409), an item of another
 * order (404), the limit of 50 (422), the replay of an `Idempotency-Key`, `id_conflict`. Synthetic data only; the full stack (the
 * database, the transaction, the audit, the matrix of roles) is covered by the API integration tests.
 */
export interface MockScopeItem {
  id: string;
  position: number;
  code: string;
  name: string;
  parameterSetCode: string | null;
  parameters: Record<string, unknown>;
  quantity: number;
  notes?: string;
  version: number;
}

export interface MockAddedProcess {
  readonly code: string;
  readonly name: string;
  readonly stages: readonly string[];
  readonly sourceScopeItemId: string;
}

/** What the editing changed in a created order: its fields, its scope (once edited) and the processes added with the items. */
export interface MockEdits {
  title?: string;
  description?: string | null;
  plannedDate?: string | null;
  assigneeUserId?: string;
  items?: MockScopeItem[];
  added: MockAddedProcess[];
}

/** What this part of the synthetic API reads of the server of the orders (a structural subset: no import cycle). */
export interface ScopeServer {
  readonly created: ReadonlyArray<{ readonly id: string; readonly scopeItems: number }>;
  readonly gone: ReadonlySet<string>;
  readonly assignable: ReadonlyArray<{ readonly id: string; readonly displayName: string }>;
  readonly states: Map<string, { status: string; version: number }>;
  readonly edits: Map<string, MockEdits>;
  /** `Idempotency-Key` → the scope (`method|path|body`) and the answer given (a retry gets the same one). */
  readonly editKeys: Map<string, { readonly scope: string; readonly answer: Answer }>;
}

export type Role = 'administrator' | 'editor' | 'read_only';

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Answer => ({
  status,
  headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json', ...headers },
  body: JSON.stringify(body),
});

const problem = (status: number, code: string, extra: Record<string, unknown> = {}): Answer =>
  json(status, { type: `/problems/${code}`, title: code, status, code, traceId: 'abcdef0123456789abcdef0123456789', ...extra });

const NOT_FOUND = problem(404, 'not_found');

export const SCOPE_ITEMS_LIMIT = 50;

interface CatalogItem {
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly parameterSetCode: string | null;
  readonly procedureTemplateCodes: readonly string[];
}

export const CATALOG_ITEMS: readonly CatalogItem[] = [
  {
    code: 'charger_supply',
    name: 'Ładowarka klienta',
    category: 'equipment',
    parameterSetCode: 'charger_spec',
    procedureTemplateCodes: [],
  },
  {
    code: 'supply_installation',
    name: 'Instalacja zasilająca',
    category: 'installation',
    parameterSetCode: 'supply_circuit',
    procedureTemplateCodes: ['supply', 'osd'],
  },
  { code: 'measurements', name: 'Pomiary i odbiór', category: 'acceptance', parameterSetCode: null, procedureTemplateCodes: [] },
  { code: 'custom_service', name: 'Inna usługa (opis w zleceniu)', category: 'other', parameterSetCode: null, procedureTemplateCodes: [] },
];

export const CATALOG_PROCEDURES = [
  {
    code: 'supply',
    name: 'Instalacja zasilająca',
    stages: ['Wykonanie linii zasilającej', 'Zabezpieczenia', 'Pomiary'],
  },
  { code: 'osd', name: 'Uzgodnienia z OSD', stages: ['Wniosek', 'Warunki przyłączenia'] },
  { code: 'admin', name: 'Zgody administracji', stages: ['Wniosek do administracji', 'Zgoda administracji'] },
  { code: 'ppoz', name: 'Opinia ppoż', stages: ['Opinia rzeczoznawcy'] },
];

/** EVM-033: the stages that have a default "Czekamy na…" (a hint of the panel; the others have none). */
const DEFAULT_WAITING: Readonly<Record<string, { waitingOn: 'customer' | 'party'; partyKind: string | null }>> = {
  osd_1: { waitingOn: 'customer', partyKind: null },
  osd_2: { waitingOn: 'party', partyKind: 'distribution_system_operator' },
  admin_2: { waitingOn: 'party', partyKind: 'housing_community' },
  ppoz_1: { waitingOn: 'party', partyKind: 'fire_safety_expert' },
};

export const answerCatalogItems = (): Answer => json(200, { items: CATALOG_ITEMS, nextCursor: null });

export const answerCatalogProcedures = (): Answer =>
  json(200, {
    items: CATALOG_PROCEDURES.map((entry) => ({
      code: entry.code,
      name: entry.name,
      stages: entry.stages.map((name, index) => ({
        code: `${entry.code}_${String(index + 1)}`,
        name,
        position: index + 1,
        defaultWaitingOn: DEFAULT_WAITING[`${entry.code}_${String(index + 1)}`]?.waitingOn ?? null,
        defaultWaitingOnPartyKind: DEFAULT_WAITING[`${entry.code}_${String(index + 1)}`]?.partyKind ?? null,
        outputDocumentKindCodes: [],
      })),
    })),
    nextCursor: null,
  });

/** The items of the scope of a created order before any edit: the same generated ones the reads of W-06 serve. */
export function initialItems(count: number): MockScopeItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: '01968f3e-0000-7000-8000-' + String(index).padStart(12, '0'),
    position: index + 1,
    code: 'item_' + String(index),
    name: 'Pozycja ' + String(index + 1),
    parameterSetCode: index === 0 ? 'charger_spec' : null,
    parameters: index === 0 ? { currentType: 'ac', powerKw: 11, phases: 3 } : {},
    quantity: 1,
    version: 1,
  }));
}

export const editsOf = (server: ScopeServer, id: string): MockEdits => {
  const existing = server.edits.get(id);
  if (existing !== undefined) return existing;
  const fresh: MockEdits = { added: [] };
  server.edits.set(id, fresh);
  return fresh;
};

export function itemsOf(server: ScopeServer, id: string): MockScopeItem[] {
  const edits = editsOf(server, id);
  edits.items ??= initialItems(server.created.find((entry) => entry.id === id)?.scopeItems ?? 0);
  return edits.items;
}

const representItem = (item: MockScopeItem) => ({ ...item });

interface Input {
  readonly role: Role;
  readonly ifMatch: string | undefined;
  readonly key: string | undefined;
  readonly raw: string;
  readonly path: string;
}

type Parsed = { ok: true; value: Record<string, unknown> } | { ok: false };

function parseObject(raw: string): Parsed {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? { ok: true, value: value as Record<string, unknown> }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** `If-Match` → the version, or the answer that refuses it (428 missing, 400 malformed). */
function versionOf(ifMatch: string | undefined): { version: number } | { answer: Answer } {
  if (ifMatch === undefined) return { answer: problem(428, 'precondition_required') };
  const match = /^"([1-9]\d{0,8})"$/.exec(ifMatch);
  if (match === null) {
    return { answer: problem(400, 'validation_failed', { errors: [{ pointer: '/headers/If-Match', code: 'invalid_format' }] }) };
  }
  return { version: Number(match[1]) };
}

const isClosed = (server: ScopeServer, id: string): boolean => {
  const status = server.states.get(id)?.status ?? 'new';
  return status === 'settled' || status === 'cancelled';
};

/** The same key and body is the same answer (`Idempotent-Replayed`); the same key elsewhere is 422. */
function replayOf(server: ScopeServer, input: Input, scope: string): Answer | undefined {
  if (input.key === undefined) return undefined;
  const seen = server.editKeys.get(input.key);
  if (seen === undefined) return undefined;
  if (seen.scope !== scope) return problem(422, 'idempotency_mismatch');
  return { ...seen.answer, headers: { ...seen.answer.headers, 'Idempotent-Replayed': 'true' } };
}

function remember(server: ScopeServer, input: Input, scope: string, answer: Answer): Answer {
  if (input.key !== undefined && answer.status < 300) server.editKeys.set(input.key, { scope, answer });
  return answer;
}

const FORBIDDEN_FIELDS = new Set([
  'id',
  'number',
  'status',
  'customerId',
  'siteId',
  'customer',
  'site',
  'coordinator',
  'version',
  'createdAt',
]);
const ORDER_FIELDS = new Set(['title', 'description', 'plannedDate', 'assigneeUserId']);

/** `PATCH /work-orders/{id}`: the role, 404, `If-Match`, the body (400), 409 for a closed order, 412, the person (400), the change. */
export function answerOrderPatch(server: ScopeServer, id: string, input: Input, representOrder: () => Answer): Answer {
  if (input.role === 'read_only') return problem(403, 'forbidden');
  const created = server.created.find((entry) => entry.id === id);
  if (created === undefined || server.gone.has(id)) return NOT_FOUND;
  const given = versionOf(input.ifMatch);
  if ('answer' in given) return given.answer;
  const parsed = parseObject(input.raw);
  if (!parsed.ok) return problem(400, 'validation_failed');
  for (const key of Object.keys(parsed.value)) {
    if (FORBIDDEN_FIELDS.has(key)) return problem(400, 'validation_failed', { errors: [{ pointer: `/${key}`, code: 'read_only_field' }] });
    if (!ORDER_FIELDS.has(key)) return problem(400, 'validation_failed', { errors: [{ pointer: `/${key}`, code: 'unknown_field' }] });
  }
  const scope = `PATCH|${input.path}|${input.raw}`;
  const replay = replayOf(server, input, scope);
  if (replay !== undefined) return replay;
  if (isClosed(server, id)) return problem(409, 'work_order_closed');
  const state = server.states.get(id) ?? { status: 'new', version: 1 };
  if (given.version !== state.version) return problem(412, 'version_conflict');
  const title = parsed.value['title'];
  if (title !== undefined && (typeof title !== 'string' || title.trim() === '')) {
    return problem(400, 'validation_failed', { errors: [{ pointer: '/title', code: 'required' }] });
  }
  const assignee = parsed.value['assigneeUserId'];
  if (typeof assignee === 'string' && !server.assignable.some((entry) => entry.id === assignee)) {
    return problem(400, 'validation_failed', { errors: [{ pointer: '/assigneeUserId', code: 'assignee_unavailable' }] });
  }
  const edits = editsOf(server, id);
  if (typeof title === 'string') edits.title = title.trim();
  if ('description' in parsed.value) edits.description = parsed.value['description'] as string | null;
  if ('plannedDate' in parsed.value) edits.plannedDate = parsed.value['plannedDate'] as string | null;
  if (typeof assignee === 'string') edits.assigneeUserId = assignee;
  const next = { ...state, version: state.version + 1 };
  server.states.set(id, next);
  const order = representOrder();
  return remember(server, input, scope, { ...order, headers: { ...order.headers, ETag: `"${String(next.version)}"` } });
}

const ITEM_SERVER_FIELDS = new Set(['code', 'name', 'parameterSetCode', 'position', 'quantity', 'sourceCatalogItemId', 'version']);

function validParameters(setCode: string | null, parameters: unknown): boolean {
  if (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters)) return false;
  const keys = Object.keys(parameters);
  if (keys.length === 0) return true;
  if (setCode === null) return false;
  if (setCode === 'supply_circuit') {
    const allowed = [
      'dedicatedCircuit',
      'internalSupplyLine',
      'cableLengthM',
      'cableCrossSectionMm2',
      'residualCurrentDeviceType',
      'overcurrentProtectionA',
    ];
    return keys.every((key) => allowed.includes(key)) && keys.includes('dedicatedCircuit');
  }
  if (setCode === 'charger_spec') {
    const allowed = ['currentType', 'powerKw', 'phases', 'outlet', 'manufacturer', 'model'];
    return keys.every((key) => allowed.includes(key)) && keys.includes('currentType') && keys.includes('powerKw');
  }
  return true;
}

/** `POST /work-orders/{id}/scope-items`: the role, 404, the body (400), the replay, 409 for a closed order, the limit (422), the item and its processes. */
export function answerScopeCreate(server: ScopeServer, id: string, input: Input): Answer {
  if (input.role === 'read_only') return problem(403, 'forbidden');
  const created = server.created.find((entry) => entry.id === id);
  if (created === undefined || server.gone.has(id)) return NOT_FOUND;
  const parsed = parseObject(input.raw);
  if (!parsed.ok) return problem(400, 'validation_failed');
  const body = parsed.value;
  for (const key of Object.keys(body)) {
    if (ITEM_SERVER_FIELDS.has(key))
      return problem(400, 'validation_failed', { errors: [{ pointer: `/${key}`, code: 'read_only_field' }] });
    if (!['id', 'catalogItemCode', 'parameters', 'notes', 'procedureCodes'].includes(key)) {
      return problem(400, 'validation_failed', { errors: [{ pointer: `/${key}`, code: 'unknown_field' }] });
    }
  }
  const scope = `POST|${input.path}|${input.raw}`;
  const replay = replayOf(server, input, scope);
  if (replay !== undefined) return replay;
  const items = itemsOf(server, id);
  const itemId = body['id'];
  if (typeof itemId !== 'string') return problem(400, 'validation_failed', { errors: [{ pointer: '/id', code: 'required' }] });
  if (items.some((entry) => entry.id === itemId)) return problem(409, 'id_conflict');
  if (isClosed(server, id)) return problem(409, 'work_order_closed');
  const catalog = CATALOG_ITEMS.find((entry) => entry.code === body['catalogItemCode']);
  if (catalog === undefined) {
    return problem(400, 'validation_failed', { errors: [{ pointer: '/catalogItemCode', code: 'unknown_catalog_item' }] });
  }
  const parameters = body['parameters'] ?? {};
  if (!validParameters(catalog.parameterSetCode, parameters)) {
    return problem(400, 'validation_failed', { errors: [{ pointer: '/parameters', code: 'invalid' }] });
  }
  const notes = typeof body['notes'] === 'string' ? body['notes'].trim() : undefined;
  if (catalog.code === 'custom_service' && (notes === undefined || notes === '')) {
    return problem(400, 'validation_failed', { errors: [{ pointer: '/notes', code: 'required' }] });
  }
  if (items.length >= SCOPE_ITEMS_LIMIT) return problem(422, 'limit_exceeded', { errors: [{ pointer: '', code: 'too_many_scope_items' }] });
  const requested = Array.isArray(body['procedureCodes']) ? (body['procedureCodes'] as string[]) : [];
  for (const [index, code] of requested.entries()) {
    if (!catalog.procedureTemplateCodes.includes(code)) {
      return problem(400, 'validation_failed', { errors: [{ pointer: `/procedureCodes/${String(index)}`, code: 'not_brought_by_item' }] });
    }
  }
  const edits = editsOf(server, id);
  const present = new Set(edits.added.map((entry) => entry.code));
  const addedCodes = requested.filter((code) => !present.has(code));
  const item: MockScopeItem = {
    id: itemId,
    position: items.length + 1,
    code: catalog.code,
    name: catalog.name,
    parameterSetCode: catalog.parameterSetCode,
    parameters: parameters as Record<string, unknown>,
    quantity: 1,
    ...(notes === undefined || notes === '' ? {} : { notes }),
    version: 1,
  };
  items.push(item);
  for (const code of addedCodes) {
    const template = CATALOG_PROCEDURES.find((entry) => entry.code === code);
    if (template !== undefined) edits.added.push({ code, name: template.name, stages: template.stages, sourceScopeItemId: itemId });
  }
  return remember(server, input, scope, json(201, { item: representItem(item), addedProcedureCodes: addedCodes }, { ETag: '"1"' }));
}

/** `PATCH` and `DELETE /work-orders/{id}/scope-items/{itemId}`: the role, 404 (also an item of another order), `If-Match`, 409, 412, the change. */
export function answerScopeChange(server: ScopeServer, id: string, itemId: string, method: 'PATCH' | 'DELETE', input: Input): Answer {
  if (input.role === 'read_only') return problem(403, 'forbidden');
  const created = server.created.find((entry) => entry.id === id);
  if (created === undefined || server.gone.has(id)) return NOT_FOUND;
  const scope = `${method}|${input.path}|${input.raw}`;
  const replay = replayOf(server, input, scope);
  if (replay !== undefined) return replay;
  const items = itemsOf(server, id);
  const item = items.find((entry) => entry.id === itemId);
  if (item === undefined) return NOT_FOUND;
  const given = versionOf(input.ifMatch);
  if ('answer' in given) return given.answer;
  let patch: Record<string, unknown> = {};
  if (method === 'PATCH') {
    const parsed = parseObject(input.raw);
    if (!parsed.ok) return problem(400, 'validation_failed');
    patch = parsed.value;
    for (const key of Object.keys(patch)) {
      if (ITEM_SERVER_FIELDS.has(key))
        return problem(400, 'validation_failed', { errors: [{ pointer: `/${key}`, code: 'read_only_field' }] });
      if (key !== 'parameters' && key !== 'notes') {
        return problem(400, 'validation_failed', { errors: [{ pointer: `/${key}`, code: 'unknown_field' }] });
      }
    }
  }
  if (isClosed(server, id)) return problem(409, 'work_order_closed');
  if (given.version !== item.version) return problem(412, 'version_conflict');
  if (method === 'DELETE') {
    items.splice(items.indexOf(item), 1);
    items.forEach((entry, index) => {
      entry.position = index + 1;
    });
    return remember(server, input, scope, { status: 204, headers: {}, body: '' });
  }
  if ('parameters' in patch) {
    if (!validParameters(item.parameterSetCode, patch['parameters'])) {
      return problem(400, 'validation_failed', { errors: [{ pointer: '/parameters', code: 'invalid' }] });
    }
    item.parameters = patch['parameters'] as Record<string, unknown>;
  }
  if ('notes' in patch) {
    const notes = patch['notes'];
    if (typeof notes === 'string' && notes.trim() !== '') item.notes = notes.trim();
    else if (item.code === 'custom_service')
      return problem(400, 'validation_failed', { errors: [{ pointer: '/notes', code: 'required' }] });
    else delete item.notes;
  }
  item.version += 1;
  return remember(server, input, scope, json(200, representItem(item), { ETag: `"${String(item.version)}"` }));
}

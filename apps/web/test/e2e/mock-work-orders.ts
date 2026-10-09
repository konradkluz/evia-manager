import { answerSiteOrders, cardOf, type LocationServer } from './mock-locations.ts';
import { PROCESSES, processCountOf, type StageState } from './mock-procedures.ts';

/**
 * The part of the synthetic API that serves W-05 "3. Szablon" and "Utwórz zlecenie" (EVM-022): the catalogue of templates, the
 * users who can be a coordinator and the creation of an order with the rules of the real one that the browser can feel — the
 * same answer for a missing customer and a missing site (404), a retired template (422), an unavailable coordinator (400),
 * a retry with the same key (replay). Synthetic data only. The full stack is covered by the API integration tests.
 */
export interface MockTemplate {
  readonly id: string;
  readonly name: string;
  readonly siteTypeHint: string | null;
  readonly isActive: boolean;
  readonly items: readonly string[];
}

export interface MockCreatedOrder {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly customerId: string;
  readonly siteId: string;
  readonly templateId: string | null;
  readonly assigneeUserId: string;
  readonly plannedDate: string | undefined;
  readonly description: string | undefined;
  readonly scopeItems: number;
}

export interface MockAssignable {
  readonly id: string;
  readonly displayName: string;
}

/** EVM-030: the life cycle of a created order on the synthetic server (the table of transitions is the one of `domain-model.md`, reduced). */
export interface OrderState {
  status: string;
  version: number;
  resumeStatus?: string;
  completedOn?: string;
  closedAt?: string;
}

export interface OrderServer extends LocationServer {
  readonly templates: MockTemplate[];
  readonly assignable: MockAssignable[];
  readonly created: MockCreatedOrder[];
  readonly customers: ReadonlyArray<{ id: string; displayName: string; phone: string }>;
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
  readonly parties: ReadonlyArray<{ id: string; kind: string; displayName: string }>;
  /** EVM-018: orders that are gone (deleted) — every read of them is `404 not_found`, like an order that never existed. */
  readonly gone: Set<string>;
  /** EVM-018: the notes of every site on the card "Lokalizacja" (free text — a test puts markup in it). */
  notes: string;
  /** `Idempotency-Key` → the body it was first used with. */
  readonly keys: Map<string, string>;
  /** EVM-030: the status and the version of every created order (by id). */
  readonly states: Map<string, OrderState>;
  /** EVM-031: the person and the due date of every stage of the created orders (by id of the stage). */
  readonly stages: Map<string, StageState>;
  /** EVM-030: `Idempotency-Key` of a transition → the scope (`orderId|body`) and the answer given (a retry gets the same one). */
  readonly transitionKeys: Map<string, { readonly scope: string; readonly answer: Answer }>;
}

interface Answer {
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

export const INITIAL_TEMPLATES: MockTemplate[] = [
  {
    id: '01968f3e-0000-7000-8000-00000000f001',
    name: 'Garaż — pełny proces',
    siteTypeHint: 'multi_family_garage',
    isActive: true,
    items: [
      'Zgody administracji / wspólnoty',
      'Ekspertyza techniczna',
      'Opinia ppoż',
      'Projekt instalacji',
      'Uzgodnienia z OSD',
      'Instalacja zasilająca',
      'Dostawa ładowarki (z oferty)',
      'Montaż i uruchomienie',
      'Pomiary i odbiór',
    ],
  },
  {
    id: '01968f3e-0000-7000-8000-00000000f002',
    name: 'Garaż — montaż ładowarki',
    siteTypeHint: 'multi_family_garage',
    isActive: true,
    items: ['Dostawa ładowarki (z oferty)', 'Montaż i uruchomienie'],
  },
  {
    id: '01968f3e-0000-7000-8000-00000000f003',
    name: 'Dom — montaż ładowarki',
    siteTypeHint: 'single_family_house',
    isActive: true,
    items: ['Dostawa ładowarki (z oferty)', 'Montaż i uruchomienie'],
  },
];

/** The templates as the contract sends them — with the processes (EVM-031) and the instalments that the panel must not show yet. */
function templateBody(template: MockTemplate) {
  return {
    id: template.id,
    code: 'template_' + template.id.slice(-3),
    name: template.name,
    siteTypeHint: template.siteTypeHint,
    isActive: template.isActive,
    items: template.items.map((name, index) => ({
      code: 'item_' + String(index),
      name,
      position: index + 1,
      defaultQuantity: 1,
      parameterSetCode: null,
      defaultParameters: {},
    })),
    procedures: PROCESSES.slice(0, processCountOf(template.items.length)).map((process) => ({
      code: process.code,
      name: process.name,
      stageCount: process.stages.length,
    })),
    paymentMilestones: [
      { code: 'advance', name: 'Zaliczka', position: 1, sharePercent: 20, invoiceHint: 'Po akceptacji', paymentTermDays: 7 },
    ],
  };
}

const stateOf = (server: OrderServer, id: string): OrderState => server.states.get(id) ?? { status: 'new', version: 1 };

function represent(server: OrderServer, created: MockCreatedOrder) {
  const state = stateOf(server, created.id);
  const customer = server.customers.find((entry) => entry.id === created.customerId);
  const site = server.sites.find((entry) => entry.id === created.siteId);
  const coordinator = server.assignable.find((entry) => entry.id === created.assigneeUserId);
  return {
    id: created.id,
    number: created.number,
    title: created.title,
    status: state.status,
    customer: { id: created.customerId, displayName: customer?.displayName ?? '' },
    site,
    coordinator: { id: created.assigneeUserId, displayName: coordinator?.displayName ?? '' },
    ...(created.plannedDate === undefined ? {} : { plannedDate: created.plannedDate }),
    ...(created.description === undefined ? {} : { description: created.description }),
    scopeItems: Array.from({ length: created.scopeItems }, (_, index) => ({
      id: '01968f3e-0000-7000-8000-' + String(index).padStart(12, '0'),
      position: index + 1,
      code: 'item_' + String(index),
      name: 'Pozycja ' + String(index + 1),
      parameterSetCode: null,
      parameters: {},
      quantity: 1,
    })),
    version: state.version,
    createdAt: new Date().toISOString(),
  };
}

/** The items of W-10 for the orders created so far (newest first). */
/** The orders created in this run, newest first; with `customerId` only the orders of that customer (EVM-039 "Historia zleceń"). */
export function createdListItems(server: OrderServer, customerId?: string) {
  return server.created
    .filter((created) => customerId === undefined || created.customerId === customerId)
    .map((created) => ({
      id: created.id,
      number: created.number,
      title: created.title,
      status: stateOf(server, created.id).status,
      coordinator: server.assignable.find((entry) => entry.id === created.assigneeUserId) ?? null,
      createdAt: new Date().toISOString(),
    }))
    .toReversed();
}

export function answerTemplates(server: OrderServer): Answer {
  return json(200, { items: server.templates.filter((entry) => entry.isActive).map(templateBody), nextCursor: null });
}

export function answerAssignable(server: OrderServer): Answer {
  return json(200, { items: server.assignable, nextCursor: null });
}

interface CreateInput {
  readonly id: string;
  readonly customerId: string;
  readonly siteId: string;
  readonly templateId: string | null;
  readonly title?: string;
  readonly assigneeUserId?: string;
  readonly plannedDate?: string;
  readonly description?: string;
}

/** `'abort'` — the work is done but the answer is lost (a network error after the request was sent). */
export function answerCreate(
  server: OrderServer,
  input: CreateInput,
  idempotencyKey: string | undefined,
  rawBody: string,
  sessionUserId: string,
  loseAnswer: boolean,
): Answer | 'abort' {
  if (idempotencyKey !== undefined) {
    const seen = server.keys.get(idempotencyKey);
    if (seen !== undefined && seen !== rawBody) return problem(422, 'idempotency_mismatch');
    const existing = server.created.find((entry) => entry.id === input.id);
    if (seen !== undefined && existing !== undefined) {
      return json(201, represent(server, existing), { 'Idempotent-Replayed': 'true', ETag: '"1"' });
    }
  }
  if (server.created.some((entry) => entry.id === input.id)) return problem(409, 'id_conflict');
  // The same answer for a missing customer and a missing site (SR-AUTHZ-02).
  if (!server.customers.some((entry) => entry.id === input.customerId) || !server.sites.some((entry) => entry.id === input.siteId)) {
    return problem(404, 'not_found');
  }
  const template =
    input.templateId === null ? undefined : server.templates.find((entry) => entry.id === input.templateId && entry.isActive);
  if (input.templateId !== null && template === undefined) return problem(422, 'template_unavailable');
  const assigneeUserId = input.assigneeUserId ?? sessionUserId;
  if (!server.assignable.some((entry) => entry.id === assigneeUserId)) {
    return problem(400, 'validation_failed', { errors: [{ pointer: '/assigneeUserId', code: 'assignee_unavailable' }] });
  }
  const created: MockCreatedOrder = {
    id: input.id,
    number: 'ZL-2026-' + String(42 + server.created.length).padStart(4, '0'),
    title: input.title ?? template?.name ?? 'Nowe zlecenie',
    customerId: input.customerId,
    siteId: input.siteId,
    templateId: input.templateId,
    assigneeUserId,
    plannedDate: input.plannedDate,
    description: input.description,
    scopeItems: template?.items.length ?? 0,
  };
  server.created.push(created);
  server.states.set(created.id, { status: 'new', version: 1 });
  if (idempotencyKey !== undefined) server.keys.set(idempotencyKey, rawBody);
  if (loseAnswer) return 'abort';
  return json(201, represent(server, created), { ETag: '"1"' });
}

const NOT_FOUND = problem(404, 'not_found');

/** The items of the scope of a created order: the first one with parameters (AC, 11 kW, 3 fazy), the rest plain. */
function scopeItemsOf(created: MockCreatedOrder) {
  return Array.from({ length: created.scopeItems }, (_, index) => ({
    id: '01968f3e-0000-7000-8000-' + String(index).padStart(12, '0'),
    position: index + 1,
    code: 'item_' + String(index),
    name: 'Pozycja ' + String(index + 1),
    parameterSetCode: index === 0 ? 'charger_spec' : null,
    parameters: index === 0 ? { currentType: 'ac', powerKw: 11, phases: 3 } : {},
    quantity: 1,
  }));
}

/**
 * The four reads of one order (EVM-018; W-06): `''` the header, `scope-items`, `customer`, `site`. An order that was not created in this
 * run, and one that is `gone`, are the same `404 not_found`. Every answer has only the fields of the contract.
 */
export function answerOrderRead(
  server: OrderServer,
  id: string,
  part: '' | 'scope-items' | 'customer' | 'site' | 'site-orders',
  role: Role = 'administrator',
): Answer {
  const created = server.created.find((entry) => entry.id === id);
  if (created === undefined || server.gone.has(id)) return NOT_FOUND;
  const customer = server.customers.find((entry) => entry.id === created.customerId);
  const site = server.sites.find((entry) => entry.id === created.siteId);
  if (part === '') {
    const order = represent(server, created);
    const state = stateOf(server, created.id);
    const header = {
      id: order.id,
      number: order.number,
      title: order.title,
      status: order.status,
      customer: order.customer,
      site: order.site,
      coordinator: order.coordinator,
      allowedTransitions: allowedFor(role, state),
      ...(state.resumeStatus === undefined ? {} : { resumeStatus: state.resumeStatus }),
      ...(state.completedOn === undefined ? {} : { completedOn: state.completedOn }),
      ...(state.closedAt === undefined ? {} : { closedAt: state.closedAt }),
      version: order.version,
      createdAt: order.createdAt,
    };
    return json(200, header, { ETag: `"${String(state.version)}"` });
  }
  if (part === 'scope-items') return json(200, { items: scopeItemsOf(created) });
  if (part === 'customer') {
    return customer === undefined
      ? NOT_FOUND
      : json(200, { displayName: customer.displayName, phone: customer.phone, email: 'jan.przykladowy@example.com' });
  }
  if (site === undefined) return NOT_FOUND;
  if (part === 'site-orders') return answerSiteOrders(server);
  const card = cardOf(server, site.id);
  return card === undefined ? NOT_FOUND : json(200, card);
}

export type Role = 'administrator' | 'editor' | 'read_only';

/** Every edge the table has, whoever walks it (the restore edges are the ones of the closed states). */
const EDGES: Readonly<Record<string, readonly string[]>> = {
  new: ['quoting', 'accepted', 'on_hold', 'cancelled'],
  quoting: ['accepted', 'on_hold', 'cancelled'],
  accepted: ['in_progress', 'on_hold', 'cancelled'],
  in_progress: ['completed', 'on_hold', 'cancelled'],
  completed: ['settled', 'in_progress'],
  settled: ['completed'],
  cancelled: ['on_hold'],
};

const isRestore = (from: string, to: string): boolean =>
  (from === 'settled' && to === 'completed') || (from === 'cancelled' && to === 'on_hold');

function edgesOf(state: OrderState): readonly string[] {
  return state.status === 'on_hold' ? [state.resumeStatus ?? 'in_progress', 'cancelled'] : (EDGES[state.status] ?? []);
}

/** `allowedTransitions` of the caller: Tylko odczyt none, the Editor without the restore edges (EVM-030). */
export function allowedFor(role: Role, state: OrderState): string[] {
  if (role === 'read_only') return [];
  return edgesOf(state).filter((to) => role === 'administrator' || !isRestore(state.status, to));
}

interface TransitionInput {
  readonly role: Role;
  readonly stepUpFresh: boolean;
  readonly ifMatch: string | undefined;
  readonly key: string | undefined;
  readonly raw: string;
}

/**
 * `POST /work-orders/{id}/transitions` of the synthetic API: 404, then 428/400 (`If-Match`), the replay of a key, the role, the edge (409; 412
 * when the version is stale), the step-up of the restore, the version (412), the reason (400), the change. Same key and body: the same answer.
 */
export function answerTransition(server: OrderServer, id: string, input: TransitionInput): Answer {
  const created = server.created.find((entry) => entry.id === id);
  if (created === undefined || server.gone.has(id)) return NOT_FOUND;
  if (input.ifMatch === undefined) return problem(428, 'precondition_required');
  const match = /^"(\d{1,9})"$/.exec(input.ifMatch);
  if (match === null) return problem(400, 'validation_failed', { errors: [{ pointer: '/headers/If-Match', code: 'invalid_format' }] });
  const scope = id + '|' + input.raw;
  const replay = input.key === undefined ? undefined : server.transitionKeys.get(input.key);
  if (replay !== undefined) {
    if (replay.scope !== scope) return problem(422, 'idempotency_mismatch');
    return { ...replay.answer, headers: { ...replay.answer.headers, 'Idempotent-Replayed': 'true' } };
  }
  if (input.role === 'read_only') return problem(403, 'forbidden');
  const state = stateOf(server, id);
  const request = JSON.parse(input.raw) as { to: string; reason?: string; completedOn?: string };
  const stale = Number(match[1]) !== state.version;
  if (!edgesOf(state).includes(request.to)) return stale ? problem(412, 'version_conflict') : problem(409, 'invalid_state_transition');
  if (isRestore(state.status, request.to)) {
    if (input.role !== 'administrator') return problem(403, 'forbidden');
    if (!input.stepUpFresh) return problem(403, 'step_up_required');
  }
  if (stale) return problem(412, 'version_conflict');
  const needsReason = (request.to === 'on_hold' || request.to === 'cancelled') && !isRestore(state.status, request.to);
  if (needsReason && (request.reason === undefined || request.reason.trim() === '')) {
    return problem(400, 'validation_failed', { errors: [{ pointer: '/reason', code: 'required' }] });
  }
  const next: OrderState = { status: request.to, version: state.version + 1 };
  if (request.to === 'on_hold' && state.status !== 'cancelled') next.resumeStatus = state.status;
  if (request.to === 'completed') next.completedOn = request.completedOn ?? new Date().toISOString().slice(0, 10);
  if (request.to === 'settled' || request.to === 'cancelled') next.closedAt = new Date().toISOString();
  server.states.set(id, next);
  const order = answerOrderRead(server, id, '', input.role);
  const answer = { ...order, headers: { ...order.headers, ETag: `"${String(next.version)}"` } };
  if (input.key !== undefined) server.transitionKeys.set(input.key, { scope, answer });
  return answer;
}

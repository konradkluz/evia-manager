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

export interface OrderServer {
  readonly templates: MockTemplate[];
  readonly assignable: MockAssignable[];
  readonly created: MockCreatedOrder[];
  readonly customers: ReadonlyArray<{ id: string; displayName: string }>;
  readonly sites: ReadonlyArray<{ id: string }>;
  /** `Idempotency-Key` → the body it was first used with. */
  readonly keys: Map<string, string>;
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

/** The templates as the contract sends them — with the processes and the instalments that the panel must not show yet. */
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
    procedures: [{ code: 'osd', name: 'Uzgodnienia z OSD', stageCount: 7 }],
    paymentMilestones: [
      { code: 'advance', name: 'Zaliczka', position: 1, sharePercent: 20, invoiceHint: 'Po akceptacji', paymentTermDays: 7 },
    ],
  };
}

function represent(server: OrderServer, created: MockCreatedOrder) {
  const customer = server.customers.find((entry) => entry.id === created.customerId);
  const site = server.sites.find((entry) => entry.id === created.siteId);
  const coordinator = server.assignable.find((entry) => entry.id === created.assigneeUserId);
  return {
    id: created.id,
    number: created.number,
    title: created.title,
    status: 'new',
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
    version: 1,
    createdAt: new Date().toISOString(),
  };
}

/** The items of W-10 for the orders created so far (newest first). */
export function createdListItems(server: OrderServer) {
  return server.created
    .map((created) => ({
      id: created.id,
      number: created.number,
      title: created.title,
      status: 'new' as const,
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
  if (idempotencyKey !== undefined) server.keys.set(idempotencyKey, rawBody);
  if (loseAnswer) return 'abort';
  return json(201, represent(server, created), { ETag: '"1"' });
}

import { paymentPlanOf, type OrderServer } from './mock-work-orders.ts';

/**
 * The part of the synthetic API that serves the section "Płatności" of W-06 (EVM-053): the instalments of a created order
 * (copied from the payment plan of its template the first time they are read — the real server copies them with the order),
 * "Dodaj transzę" (`POST`, a UUIDv7 from the panel, `Idempotency-Key`, 20 at most), "Zmień kwotę" (`PATCH` with `If-Match`, planned
 * only) and the two rules the instalments bring to the transitions of the order: no settling with an unpaid instalment
 * (`unpaid_milestones`), and cancelling the order cancels the planned ones. EVM-054: the transitions of an instalment (invoice,
 * payment, cancellation; the corrections are `403` for every role until EVM-057), the corrections of the data of the invoice and of
 * the day of the payment, and no cancelling of an order with an invoiced instalment (`invoiced_milestones`). Synthetic data only;
 * the rules of the real server are covered by the API integration tests.
 */
interface MockMilestone {
  id: string;
  code: string | null;
  name: string;
  position: number;
  sharePercent: number | null;
  paymentTermDays: number | null;
  amountMinor: number | null;
  status: 'planned' | 'invoiced' | 'paid' | 'cancelled';
  invoiceNumber: string | null;
  invoicedOn: string | null;
  dueDate: string | null;
  paidOn: string | null;
  version: number;
}

/** Today in the business zone as `YYYY-MM-DD` (the default days of the invoice and of the payment). */
const today = (): string =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const plusDays = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const inRange = (day: unknown): day is string => typeof day === 'string' && DAY.test(day) && day >= '2000-01-01' && day <= '2100-12-31';

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

const NOT_FOUND = problem(404, 'not_found');
const MAX = 20;
const AMOUNT_MAX = 99_999_999_999;

const stores = new WeakMap<OrderServer, Map<string, MockMilestone[]>>();
/** EVM-056: the day of the synthetic server frozen by a test (the reads count "after the due date" from it, never from the browser). */
const frozenDays = new WeakMap<OrderServer, string>();

/** Freezes the day of the synthetic server for the reads of the instalments (`isOverdue`, `overdueDays`). */
export function freezeServerDay(server: OrderServer, day: string): void {
  frozenDays.set(server, day);
}

const dayOf = (server: OrderServer): string => frozenDays.get(server) ?? today();
const keys = new WeakMap<OrderServer, Map<string, { readonly scope: string; readonly answer: Answer }>>();

function keysOf(server: OrderServer) {
  let found = keys.get(server);
  if (found === undefined) {
    found = new Map();
    keys.set(server, found);
  }
  return found;
}

/** The instalments of a created order; `undefined` — the order does not exist for the API (never created, or gone). */
function milestonesOf(server: OrderServer, orderId: string): MockMilestone[] | undefined {
  const created = server.created.find((entry) => entry.id === orderId);
  if (created === undefined || server.gone.has(orderId)) return undefined;
  let store = stores.get(server);
  if (store === undefined) {
    store = new Map();
    stores.set(server, store);
  }
  let items = store.get(orderId);
  if (items === undefined) {
    const template = created.templateId === null ? undefined : server.templates.find((entry) => entry.id === created.templateId);
    items = (template === undefined ? [] : paymentPlanOf(template.items.length)).map((plan, index) => ({
      id: `${orderId.slice(0, -6)}e${String(index)}0000`,
      code: plan.code,
      name: plan.name,
      position: index + 1,
      sharePercent: plan.sharePercent,
      paymentTermDays: plan.paymentTermDays,
      amountMinor: null,
      status: 'planned' as const,
      invoiceNumber: null,
      invoicedOn: null,
      dueDate: null,
      paidOn: null,
      version: 1,
    }));
    store.set(orderId, items);
  }
  return items;
}

/**
 * EVM-056: sets the instalments of a created order to the given states (in the order of the plan) — the walk through the dialogs is
 * EVM-054's; here the target is what the summary and the list say about them.
 */
export function seedMilestones(
  server: OrderServer,
  orderId: string,
  states: ReadonlyArray<Partial<Pick<MockMilestone, 'status' | 'amountMinor' | 'invoiceNumber' | 'invoicedOn' | 'dueDate' | 'paidOn'>>>,
): void {
  const items = milestonesOf(server, orderId) ?? [];
  states.forEach((state, index) => {
    const milestone = items[index];
    if (milestone !== undefined) Object.assign(milestone, state, { version: milestone.version + 1 });
  });
}

const ALLOWED: Readonly<Record<MockMilestone['status'], readonly string[]>> = {
  planned: ['invoiced', 'cancelled'],
  invoiced: ['paid'],
  paid: [],
  cancelled: [],
};

function represent(milestone: MockMilestone, role: Role = 'administrator', day = today()) {
  const overdue = milestone.status === 'invoiced' && milestone.dueDate !== null && milestone.dueDate < day;
  return {
    id: milestone.id,
    code: milestone.code,
    name: milestone.name,
    position: milestone.position,
    sharePercent: milestone.sharePercent,
    paymentTermDays: milestone.paymentTermDays,
    amount: milestone.amountMinor === null ? null : { amountMinor: milestone.amountMinor, currency: 'PLN' },
    status: milestone.status,
    invoiceNumber: milestone.invoiceNumber,
    invoicedOn: milestone.invoicedOn,
    dueDate: milestone.dueDate,
    paidOn: milestone.paidOn,
    isOverdue: overdue,
    // EVM-056: full days from the due date to the day of the server
    overdueDays: overdue && milestone.dueDate !== null ? Math.round((Date.parse(day) - Date.parse(milestone.dueDate)) / 86_400_000) : null,
    version: milestone.version,
    allowedTransitions: role === 'read_only' ? [] : ALLOWED[milestone.status],
  };
}

const sum = (items: MockMilestone[], status: MockMilestone['status']) =>
  items.filter((entry) => entry.status === status).reduce((total, entry) => total + (entry.amountMinor ?? 0), 0);

export function answerPayments(server: OrderServer, orderId: string, role: Role = 'administrator'): Answer {
  const items = milestonesOf(server, orderId);
  if (items === undefined) return NOT_FOUND;
  return json(200, {
    items: items.map((entry) => represent(entry, role, dayOf(server))),
    totals: {
      unpaid: { amountMinor: sum(items, 'invoiced'), currency: 'PLN' },
      paid: { amountMinor: sum(items, 'paid'), currency: 'PLN' },
    },
  });
}

type Role = 'administrator' | 'editor' | 'read_only';

const closed = (server: OrderServer, orderId: string): boolean => {
  const status = server.states.get(orderId)?.status ?? 'new';
  return status === 'settled' || status === 'cancelled';
};

function amountOf(raw: unknown): number | 'invalid' | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'object' || raw === null) return 'invalid';
  const { amountMinor, currency } = raw as { amountMinor?: unknown; currency?: unknown };
  if (currency !== 'PLN' || typeof amountMinor !== 'number' || !Number.isInteger(amountMinor)) return 'invalid';
  return amountMinor >= 1 && amountMinor <= AMOUNT_MAX ? amountMinor : 'invalid';
}

/** `POST …/payment-milestones`: role, `Idempotency-Key` (required; a replay is the same answer), the body, a closed order, the limit. */
export function answerPaymentCreate(
  server: OrderServer,
  orderId: string,
  input: { readonly role: Role; readonly key: string | undefined; readonly raw: string },
): Answer {
  const items = milestonesOf(server, orderId);
  if (items === undefined) return NOT_FOUND;
  if (input.role === 'read_only') return problem(403, 'forbidden');
  if (input.key === undefined)
    return problem(400, 'validation_failed', { errors: [{ pointer: '/headers/Idempotency-Key', code: 'required' }] });
  const scope = 'POST|' + orderId + '|' + input.raw;
  const replay = keysOf(server).get(input.key);
  if (replay !== undefined) {
    if (replay.scope !== scope) return problem(422, 'idempotency_mismatch');
    return { ...replay.answer, headers: { ...replay.answer.headers, 'Idempotent-Replayed': 'true' } };
  }
  const body = JSON.parse(input.raw) as { id?: string; name?: string; amount?: unknown };
  const name = (body.name ?? '').normalize('NFC').trim();
  if (name === '') return problem(400, 'validation_failed', { errors: [{ pointer: '/name', code: 'required' }] });
  if ((name.match(/./gsu) ?? []).length > 120)
    return problem(400, 'validation_failed', { errors: [{ pointer: '/name', code: 'too_long' }] });
  const amount = amountOf(body.amount);
  if (amount === 'invalid') return problem(400, 'validation_failed', { errors: [{ pointer: '/amount', code: 'invalid_value' }] });
  if (closed(server, orderId)) return problem(409, 'work_order_closed');
  if (items.length >= MAX) return problem(422, 'limit_exceeded', { errors: [{ pointer: '', code: 'too_many_payment_milestones' }] });
  const milestone: MockMilestone = {
    id: body.id ?? '',
    code: null,
    name,
    position: items.length + 1,
    sharePercent: null,
    paymentTermDays: null,
    amountMinor: amount ?? null,
    status: 'planned',
    invoiceNumber: null,
    invoicedOn: null,
    dueDate: null,
    paidOn: null,
    version: 1,
  };
  items.push(milestone);
  const answer = json(201, represent(milestone), { ETag: '"1"' });
  keysOf(server).set(input.key, { scope, answer });
  return answer;
}

/** `PATCH …/payment-milestones/{id}`: the instalment of this order (404), `If-Match` (428/400), the body, a closed order, the version, the status. */
export function answerPaymentPatch(
  server: OrderServer,
  orderId: string,
  milestoneId: string,
  input: { readonly role: Role; readonly ifMatch: string | undefined; readonly raw: string },
): Answer {
  const milestone = milestonesOf(server, orderId)?.find((entry) => entry.id === milestoneId);
  if (milestone === undefined) return NOT_FOUND;
  if (input.role === 'read_only') return problem(403, 'forbidden');
  if (input.ifMatch === undefined) return problem(428, 'precondition_required');
  const match = /^"(\d{1,9})"$/.exec(input.ifMatch);
  if (match === null) return problem(400, 'validation_failed', { errors: [{ pointer: '/headers/If-Match', code: 'invalid_format' }] });
  const body = JSON.parse(input.raw) as Record<string, unknown>;
  const amount = amountOf(body['amount']);
  if (Object.keys(body).length === 0 || amount === 'invalid') {
    return problem(400, 'validation_failed', { errors: [{ pointer: '/amount', code: 'invalid_value' }] });
  }
  const number = typeof body['invoiceNumber'] === 'string' ? body['invoiceNumber'].normalize('NFC').trim() : undefined;
  if (number === '') return problem(400, 'validation_failed', { errors: [{ pointer: '/invoiceNumber', code: 'required' }] });
  for (const field of ['invoicedOn', 'dueDate', 'paidOn']) {
    if (field in body && !inRange(body[field])) {
      return problem(400, 'validation_failed', { errors: [{ pointer: '/' + field, code: 'out_of_range' }] });
    }
  }
  if (typeof body['paidOn'] === 'string' && body['paidOn'] > today()) {
    return problem(400, 'validation_failed', { errors: [{ pointer: '/paidOn', code: 'in_future' }] });
  }
  if (closed(server, orderId)) return problem(409, 'work_order_closed');
  // the amount outside "Planowana" is a correction of the Administrator (EVM-057): 403 before the version
  if (amount !== undefined && milestone.status !== 'planned') return problem(403, 'forbidden');
  const invoiceFields = ['invoiceNumber', 'invoicedOn', 'dueDate'].some((field) => field in body);
  if ((invoiceFields && milestone.status !== 'invoiced') || ('paidOn' in body && milestone.status !== 'paid')) {
    return problem(409, 'invalid_state_transition');
  }
  if (Number(match[1]) !== milestone.version) return problem(412, 'version_conflict');
  const invoicedOn = typeof body['invoicedOn'] === 'string' ? body['invoicedOn'] : milestone.invoicedOn;
  const dueDate = typeof body['dueDate'] === 'string' ? body['dueDate'] : milestone.dueDate;
  if (invoicedOn !== null && dueDate !== null && dueDate < invoicedOn) {
    const pointer = 'dueDate' in body ? '/dueDate' : '/invoicedOn';
    return problem(400, 'validation_failed', { errors: [{ pointer, code: 'before_invoiced_on' }] });
  }
  if (amount !== undefined) milestone.amountMinor = amount;
  if (number !== undefined) milestone.invoiceNumber = number;
  milestone.invoicedOn = invoicedOn;
  milestone.dueDate = dueDate;
  if (typeof body['paidOn'] === 'string') milestone.paidOn = body['paidOn'];
  milestone.version += 1;
  return json(200, represent(milestone, input.role), { ETag: `"${String(milestone.version)}"` });
}

const CORRECTIONS: ReadonlySet<string> = new Set(['invoiced>planned', 'invoiced>cancelled', 'paid>invoiced', 'cancelled>planned']);
const EDGES: ReadonlySet<string> = new Set(['planned>invoiced', 'invoiced>paid', 'planned>cancelled']);

/**
 * `POST …/payment-milestones/{id}/transitions` (EVM-054): the instalment of this order (404), the role, `If-Match` (428/400), a closed
 * order, the table of the transitions (a correction is `403` for every role until EVM-057, another edge `409`), the version and the
 * fields of the transition (the due date of the plan by default; a day of the payment in the future — `422`).
 */
export function answerPaymentTransition(
  server: OrderServer,
  orderId: string,
  milestoneId: string,
  input: { readonly role: Role; readonly ifMatch: string | undefined; readonly key: string | undefined; readonly raw: string },
): Answer {
  const milestone = milestonesOf(server, orderId)?.find((entry) => entry.id === milestoneId);
  if (milestone === undefined) return NOT_FOUND;
  if (input.role === 'read_only') return problem(403, 'forbidden');
  if (input.ifMatch === undefined) return problem(428, 'precondition_required');
  const match = /^"(\d{1,9})"$/.exec(input.ifMatch);
  if (match === null) return problem(400, 'validation_failed', { errors: [{ pointer: '/headers/If-Match', code: 'invalid_format' }] });
  const scope = 'TRANSITION|' + milestoneId + '|' + input.raw;
  const replay = input.key === undefined ? undefined : keysOf(server).get(input.key);
  if (replay !== undefined) {
    if (replay.scope !== scope) return problem(422, 'idempotency_mismatch');
    return { ...replay.answer, headers: { ...replay.answer.headers, 'Idempotent-Replayed': 'true' } };
  }
  const body = JSON.parse(input.raw) as Record<string, unknown>;
  const to = String(body['to']);
  if (closed(server, orderId)) return problem(409, 'work_order_closed');
  const edge = milestone.status + '>' + to;
  if (CORRECTIONS.has(edge)) return problem(403, 'forbidden');
  if (!EDGES.has(edge)) return problem(409, 'invalid_state_transition');
  if (Number(match[1]) !== milestone.version) return problem(412, 'version_conflict');
  if (to === 'invoiced') {
    const amount = amountOf(body['amount']) ?? milestone.amountMinor ?? undefined;
    if (amount === undefined || amount === 'invalid') {
      return problem(400, 'validation_failed', { errors: [{ pointer: '/amount', code: 'required' }] });
    }
    const number = typeof body['invoiceNumber'] === 'string' ? body['invoiceNumber'].normalize('NFC').trim() : '';
    if (number === '') return problem(400, 'validation_failed', { errors: [{ pointer: '/invoiceNumber', code: 'required' }] });
    const invoicedOn = body['invoicedOn'] ?? today();
    if (!inRange(invoicedOn)) return problem(400, 'validation_failed', { errors: [{ pointer: '/invoicedOn', code: 'out_of_range' }] });
    const dueDate = body['dueDate'] ?? (milestone.paymentTermDays === null ? undefined : plusDays(invoicedOn, milestone.paymentTermDays));
    if (dueDate === undefined) return problem(400, 'validation_failed', { errors: [{ pointer: '/dueDate', code: 'required' }] });
    if (!inRange(dueDate)) return problem(400, 'validation_failed', { errors: [{ pointer: '/dueDate', code: 'out_of_range' }] });
    if (dueDate < invoicedOn) return problem(400, 'validation_failed', { errors: [{ pointer: '/dueDate', code: 'before_invoiced_on' }] });
    Object.assign(milestone, { amountMinor: amount, invoiceNumber: number, invoicedOn, dueDate, status: 'invoiced' });
  } else if (to === 'paid') {
    const paidOn = body['paidOn'] ?? today();
    if (!inRange(paidOn)) return problem(400, 'validation_failed', { errors: [{ pointer: '/paidOn', code: 'out_of_range' }] });
    if (paidOn > today()) return problem(422, 'transition_condition_not_met', { errors: [{ pointer: '/paidOn', code: 'in_future' }] });
    Object.assign(milestone, { paidOn, status: 'paid' });
  } else {
    const reason = typeof body['reason'] === 'string' ? body['reason'].normalize('NFC').trim() : '';
    if (reason === '') return problem(400, 'validation_failed', { errors: [{ pointer: '/reason', code: 'required' }] });
    milestone.status = 'cancelled';
  }
  milestone.version += 1;
  const answer = json(200, represent(milestone, input.role), { ETag: `"${String(milestone.version)}"` });
  if (input.key !== undefined) keysOf(server).set(input.key, { scope, answer });
  return answer;
}

/** The condition of `completed → settled` (EVM-053 AC6): every instalment is paid or cancelled — otherwise `unpaid_milestones`. */
export function paymentsCondition(server: OrderServer, orderId: string, to: string): string | undefined {
  // EVM-054 AC6: an invoiced instalment blocks cancelling the order (checked under the lock of the order on the real server)
  if (to === 'cancelled') {
    return (milestonesOf(server, orderId) ?? []).some((entry) => entry.status === 'invoiced') ? 'invoiced_milestones' : undefined;
  }
  if (to !== 'settled') return undefined;
  const unpaid = (milestonesOf(server, orderId) ?? []).some((entry) => entry.status !== 'paid' && entry.status !== 'cancelled');
  return unpaid ? 'unpaid_milestones' : undefined;
}

/** The effect of cancelling the order (EVM-053 AC6): its planned instalments become cancelled in the same step. */
export function paymentsEffect(server: OrderServer, orderId: string, to: string): void {
  if (to !== 'cancelled') return;
  for (const entry of milestonesOf(server, orderId) ?? []) {
    if (entry.status !== 'planned') continue;
    entry.status = 'cancelled';
    entry.version += 1;
  }
}

import { paymentPlanOf, type OrderServer } from './mock-work-orders.ts';

/**
 * The part of the synthetic API that serves the section "Płatności" of W-06 (EVM-053): the instalments of a created order
 * (copied from the payment plan of its template the first time they are read — the real server copies them with the order),
 * "Dodaj transzę" (`POST`, a UUIDv7 from the panel, `Idempotency-Key`, 20 at most), "Zmień kwotę" (`PATCH` with `If-Match`, planned
 * only) and the two rules the instalments bring to the transitions of the order: no settling with an unpaid instalment
 * (`unpaid_milestones`), and cancelling the order cancels the planned ones. Synthetic data only; the rules of the real server are
 * covered by the API integration tests.
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
  version: number;
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

const NOT_FOUND = problem(404, 'not_found');
const MAX = 20;
const AMOUNT_MAX = 99_999_999_999;

const stores = new WeakMap<OrderServer, Map<string, MockMilestone[]>>();
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
      version: 1,
    }));
    store.set(orderId, items);
  }
  return items;
}

function represent(milestone: MockMilestone) {
  return {
    id: milestone.id,
    code: milestone.code,
    name: milestone.name,
    position: milestone.position,
    sharePercent: milestone.sharePercent,
    paymentTermDays: milestone.paymentTermDays,
    amount: milestone.amountMinor === null ? null : { amountMinor: milestone.amountMinor, currency: 'PLN' },
    status: milestone.status,
    invoiceNumber: null,
    invoicedOn: null,
    dueDate: null,
    paidOn: null,
    isOverdue: false,
    version: milestone.version,
  };
}

const sum = (items: MockMilestone[], status: MockMilestone['status']) =>
  items.filter((entry) => entry.status === status).reduce((total, entry) => total + (entry.amountMinor ?? 0), 0);

export function answerPayments(server: OrderServer, orderId: string): Answer {
  const items = milestonesOf(server, orderId);
  if (items === undefined) return NOT_FOUND;
  return json(200, {
    items: items.map(represent),
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
  const amount = amountOf((JSON.parse(input.raw) as { amount?: unknown }).amount);
  if (amount === undefined || amount === 'invalid') {
    return problem(400, 'validation_failed', { errors: [{ pointer: '/amount', code: 'invalid_value' }] });
  }
  if (closed(server, orderId)) return problem(409, 'work_order_closed');
  if (Number(match[1]) !== milestone.version) return problem(412, 'version_conflict');
  if (milestone.status !== 'planned') return problem(403, 'forbidden');
  milestone.amountMinor = amount;
  milestone.version += 1;
  return json(200, represent(milestone), { ETag: `"${String(milestone.version)}"` });
}

/** The condition of `completed → settled` (EVM-053 AC6): every instalment is paid or cancelled — otherwise `unpaid_milestones`. */
export function paymentsCondition(server: OrderServer, orderId: string, to: string): string | undefined {
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

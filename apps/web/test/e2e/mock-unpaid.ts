/**
 * The part of the synthetic API that serves the unpaid list W-11 (EVM-055): twelve invoiced instalments in twelve orders (the figures
 * of AC3 — 12 instalments for 48 300,00 zł, 4 of them overdue for 15 200,00 zł, the longest one 21 days at ZL-2026-0031), the list
 * with the filters, the cursor and the tiles, the instalments of one of these orders (what the dialog reads on a `412`) and the
 * transition to "Opłacona". The terms are counted from the day of the machine in `Europe/Warsaw` (the clock of the browser is the same
 * one). Synthetic data only; the policy of the real server (roles, deleted orders, the cursor, the limits) is covered by the API
 * integration tests.
 */
export interface Answer {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

interface Row {
  readonly n: number;
  readonly title: string;
  readonly name: string;
  readonly amountMinor: number;
  /** The due date relative to today: negative — overdue by that many days. */
  readonly offset: number;
  readonly customer: 0 | 1;
  status: 'invoiced' | 'paid';
  version: number;
  paidOn: string | null;
}

export interface UnpaidServer {
  readonly rows: Row[];
}

const CUSTOMERS = [
  { id: '01968f3e-0000-7000-8000-00000000aaa1', displayName: 'Jan Przykładowy' },
  { id: '01968f3e-0000-7000-8000-00000000aaa2', displayName: 'Firma Testowa sp. z o.o.' },
] as const;

const ROWS: readonly Omit<Row, 'status' | 'version' | 'paidOn'>[] = [
  { n: 31, title: 'Dom — pełny pakiet', name: 'Płatność końcowa', amountMinor: 600000, offset: -21, customer: 0 },
  { n: 42, title: 'Garaż — pełny proces', name: 'Zaliczka', amountMinor: 360000, offset: -5, customer: 1 },
  { n: 44, title: 'Hala — sam montaż', name: 'Zaliczka', amountMinor: 290000, offset: -3, customer: 0 },
  { n: 45, title: 'Parking — pełny pakiet', name: 'Zaliczka', amountMinor: 270000, offset: -1, customer: 1 },
  { n: 38, title: 'Dom — pełny pakiet', name: 'Zaliczka', amountMinor: 450000, offset: 0, customer: 0 },
  { n: 39, title: 'Garaż — sam montaż', name: 'Po uzyskaniu zgód', amountMinor: 400000, offset: 1, customer: 1 },
  { n: 40, title: 'Dom — pełny proces', name: 'Zaliczka', amountMinor: 420000, offset: 3, customer: 0 },
  { n: 41, title: 'Hala — pełny pakiet', name: 'Po wykonaniu instalacji', amountMinor: 380000, offset: 7, customer: 1 },
  { n: 46, title: 'Garaż — pełny pakiet', name: 'Płatność końcowa', amountMinor: 410000, offset: 10, customer: 0 },
  { n: 47, title: 'Dom — sam montaż', name: 'Zaliczka', amountMinor: 400000, offset: 14, customer: 1 },
  { n: 48, title: 'Parking — sam montaż', name: 'Płatność końcowa', amountMinor: 430000, offset: 20, customer: 0 },
  { n: 49, title: 'Hala — pełny proces', name: 'Zaliczka', amountMinor: 420000, offset: 30, customer: 1 },
];

export const newUnpaidServer = (): UnpaidServer => ({
  rows: ROWS.map((row) => ({ ...row, status: 'invoiced', version: 3, paidOn: null })),
});

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

const zoneDay = (instant: number): string =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(instant),
  );
const plusDays = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

const orderId = (n: number): string => `01968f3e-0000-7000-8000-d${String(n).padStart(11, '0')}`;
const milestoneId = (n: number): string => `01968f3e-0000-7000-8000-e${String(n).padStart(11, '0')}`;
const numberOf = (n: number): string => `ZL-2026-${String(n).padStart(4, '0')}`;

/** The day the synthetic server counts from: today in `Europe/Warsaw` (the browser of the test runs on the same machine). */
const asOf = (): string => zoneDay(Date.now());
const dueOf = (row: Row): string => plusDays(asOf(), row.offset);

function item(row: Row) {
  const due = dueOf(row);
  const days = row.status === 'invoiced' && due < asOf() ? daysBetween(due, asOf()) : null;
  const customer = CUSTOMERS[row.customer];
  return {
    id: milestoneId(row.n),
    workOrder: { id: orderId(row.n), number: numberOf(row.n), title: `${row.title} ${String(row.n)}` },
    customer: { id: customer.id, displayName: customer.displayName },
    name: row.name,
    invoiceNumber: `FV/TEST/${String(row.n).padStart(4, '0')}/2026`,
    amount: { amountMinor: row.amountMinor, currency: 'PLN' },
    dueDate: due,
    status: row.status,
    isOverdue: days !== null,
    overdueDays: days,
    version: row.version,
  };
}

const count = (rows: readonly Row[]) => ({
  count: rows.length,
  total: { amountMinor: rows.reduce((sum, row) => sum + row.amountMinor, 0), currency: 'PLN' },
});

const ordered = (server: UnpaidServer): Row[] =>
  server.rows
    .filter((row) => row.status === 'invoiced')
    .sort((a, b) => dueOf(a).localeCompare(dueOf(b)) || milestoneId(a.n).localeCompare(milestoneId(b.n)));

export function answerUnpaidList(server: UnpaidServer, query: URLSearchParams): Answer {
  const today = asOf();
  const all = ordered(server);
  const overdue = all.filter((row) => dueOf(row) < today);
  const view = query.get('view');
  const from = query.get('dueFrom');
  const to = query.get('dueTo');
  const customer = query.get('customerId');
  const filtered = all.filter((row) => {
    const due = dueOf(row);
    return (
      (view !== 'overdue' || due < today) &&
      (from === null || due >= from) &&
      (to === null || due <= to) &&
      (customer === null || CUSTOMERS[row.customer].id === customer)
    );
  });
  const start = query.get('cursor') === null ? 0 : Number(Buffer.from(query.get('cursor') ?? '', 'base64url').toString('utf8'));
  const limit = Number(query.get('limit') ?? '25');
  const nextCursor = start + limit < filtered.length ? Buffer.from(String(start + limit)).toString('base64url') : null;
  const first = overdue[0];
  return json(
    200,
    {
      items: filtered.slice(start, start + limit).map((row) => item(row)),
      nextCursor,
      asOf: today,
      summary: {
        unpaid: count(all),
        overdue: count(overdue),
        longestOverdue:
          first === undefined
            ? null
            : { days: daysBetween(dueOf(first), today), workOrder: { id: orderId(first.n), number: numberOf(first.n) } },
        filtered: count(filtered),
      },
    },
    { 'Cache-Control': 'no-store' },
  );
}

const rowOfOrder = (server: UnpaidServer, id: string): Row | undefined => server.rows.find((row) => orderId(row.n) === id);

export const isUnpaidOrder = (server: UnpaidServer, id: string): boolean => rowOfOrder(server, id) !== undefined;

function full(row: Row) {
  const due = dueOf(row);
  return {
    id: milestoneId(row.n),
    code: 'plan_1',
    name: row.name,
    position: 1,
    sharePercent: null,
    paymentTermDays: null,
    amount: { amountMinor: row.amountMinor, currency: 'PLN' },
    status: row.status,
    invoiceNumber: `FV/TEST/${String(row.n).padStart(4, '0')}/2026`,
    invoicedOn: plusDays(due, -7),
    dueDate: due,
    paidOn: row.paidOn,
    isOverdue: row.status === 'invoiced' && due < asOf(),
    version: row.version,
    allowedTransitions: row.status === 'invoiced' ? ['paid'] : [],
  };
}

/** `GET /work-orders/{id}/payment-milestones` of one of the twelve orders: its one instalment and the totals. */
export function answerUnpaidOrderPayments(server: UnpaidServer, id: string): Answer {
  const row = rowOfOrder(server, id);
  if (row === undefined) return problem(404, 'not_found');
  return json(200, {
    items: [full(row)],
    totals: {
      unpaid: { amountMinor: row.status === 'invoiced' ? row.amountMinor : 0, currency: 'PLN' },
      paid: { amountMinor: row.status === 'paid' ? row.amountMinor : 0, currency: 'PLN' },
    },
  });
}

/** `POST …/transitions` to "paid": the version in `If-Match` must be the current one (`412` otherwise); a day in the future is `422`. */
export function answerUnpaidTransition(
  server: UnpaidServer,
  id: string,
  mid: string,
  input: { readonly role: 'administrator' | 'editor' | 'read_only'; readonly ifMatch: string | undefined; readonly raw: string },
): Answer {
  const row = rowOfOrder(server, id);
  if (row === undefined || milestoneId(row.n) !== mid) return problem(404, 'not_found');
  if (input.role === 'read_only') return problem(403, 'forbidden');
  if (input.ifMatch === undefined) return problem(428, 'precondition_required');
  if (input.ifMatch !== `"${String(row.version)}"`) return problem(412, 'version_conflict');
  const body = JSON.parse(input.raw) as { to?: string; paidOn?: string };
  if (row.status !== 'invoiced' || body.to !== 'paid') return problem(409, 'invalid_state_transition');
  const paidOn = body.paidOn ?? asOf();
  if (paidOn > asOf()) return problem(422, 'transition_condition_not_met', { errors: [{ pointer: '/paidOn', code: 'in_future' }] });
  row.status = 'paid';
  row.paidOn = paidOn;
  row.version += 1;
  return json(200, full(row), { ETag: `"${String(row.version)}"` });
}

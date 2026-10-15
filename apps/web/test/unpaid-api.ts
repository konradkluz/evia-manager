import type { CurrentSession, PaymentMilestone, UnpaidPaymentMilestone, UnpaidPaymentMilestoneList } from '@evia/contracts';
import { ACTIVE_SESSION, json, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi } from './render.tsx';

/**
 * Synthetic data of W-11 (EVM-055): the clock of the server is 2026-10-03 (`Europe/Warsaw`), the invoices are of the synthetic series
 * FV/TEST/… (no real data). The figures of the tiles come from AC3 (12 instalments, 4 of them overdue), not from the mockup, whose two
 * rows contradict each other (12.09 / 21 days and 08.09 / 5 days).
 */
export const UNPAID_PATH = '/payments';
export const UNPAID_LIST = 'GET /api/v1/payment-milestones';
export const SEARCH = 'POST /api/v1/customers/search';

export const roleSession = (role: 'editor' | 'read_only'): CurrentSession => ({
  ...ACTIVE_SESSION,
  user: { ...ACTIVE_SESSION.user, role },
});

const ANNA = { id: '01968f3e-0000-7000-8000-00000000a001', displayName: 'Anna Testowa' };
const JAN = { id: '01968f3e-0000-7000-8000-00000000a002', displayName: 'Jan Przykładowy' };
export const CUSTOMERS = { ANNA, JAN };

const id = (kind: string, n: number): string => `01968f3e-0000-7000-8000-${kind}${String(n).padStart(12 - kind.length, '0')}`;

export const unpaid = (n: number, extra: Partial<UnpaidPaymentMilestone> = {}): UnpaidPaymentMilestone => ({
  id: id('b', n),
  workOrder: { id: id('c', n), number: `ZL-2026-${String(n).padStart(4, '0')}`, title: `Dom — pełny pakiet ${String(n)}` },
  customer: ANNA,
  name: 'Zaliczka',
  invoiceNumber: `FV/TEST/${String(n).padStart(4, '0')}/2026`,
  amount: { amountMinor: 360000, currency: 'PLN' },
  dueDate: '2026-10-15',
  status: 'invoiced',
  isOverdue: false,
  overdueDays: null,
  version: 3,
  ...extra,
});

/** AC2: due 2026-09-28 (5 days after the term at 2026-10-03) and due 2026-10-03 (the day itself — not overdue: the rule is `<`). */
export const OVERDUE = unpaid(31, {
  name: 'Płatność końcowa',
  dueDate: '2026-09-28',
  isOverdue: true,
  overdueDays: 5,
  amount: { amountMinor: 600000, currency: 'PLN' },
});
export const TODAY = unpaid(38, {
  name: 'Zaliczka',
  dueDate: '2026-10-03',
  customer: CUSTOMERS.JAN,
  amount: { amountMinor: 450000, currency: 'PLN' },
});

/** AC3: "Nieopłacone: 12 transz · 48 300,00 zł", "Po terminie: 4 · 15 200,00 zł", "Najdłużej po terminie: 21 dni · ZL-2026-0031". */
export const SUMMARY = {
  unpaid: { count: 12, total: { amountMinor: 4830000, currency: 'PLN' } },
  overdue: { count: 4, total: { amountMinor: 1520000, currency: 'PLN' } },
  longestOverdue: { days: 21, workOrder: { id: id('c', 31), number: 'ZL-2026-0031' } },
  filtered: { count: 12, total: { amountMinor: 4830000, currency: 'PLN' } },
} as const;

export const pageOf = (
  items: UnpaidPaymentMilestone[],
  { nextCursor = null, summary = {} }: { nextCursor?: string | null; summary?: Partial<UnpaidPaymentMilestoneList['summary']> } = {},
): UnpaidPaymentMilestoneList => ({ items, nextCursor, asOf: '2026-10-03', summary: { ...SUMMARY, ...summary } });

export const TWO = pageOf([OVERDUE, TODAY], { summary: { filtered: { count: 2, total: { amountMinor: 1050000, currency: 'PLN' } } } });

/** The whole instalment of a row, as `GET /work-orders/{id}/payment-milestones` has it (the row lacks the date of the invoice). */
export const fullOf = (row: UnpaidPaymentMilestone, extra: Partial<PaymentMilestone> = {}): PaymentMilestone => ({
  id: row.id,
  code: 'plan_1',
  name: row.name,
  position: 1,
  sharePercent: null,
  paymentTermDays: null,
  amount: row.amount,
  status: row.status,
  invoiceNumber: row.invoiceNumber,
  invoicedOn: '2026-09-21',
  dueDate: row.dueDate,
  paidOn: null,
  isOverdue: row.isOverdue,
  version: row.version,
  allowedTransitions: ['paid'],
  ...extra,
});

export const orderPayments = (row: UnpaidPaymentMilestone): string => `/api/v1/work-orders/${row.workOrder.id}/payment-milestones`;
export const transitionOf = (row: UnpaidPaymentMilestone): string => `POST ${orderPayments(row)}/${row.id}/transitions`;

/** The panel with an active session (the role of the session as given) and the unpaid list `list`. */
export function unpaidApi(
  list: Handler = () => json(200, TWO),
  session: CurrentSession = ACTIVE_SESSION,
  extra: Record<string, Handler> = {},
) {
  return activeSessionApi({ [SESSION_ROUTE]: () => json(200, session), [UNPAID_LIST]: list, ...extra });
}

export const lastQuery = (api: ReturnType<typeof unpaidApi>): URLSearchParams =>
  api.calls(UNPAID_LIST).at(-1)?.query ?? new URLSearchParams();

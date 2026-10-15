import type { CurrentSession, PaymentMilestone, PaymentMilestoneList, WorkOrderDetails } from '@evia/contracts';
import { ACTIVE_SESSION, json, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi } from './render.tsx';
import { HEADER, ORDER_ID, workOrderRoutes } from './work-order-api.ts';

/**
 * Synthetic instalments of the order ZL-2026-0042 for the actions of EVM-054 (invoice, payment, cancellation, the corrections of the
 * data): one instalment in each status. The invoice numbers are of the synthetic series FV/TEST/… (no real data).
 */
export const PAYMENTS_PATH = `/work-orders/${ORDER_ID}`;
export const PAYMENTS_BASE = `/api/v1/work-orders/${ORDER_ID}/payment-milestones`;
export const PAYMENTS_LIST = `GET ${PAYMENTS_BASE}`;
export const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const roleSession = (role: 'editor' | 'read_only'): CurrentSession => ({
  ...ACTIVE_SESSION,
  user: { ...ACTIVE_SESSION.user, role },
});

export const milestone = (n: number, extra: Partial<PaymentMilestone> = {}): PaymentMilestone => ({
  id: `01968f3e-0000-7000-8000-0000000c1${String(n).padStart(3, '0')}`,
  code: `plan_${String(n)}`,
  name: `Transza ${String(n)}`,
  position: n,
  sharePercent: null,
  paymentTermDays: null,
  amount: null,
  status: 'planned',
  invoiceNumber: null,
  invoicedOn: null,
  dueDate: null,
  paidOn: null,
  isOverdue: false,
  version: 1,
  allowedTransitions: [],
  ...extra,
});

/** "Zaliczka (20%)" — planned, 1 230,00 zł, 7 days of the plan (AC1). */
export const PLANNED = milestone(1, {
  name: 'Zaliczka',
  sharePercent: 20,
  paymentTermDays: 7,
  amount: { amountMinor: 123000, currency: 'PLN' },
  version: 2,
  allowedTransitions: ['invoiced', 'cancelled'],
});
/** "Po uzyskaniu zgód (30%)" — invoiced FV/TEST/0021/2026, due 10.10.2026 (AC2, AC4). */
export const INVOICED = milestone(2, {
  name: 'Po uzyskaniu zgód',
  sharePercent: 30,
  paymentTermDays: 7,
  amount: { amountMinor: 123000, currency: 'PLN' },
  status: 'invoiced',
  invoiceNumber: 'FV/TEST/0021/2026',
  invoicedOn: '2026-10-03',
  dueDate: '2026-10-10',
  version: 3,
  allowedTransitions: ['paid'],
});
/** "Po wykonaniu instalacji (30%)" — paid on 01.10.2026 (AC4). */
export const PAID = milestone(3, {
  name: 'Po wykonaniu instalacji',
  sharePercent: 30,
  paymentTermDays: 7,
  amount: { amountMinor: 540000, currency: 'PLN' },
  status: 'paid',
  invoiceNumber: 'FV/TEST/0008/2026',
  invoicedOn: '2026-09-20',
  dueDate: '2026-09-27',
  paidOn: '2026-10-01',
  version: 4,
});
/** "Płatność końcowa (20%)" — cancelled. */
export const CANCELLED = milestone(4, { name: 'Płatność końcowa', sharePercent: 20, status: 'cancelled', version: 2 });

export const paymentsOf = (items: PaymentMilestone[]): PaymentMilestoneList => ({
  items,
  totals: {
    unpaid: {
      amountMinor: items.filter((entry) => entry.status === 'invoiced').reduce((sum, entry) => sum + (entry.amount?.amountMinor ?? 0), 0),
      currency: 'PLN',
    },
    paid: {
      amountMinor: items.filter((entry) => entry.status === 'paid').reduce((sum, entry) => sum + (entry.amount?.amountMinor ?? 0), 0),
      currency: 'PLN',
    },
  },
});

export const ALL = paymentsOf([PLANNED, INVOICED, PAID, CANCELLED]);

export const transitionRoute = (entry: PaymentMilestone): string => `POST ${PAYMENTS_BASE}/${entry.id}/transitions`;
export const patchRoute = (entry: PaymentMilestone): string => `PATCH ${PAYMENTS_BASE}/${entry.id}`;

/** The panel of W-06 with the instalments of `payments()` (read anew on every request) and the extra routes of a test. */
export function paymentsApi(
  payments: () => PaymentMilestoneList = () => ALL,
  session: CurrentSession = ACTIVE_SESSION,
  extra: Record<string, Handler> = {},
  header: Partial<WorkOrderDetails> = {},
) {
  return activeSessionApi({
    [SESSION_ROUTE]: () => json(200, session),
    ...workOrderRoutes(ORDER_ID, {
      payments: () => json(200, payments()),
      header: () => json(200, { ...HEADER, ...header }, { ETag: '"3"' }),
    }),
    ...extra,
  });
}

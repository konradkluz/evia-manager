/**
 * The signals of payments on the list of work orders (EVM-056; ADR-0017 D6–D9, W3, W4) as PURE functions of the projection and of the
 * day of the page: the state of the column "Płatność" (D8), the payment views (D6, D7) and the group and the key of "Najpilniejsze"
 * (D9). Nothing here is stored — "overdue" depends on the day (`today`, `YYYY-MM-DD` in `Europe/Warsaw`, from the injected clock or
 * `asOf` of the cursor; never the database clock). The SQL of the reader computes the same rules in the query; {@link urgencyOf} is
 * their documentation and the oracle the tests compare the order of the database with.
 *
 * W4: the payment views, the payment component of "Najpilniejsze" and the field `payment` need the right to read payments
 * (`canReadPayments` of `authorization`; v1: every role). Without it "Najpilniejsze" is computed from the stages only.
 */
import {
  CLOSED_STATUSES,
  WAITING_WARNING_DAYS,
  dayNumber,
  type Urgency,
  type WorkOrderSort,
  type WorkOrderStatus,
  type WorkOrderView,
} from './work-order-list-query.ts';

/** The views of payments (D6 "Po terminie", D7 "Nieopłacone") — only for a caller who may read payments (W4). */
export const PAYMENT_VIEWS: readonly WorkOrderView[] = ['overdue_payments', 'unpaid'];
/** The sorts whose order depends on payments; without the right they are computed without them, never refused (W4, D9). */
export const PAYMENT_SORTS: readonly WorkOrderSort[] = ['urgency'];
/**
 * The fields of an item of the list that only a caller who may read payments gets (W4). A declaration checked by a test against
 * `restrictedParams.fields` of the contract — it does not drive the hiding: `WorkOrderPageService` omits `payment` when it has no totals
 * (`withPayments` false). A new field in `restrictedParams.fields` therefore needs a change of that hiding as well.
 */
export const PAYMENT_FIELDS = ['payment'] as const;

/** The signals of payments the projection keeps for an order (ADR-0017 → "Model projekcji"; no amount, W1). */
export interface PaymentSignals {
  readonly invoicedCount: number;
  readonly paidCount: number;
  /** `YYYY-MM-DD` — the earliest due date of the `invoiced` milestones; `null` exactly when `invoicedCount` is 0 */
  readonly earliestInvoicedDueDate: string | null;
}

export type PaymentState = 'overdue' | 'unpaid' | 'paid' | 'none';

/** D8: the first state that holds — an invoiced milestone past its due date, an invoiced one, a paid one, nothing. */
export function paymentStateOf(signals: PaymentSignals, today: string): PaymentState {
  if (signals.earliestInvoicedDueDate !== null && signals.earliestInvoicedDueDate < today) return 'overdue';
  if (signals.invoicedCount > 0) return 'unpaid';
  if (signals.paidCount > 0) return 'paid';
  return 'none';
}

/** What "Najpilniejsze" reads of a row of the projection. */
export interface UrgencyInput {
  readonly status: WorkOrderStatus;
  readonly earliestInvoicedDueDate: string | null;
  readonly nextDueDate: string | null;
  readonly longestWaitingSince: string | null;
}

const before = (day: string | null, today: string): day is string => day !== null && day < today;

/**
 * D9: 1) open with a milestone or a stage past its due date — the oldest such date; 2) open and waiting for more than 14 days — the
 * day the longest wait began; 3) open with a stage due from today on — that day; 4) the others, the closed ones too — `infinity`.
 * @param withPayments false for a caller who may not read payments (W4): group 1 then comes from the stages only
 */
export function urgencyOf(row: UrgencyInput, today: string, withPayments: boolean): Urgency {
  if (CLOSED_STATUSES.includes(row.status)) return { group: 4, day: 'infinity' };
  const overdue = [withPayments ? row.earliestInvoicedDueDate : null, row.nextDueDate].filter((day) => before(day, today));
  if (overdue.length > 0) return { group: 1, day: overdue.reduce((least, day) => (day < least ? day : least)) };
  const since = row.longestWaitingSince;
  if (since !== null && dayNumber(today) - dayNumber(since) > WAITING_WARNING_DAYS) return { group: 2, day: since };
  if (row.nextDueDate !== null) return { group: 3, day: row.nextDueDate };
  return { group: 4, day: 'infinity' };
}

/** The order of "Najpilniejsze" in memory: the group, the day (`infinity` last), the id — the order the query must give. */
export function compareUrgency(a: Urgency & { readonly id: string }, b: Urgency & { readonly id: string }): number {
  if (a.group !== b.group) return a.group - b.group;
  if (a.day !== b.day) return a.day === 'infinity' ? 1 : b.day === 'infinity' || a.day < b.day ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

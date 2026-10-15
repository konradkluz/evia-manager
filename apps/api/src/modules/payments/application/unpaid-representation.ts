/**
 * The answer of the summary of unpaid invoices (EVM-055; SR-DATA-03): pure functions from the rows of the reader and the lookups of
 * the other modules to the shape of the contract — only the fields of the contract, no reason of a cancellation, no author, no whole
 * entity. A row whose order the facade of `work-orders` did not show to the caller is DROPPED (never guessed, never shown without its
 * number); the caller counts the drop (ADR-0017 W2: it cannot happen on one snapshot, the policy is already in the query).
 */
import type { UnpaidPaymentMilestone, UnpaidPaymentMilestoneList } from '@evia/contracts';
import type { WorkOrderListRef } from '../../work-orders/index.ts';
import { overdueDaysOf } from '../domain/unpaid-query.ts';
import { CURRENCY } from '../domain/money.ts';
import type { LongestOverdueRow, UnpaidRow, UnpaidSummaryRow } from '../infrastructure/unpaid-reader.ts';

type Summary = UnpaidPaymentMilestoneList['summary'];

/**
 * `null` — the order has no customer; `{deleted: true}` — it has one the caller may not see (deleted): no identifier and no name, so
 * the summary neither names nor links a deleted customer (TM-18, W-10 "Klient usunięty").
 */
export function customerOf(customerId: string | null, names: ReadonlyMap<string, string>): UnpaidPaymentMilestone['customer'] {
  if (customerId === null) return null;
  const displayName = names.get(customerId);
  return displayName === undefined ? { deleted: true } : { id: customerId, displayName };
}

export function toUnpaidItems(
  rows: readonly UnpaidRow[],
  refs: ReadonlyMap<string, WorkOrderListRef>,
  customerNames: ReadonlyMap<string, string>,
  asOf: string,
): { readonly items: UnpaidPaymentMilestone[]; readonly dropped: number } {
  const items: UnpaidPaymentMilestone[] = [];
  for (const row of rows) {
    const ref = refs.get(row.workOrderId);
    if (ref === undefined || row.invoiceNumber === null || row.amountMinor === null) continue;
    const overdueDays = overdueDaysOf(row.dueDate, asOf);
    items.push({
      id: row.id,
      workOrder: { id: row.workOrderId, number: ref.number, title: ref.title },
      customer: customerOf(ref.customerId, customerNames),
      name: row.name,
      invoiceNumber: row.invoiceNumber,
      amount: { amountMinor: row.amountMinor, currency: CURRENCY },
      dueDate: row.dueDate,
      status: 'invoiced',
      isOverdue: overdueDays !== null,
      overdueDays,
      version: row.version,
    });
  }
  return { items, dropped: rows.length - items.length };
}

const countOf = (value: { readonly count: number; readonly totalMinor: number }): Summary['unpaid'] => ({
  count: value.count,
  total: { amountMinor: value.totalMinor, currency: CURRENCY },
});

export function toSummary(
  summary: UnpaidSummaryRow,
  longest: LongestOverdueRow | undefined,
  refs: ReadonlyMap<string, WorkOrderListRef>,
  asOf: string,
): Summary {
  const ref = longest === undefined ? undefined : refs.get(longest.workOrderId);
  const days = longest === undefined ? null : overdueDaysOf(longest.dueDate, asOf);
  return {
    unpaid: countOf(summary.unpaid),
    overdue: countOf(summary.overdue),
    longestOverdue:
      longest === undefined || ref === undefined || days === null
        ? null
        : { days, workOrder: { id: longest.workOrderId, number: ref.number } },
    filtered: countOf(summary.filtered),
  };
}

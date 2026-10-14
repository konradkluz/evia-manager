/**
 * A row of a milestone as the contract shows it (EVM-053 AC2; `PaymentMilestone`): the amount as `Money` (grosze, PLN) or `null`, the
 * flag `isOverdue` computed by the server (an invoiced milestone whose due date is before today in `Europe/Warsaw` — the client never
 * compares dates), the transitions the role of the caller may take now (`allowedTransitions`, EVM-054 — computed in memory from the
 * one table, no query), the list with its totals. The answer is parsed with the schema of the contract (a value outside it is a
 * `500`, never a leak). The reason of a cancellation is not a column of the row: it never leaves the database.
 */
import { zPaymentMilestone, zPaymentMilestoneList } from '@evia/contracts/zod';
import type { PaymentMilestone, PaymentMilestoneList } from '@evia/contracts';
import { ProblemException } from '../../../platform/http/problem.ts';
import type { UserRole } from '@evia/contracts';
import { allowedMilestoneTransitions } from '../domain/milestone-transitions.ts';
import { milestoneTotals, toMoney } from '../domain/money.ts';
import type { MilestoneRow } from '../infrastructure/milestone-reader.ts';

/** Who reads the milestone, for `allowedTransitions`: the role of the caller and whether the order is closed (PO-8). */
export interface MilestoneAudience {
  readonly role: UserRole;
  readonly orderClosed: boolean;
}

function present(row: MilestoneRow, today: string, audience: MilestoneAudience): PaymentMilestone {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    position: row.position,
    sharePercent: row.sharePercent,
    paymentTermDays: row.paymentTermDays,
    amount: toMoney(row.amountMinor),
    status: row.status,
    invoiceNumber: row.invoiceNumber,
    invoicedOn: row.invoicedOn,
    dueDate: row.dueDate,
    paidOn: row.paidOn,
    isOverdue: row.status === 'invoiced' && row.dueDate !== null && row.dueDate < today,
    version: row.version,
    allowedTransitions: allowedMilestoneTransitions(row.status, audience.role, audience.orderClosed),
  };
}

function checked<T>(schema: { safeParse(value: unknown): { success: boolean; data?: unknown } }, value: T): T {
  if (!schema.safeParse(value).success) throw new ProblemException('internal_error');
  return value;
}

/** @param today the business day `YYYY-MM-DD` in `Europe/Warsaw` */
export const toPaymentMilestone = (row: MilestoneRow, today: string, audience: MilestoneAudience): PaymentMilestone =>
  checked(zPaymentMilestone, present(row, today, audience));

/** @param today the business day `YYYY-MM-DD` in `Europe/Warsaw` */
export const toPaymentMilestoneList = (rows: readonly MilestoneRow[], today: string, audience: MilestoneAudience): PaymentMilestoneList =>
  checked(zPaymentMilestoneList, { items: rows.map((row) => present(row, today, audience)), totals: milestoneTotals(rows) });

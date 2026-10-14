/**
 * The change of a milestone without a change of its status (EVM-053 AC3, EVM-054 AC4; decisions Q3a, Q3b, Q3d, Q3e; SR-AUTHZ-10,
 * SR-INPUT-01, SR-INPUT-02). Pure functions of data — the service calls them in the order of the contract:
 *   1. {@link normalizeDetailsPatch} on the body alone (`400`): at least one field; the invoice number is plain text (1–60); the days
 *      are within 2000-01-01…2100-12-31;
 *   2. {@link statusDecision} on the LOCKED milestone: an amount on a milestone that is not `planned` is `403 forbidden`, also together
 *      with other fields (a correction of the Administrator, EVM-057) — before a field that does not belong to the status, which is
 *      `409 invalid_state_transition` (the invoice only in `invoiced`, the day of the payment only in `paid`);
 *   3. {@link mergedIssues} on the state AFTER the change (the stored values with the request over them): the due date is not
 *      before the day of the invoice (the pointer is `/invoicedOn` when the request changes the day of the invoice only, else
 *      `/dueDate` — a change of the day does NOT move the due date), the day of a payment is not after today (`in_future`).
 * Errors carry a pointer and a code, never a value.
 */
import { Collector, type FieldIssue } from '../../../platform/input/field-issues.ts';
import { mayChangeAmount } from './milestone-rules.ts';
import { inDateRange, normalizeInvoiceNumber } from './milestone-transitions.ts';
import type { Money, PaymentMilestoneStatus } from './money.ts';

export interface DetailsPatchInput {
  readonly amount?: Money | undefined;
  readonly invoiceNumber?: string | undefined;
  readonly invoicedOn?: string | undefined;
  readonly dueDate?: string | undefined;
  readonly paidOn?: string | undefined;
}

export interface DetailsPatch {
  readonly amountMinor?: number;
  readonly invoiceNumber?: string;
  readonly invoicedOn?: string;
  readonly dueDate?: string;
  readonly paidOn?: string;
}

export type DetailsPatchResult =
  { readonly ok: true; readonly patch: DetailsPatch } | { readonly ok: false; readonly errors: FieldIssue[] };

const DATE_KEYS = ['invoicedOn', 'dueDate', 'paidOn'] as const;

export function normalizeDetailsPatch(input: DetailsPatchInput): DetailsPatchResult {
  const issues = new Collector();
  const named = Object.keys(input).filter((key) => input[key as keyof DetailsPatchInput] !== undefined);
  if (named.length === 0) issues.fail('', 'required');
  let invoiceNumber: string | null = null;
  if (input.invoiceNumber !== undefined) invoiceNumber = normalizeInvoiceNumber(issues, '/invoiceNumber', input.invoiceNumber);
  for (const key of DATE_KEYS) {
    const day = input[key];
    if (day !== undefined && !inDateRange(day)) issues.fail(`/${key}`, 'out_of_range');
  }
  if (issues.errors.length > 0) return { ok: false, errors: issues.errors };
  return {
    ok: true,
    patch: {
      ...(input.amount === undefined ? {} : { amountMinor: input.amount.amountMinor }),
      ...(invoiceNumber === null ? {} : { invoiceNumber }),
      ...(input.invoicedOn === undefined ? {} : { invoicedOn: input.invoicedOn }),
      ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
      ...(input.paidOn === undefined ? {} : { paidOn: input.paidOn }),
    },
  };
}

/** The status each field of the patch belongs to (Q3d; the amount — EVM-053). */
const STATUS_OF: Record<keyof DetailsPatch, PaymentMilestoneStatus> = {
  amountMinor: 'planned',
  invoiceNumber: 'invoiced',
  invoicedOn: 'invoiced',
  dueDate: 'invoiced',
  paidOn: 'paid',
};

/** `forbidden` before `invalid_state_transition` before `ok` (step 2 of the order above). */
export function statusDecision(status: PaymentMilestoneStatus, patch: DetailsPatch): 'ok' | 'forbidden' | 'invalid_state_transition' {
  if (patch.amountMinor !== undefined && !mayChangeAmount(status)) return 'forbidden';
  const keys = Object.keys(patch) as (keyof DetailsPatch)[];
  return keys.every((key) => STATUS_OF[key] === status) ? 'ok' : 'invalid_state_transition';
}

/** What the milestone holds now (the values a patch is merged with). */
export interface StoredDetails {
  readonly amountMinor: number | null;
  readonly invoiceNumber: string | null;
  readonly invoicedOn: string | null;
  readonly dueDate: string | null;
  readonly paidOn: string | null;
}

/**
 * The rules on the state after the change (step 3). @param today the current day in `Europe/Warsaw`
 */
export function mergedIssues(stored: StoredDetails, patch: DetailsPatch, today: string): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const invoicedOn = patch.invoicedOn ?? stored.invoicedOn;
  const dueDate = patch.dueDate ?? stored.dueDate;
  if (invoicedOn !== null && dueDate !== null && dueDate < invoicedOn) {
    const onlyTheDay = patch.invoicedOn !== undefined && patch.dueDate === undefined;
    issues.push({ pointer: onlyTheDay ? '/invoicedOn' : '/dueDate', code: 'before_invoiced_on' });
  }
  if (patch.paidOn !== undefined && patch.paidOn > today) issues.push({ pointer: '/paidOn', code: 'in_future' });
  return issues;
}

/** The fields of the patch whose value differs from the stored one (none — a change without effect: `200`, no version, no event). */
export function changedDetails(stored: StoredDetails, patch: DetailsPatch): DetailsPatch {
  const keys = (Object.keys(patch) as (keyof DetailsPatch)[]).filter((key) => stored[key] !== patch[key]);
  return Object.fromEntries(keys.map((key) => [key, patch[key]]));
}

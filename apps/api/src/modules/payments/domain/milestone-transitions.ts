/**
 * The table of transitions of a payment milestone (EVM-054 AC1–AC3, AC5, AC7; domain-model.md → "Stany i przejścia" → "Etap
 * płatności"; SR-API-07, SR-AUTHZ-10): the ONE place that says which status may follow which, who may take the move and what it
 * writes. Pure functions of data — no database, no framework, no clock of its own ("today" is passed in). A move that is not a row here
 * does not exist (`409 invalid_state_transition`); the status is changed only through a row.
 *
 * The corrections of a payment (withdraw or cancel an invoice, undo a payment, restore a milestone — EVM-057; threat T7, AB-17) are
 * rows of the Administrator ALONE with a step-up (`stepUp`): the role before the step-up ({@link correctionAccess} — P2: the Editor
 * `403 forbidden`, the Administrator without a passkey in the last 15 minutes `403 step_up_required`). A correction takes the target
 * alone ({@link correctionFields}); no other row leads back to `planned` from `invoiced` or `cancelled`, to `invoiced` from `paid` or to
 * `cancelled` from `invoiced` (SR-AUTHZ-10 — a test of the table pins it).
 */
import type { UserRole } from '@evia/contracts';
import { Collector, type FieldIssue } from '../../../platform/input/field-issues.ts';
import type { Money, PaymentMilestoneStatus } from './money.ts';

export const INVOICE_NUMBER_MAX_LENGTH = 60;
export const CANCEL_REASON_MAX_LENGTH = 500;
/** The days of an invoice, a due date and a payment (decision Q3a; the higiene of SR-INPUT-01 for the others). */
export const DATE_MIN = '2000-01-01';
export const DATE_MAX = '2100-12-31';

export type MilestoneMove = 'invoice' | 'pay' | 'cancel' | 'correction';

export interface MilestoneTransitionRule {
  readonly from: PaymentMilestoneStatus;
  readonly to: PaymentMilestoneStatus;
  readonly move: MilestoneMove;
  /** The roles that may take the move; the Administrator alone for a correction (EVM-057). */
  readonly roles: readonly UserRole[];
  /** True for a correction: the move asks for an authentication with a passkey in the last 15 minutes (SR-SESS-08). */
  readonly stepUp: boolean;
  /** The action of the audit trail, after `payment_milestone.` (a correction has one of its own — EVM-057). */
  readonly action: MilestoneAuditAction;
}

export type MilestoneAuditAction =
  'invoiced' | 'paid' | 'cancelled' | 'invoice_withdrawn' | 'invoice_cancelled' | 'payment_undone' | 'restored';

const BOTH: readonly UserRole[] = ['administrator', 'editor'];
const ADMINISTRATOR: readonly UserRole[] = ['administrator'];

/** The order of the rows is the order of the actions of a row of W-06 / W-11: the way forward first, then the cancellation, then the corrections. */
const TRANSITION_ROWS = [
  { from: 'planned', to: 'invoiced', move: 'invoice', roles: BOTH, stepUp: false, action: 'invoiced' },
  { from: 'invoiced', to: 'paid', move: 'pay', roles: BOTH, stepUp: false, action: 'paid' },
  { from: 'planned', to: 'cancelled', move: 'cancel', roles: BOTH, stepUp: false, action: 'cancelled' },
  { from: 'invoiced', to: 'planned', move: 'correction', roles: ADMINISTRATOR, stepUp: true, action: 'invoice_withdrawn' },
  { from: 'invoiced', to: 'cancelled', move: 'correction', roles: ADMINISTRATOR, stepUp: true, action: 'invoice_cancelled' },
  { from: 'paid', to: 'invoiced', move: 'correction', roles: ADMINISTRATOR, stepUp: true, action: 'payment_undone' },
  { from: 'cancelled', to: 'planned', move: 'correction', roles: ADMINISTRATOR, stepUp: true, action: 'restored' },
] as const satisfies readonly MilestoneTransitionRule[];
export const MILESTONE_TRANSITION_TABLE: readonly MilestoneTransitionRule[] = Object.freeze(TRANSITION_ROWS);

/** `from>to` of every row of the table that is a correction: a new row without an entry in {@link CORRECTION_UPDATES} does not compile. */
type CorrectionKeyOf<Row> = Row extends { readonly from: infer From extends string; readonly to: infer To extends string }
  ? `${From}>${To}`
  : never;
type CorrectionKey = CorrectionKeyOf<Extract<(typeof TRANSITION_ROWS)[number], { readonly move: 'correction' }>>;

/** The row for the move, or `undefined` when the table has none (never a role decision: see {@link mayTake}). */
export const findMilestoneTransition = (from: PaymentMilestoneStatus, to: PaymentMilestoneStatus): MilestoneTransitionRule | undefined =>
  MILESTONE_TRANSITION_TABLE.find((rule) => rule.from === from && rule.to === to);

export const mayTake = (rule: MilestoneTransitionRule, role: UserRole): boolean => rule.roles.includes(role);

/** The access of a caller to a correction of a payment (a move of the table or the amount of an invoiced or paid milestone). */
export type CorrectionAccess = 'ok' | 'forbidden' | 'step_up_required';

/**
 * The one policy of a correction of a payment (EVM-057; P2; SR-SESS-08, SR-AUTHZ-10): the role BEFORE the step-up — a role that may
 * not correct never learns that a step-up would be asked for.
 * @param stepUpFresh whether the session authenticated with a passkey in the last 15 minutes (`stepUpFresh` of `identity`)
 */
export const correctionAccess = (role: UserRole, stepUpFresh: boolean): CorrectionAccess =>
  role !== 'administrator' ? 'forbidden' : stepUpFresh ? 'ok' : 'step_up_required';

/**
 * The targets the role may choose now (`allowedTransitions` of the representation — a hint for the panel; the server decides again).
 * A closed order has none (its payments are read-only, PO-8). The Administrator is offered the corrections whatever the freshness of
 * the step-up (the command asks for it, EVM-057).
 */
export const allowedMilestoneTransitions = (
  status: PaymentMilestoneStatus,
  role: UserRole,
  orderClosed: boolean,
): PaymentMilestoneStatus[] =>
  orderClosed ? [] : MILESTONE_TRANSITION_TABLE.filter((rule) => rule.from === status && mayTake(rule, role)).map((rule) => rule.to);

/** The command after the schema of the contract. */
export interface MilestoneTransitionCommand {
  readonly to: PaymentMilestoneStatus;
  readonly amount?: Money | undefined;
  readonly invoiceNumber?: string | undefined;
  readonly invoicedOn?: string | undefined;
  readonly dueDate?: string | undefined;
  readonly paidOn?: string | undefined;
  readonly reason?: string | undefined;
}

/** What the milestone holds that the fields of a move depend on. */
export interface MilestoneFacts {
  readonly amountMinor: number | null;
  readonly paymentTermDays: number | null;
}

/** The columns a move writes; `undefined` keeps the column as it is, `null` clears it (a correction, EVM-057). */
export interface MilestoneMoveUpdate {
  readonly status: PaymentMilestoneStatus;
  readonly amountMinor?: number;
  readonly invoiceNumber?: string | null;
  readonly invoicedOn?: string | null;
  readonly dueDate?: string | null;
  readonly paidOn?: string | null;
  readonly statusReason?: string | null;
}

export type MoveFieldsResult =
  | { readonly ok: true; readonly update: MilestoneMoveUpdate }
  | { readonly ok: false; readonly status: 400 | 422; readonly errors: readonly FieldIssue[] };

const FIELD_KEYS = ['amount', 'invoiceNumber', 'invoicedOn', 'dueDate', 'paidOn', 'reason'] as const;
type FieldKey = (typeof FIELD_KEYS)[number];
const FIELDS_OF: Record<Exclude<MilestoneMove, 'correction'>, readonly FieldKey[]> = {
  invoice: ['amount', 'invoiceNumber', 'invoicedOn', 'dueDate'],
  pay: ['paidOn'],
  cancel: ['reason'],
};

const CLEARED_INVOICE = { invoiceNumber: null, invoicedOn: null, dueDate: null } as const;

/**
 * What each correction writes (domain-model.md → "Etap płatności"; the CHECKs of 0028 hold the result): withdrawing an invoice clears
 * the invoice (the amount stays); cancelling one keeps the invoice (the number stays known to the office) and takes no reason;
 * undoing a payment clears its day; restoring a cancelled milestone clears whatever it held besides the amount — the invoice of a
 * cancelled invoice included, so its number remains outside the system only.
 */
const CORRECTION_UPDATES: Readonly<Record<CorrectionKey, MilestoneMoveUpdate>> = {
  'invoiced>planned': { status: 'planned', ...CLEARED_INVOICE },
  'invoiced>cancelled': { status: 'cancelled' },
  'paid>invoiced': { status: 'invoiced', paidOn: null },
  'cancelled>planned': { status: 'planned', ...CLEARED_INVOICE, paidOn: null, statusReason: null },
};

/**
 * The columns of a correction (EVM-057 AC1, AC2, AC4; SR-API-07, CWE-915): the command names the target alone — every other field is
 * `400 not_allowed` with its pointer (never its value), the reason of `invoiced → cancelled` included.
 */
export function correctionFields(rule: MilestoneTransitionRule, command: MilestoneTransitionCommand): MoveFieldsResult {
  const update = (CORRECTION_UPDATES as Readonly<Record<string, MilestoneMoveUpdate | undefined>>)[`${rule.from}>${rule.to}`];
  if (update === undefined) throw new Error(`${rule.from}>${rule.to} is not a correction`);
  const errors: FieldIssue[] = FIELD_KEYS.filter((key) => command[key] !== undefined).map((key) => ({
    pointer: `/${key}`,
    code: 'not_allowed',
  }));
  return errors.length > 0 ? { ok: false, status: 400, errors } : { ok: true, update };
}

/** A day `YYYY-MM-DD` plus a number of days (calendar arithmetic in UTC — the day carries no zone). */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The default due date: the day of the invoice plus the days of the plan; `null` when the milestone has no days (added by hand, Q3c). */
export const defaultDueDate = (invoicedOn: string, paymentTermDays: number | null): string | null =>
  paymentTermDays === null ? null : addDays(invoicedOn, paymentTermDays);

export const inDateRange = (day: string): boolean => day >= DATE_MIN && day <= DATE_MAX;

/** The plain text of an invoice number (NFC, trimmed, no control or invisible formatting character, 1–60 characters). */
export const normalizeInvoiceNumber = (issues: Collector, pointer: string, raw: string | undefined): string | null =>
  issues.required(pointer, raw, { maxLength: INVOICE_NUMBER_MAX_LENGTH });

/**
 * The fields of a move of A or E, after the row and the role are decided (a correction never gets here). Errors carry a pointer and a
 * code, NEVER the value — the invoice number and the reason are free text that may name a person:
 * - a field the move does not take — `400 not_allowed`;
 * - "Wystaw fakturę…": the amount of the request or the one entered before (`required` without both), the invoice number (`required`,
 *   `too_long`, `invalid_characters`), the day of the invoice (today by default; 2000–2100, may be in the future — `out_of_range`), the
 *   due date (by default the day plus the days of the plan, computed HERE, on the server; `required` without days; `out_of_range`;
 *   `before_invoiced_on`);
 * - "Odnotuj wpłatę…": the day of the payment (today by default; from 2000 — `out_of_range`, `400`; after today — `422`
 *   `transition_condition_not_met`, `in_future`, decision Q3e);
 * - "Anuluj transzę…": the reason (`required`, 1–500).
 *
 * @param today the current day in `Europe/Warsaw` (`YYYY-MM-DD`)
 */
export function moveFields(
  move: Exclude<MilestoneMove, 'correction'>,
  command: MilestoneTransitionCommand,
  facts: MilestoneFacts,
  today: string,
): MoveFieldsResult {
  const issues = new Collector();
  for (const key of FIELD_KEYS) if (command[key] !== undefined && !FIELDS_OF[move].includes(key)) issues.fail(`/${key}`, 'not_allowed');
  if (issues.errors.length > 0) return { ok: false, status: 400, errors: issues.errors };

  switch (move) {
    case 'invoice':
      return invoiceFields(issues, command, facts, today);
    case 'pay': {
      const paidOn = command.paidOn ?? today;
      if (paidOn < DATE_MIN) return { ok: false, status: 400, errors: [{ pointer: '/paidOn', code: 'out_of_range' }] };
      if (paidOn > today) return { ok: false, status: 422, errors: [{ pointer: '/paidOn', code: 'in_future' }] };
      return { ok: true, update: { status: 'paid', paidOn } };
    }
    case 'cancel': {
      const reason = issues.required('/reason', command.reason, { maxLength: CANCEL_REASON_MAX_LENGTH });
      if (reason === null) return { ok: false, status: 400, errors: issues.errors };
      return { ok: true, update: { status: 'cancelled', statusReason: reason } };
    }
  }
}

function invoiceFields(issues: Collector, command: MilestoneTransitionCommand, facts: MilestoneFacts, today: string): MoveFieldsResult {
  const amountMinor = command.amount?.amountMinor ?? facts.amountMinor;
  if (amountMinor === null) issues.fail('/amount', 'required');
  const invoiceNumber = normalizeInvoiceNumber(issues, '/invoiceNumber', command.invoiceNumber);
  const invoicedOn = command.invoicedOn ?? today;
  const invoicedOnValid = inDateRange(invoicedOn);
  if (!invoicedOnValid) issues.fail('/invoicedOn', 'out_of_range');
  const dueDate = command.dueDate ?? (invoicedOnValid ? defaultDueDate(invoicedOn, facts.paymentTermDays) : null);
  if (dueDate === null) {
    if (invoicedOnValid) issues.fail('/dueDate', 'required');
  } else if (!inDateRange(dueDate)) issues.fail('/dueDate', 'out_of_range');
  else if (invoicedOnValid && dueDate < invoicedOn) issues.fail('/dueDate', 'before_invoiced_on');
  if (issues.errors.length > 0 || amountMinor === null || invoiceNumber === null || dueDate === null)
    return { ok: false, status: 400, errors: issues.errors };
  return { ok: true, update: { status: 'invoiced', amountMinor, invoiceNumber, invoicedOn, dueDate } };
}

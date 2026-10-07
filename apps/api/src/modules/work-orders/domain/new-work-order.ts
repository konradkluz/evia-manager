/**
 * A new work order (EVM-022 AC1–AC3; SR-INPUT-01, SR-INPUT-02, SR-INPUT-05, SR-AUTHZ-04): the rules the schema of the contract
 * cannot state — plain text (NFC, trimmed, no control characters), the range of the planned date, and the default title. The
 * result is either the normalised order or the list of field errors: a JSON Pointer and a code, NEVER the value (SR-ERR-02). The
 * client names no number, status or scope item: those come from the server (the schema is strict, `read_only_field`).
 */
import { Collector, type FieldIssue } from '../../../platform/input/field-issues.ts';

/** The title of an order made without a template when the user left the field empty. */
export const DEFAULT_WORK_ORDER_TITLE = 'Nowe zlecenie';

/** The planned date is a business day, not a typo of the year (SR-INPUT-02); both bounds are inclusive. */
export const PLANNED_DATE_MIN = '2000-01-01';
export const PLANNED_DATE_MAX = '2100-12-31';

/** The input after the schema of the contract (types and bounds are checked; the rules below are not). */
export interface WorkOrderInput {
  readonly id: string;
  readonly customerId: string;
  readonly siteId: string;
  readonly templateId: string | null;
  readonly title?: string | undefined;
  readonly assigneeUserId?: string | undefined;
  readonly plannedDate?: string | undefined;
  readonly description?: string | undefined;
}

export interface NewWorkOrder {
  readonly id: string;
  readonly customerId: string;
  readonly siteId: string;
  /** `null` — an empty order. */
  readonly templateId: string | null;
  /** `null` — the default (the name of the template, or {@link DEFAULT_WORK_ORDER_TITLE}). */
  readonly title: string | null;
  /** `null` — the signed-in user. */
  readonly assigneeUserId: string | null;
  readonly plannedDate: string | null;
  readonly description: string | null;
}

export type NewWorkOrderResult =
  { readonly ok: true; readonly order: NewWorkOrder } | { readonly ok: false; readonly errors: readonly FieldIssue[] };

export function normalizeNewWorkOrder(input: WorkOrderInput): NewWorkOrderResult {
  const issues = new Collector();
  const title = issues.text('/title', input.title, { maxLength: 200 });
  const description = issues.text('/description', input.description, { maxLength: 2000, multiline: true });
  const plannedDate = input.plannedDate ?? null;
  if (plannedDate !== null && (plannedDate < PLANNED_DATE_MIN || plannedDate > PLANNED_DATE_MAX)) {
    issues.fail('/plannedDate', 'out_of_range');
  }
  if (issues.errors.length > 0) return { ok: false, errors: issues.errors };
  return {
    ok: true,
    order: {
      id: input.id,
      customerId: input.customerId,
      siteId: input.siteId,
      templateId: input.templateId,
      title,
      assigneeUserId: input.assigneeUserId ?? null,
      plannedDate,
      description,
    },
  };
}

/** The title the user typed, else the name of the template, else the default. */
export const resolveTitle = (title: string | null, templateName: string | null): string =>
  title ?? templateName ?? DEFAULT_WORK_ORDER_TITLE;

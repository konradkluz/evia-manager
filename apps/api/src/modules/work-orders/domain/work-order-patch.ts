/**
 * The change of the data of a work order (EVM-035 AC1, AC7; SR-INPUT-01, SR-INPUT-02, SR-INPUT-05, SR-AUTHZ-04): the rules the
 * schema of the contract cannot state — at least one field is named, plain text (NFC, trimmed, no control characters), the title is
 * never empty, and the planned date is a business day, not a typo of the year. The result is either the patch or the list of field
 * errors: a JSON Pointer and a code, NEVER the value (SR-ERR-02). The status, the number, the customer and the site are never here:
 * the status is the command of EVM-030, the others are the server's (`read_only_field`).
 */
import { Collector, type FieldIssue } from '../../../platform/input/field-issues.ts';
import { PLANNED_DATE_MAX, PLANNED_DATE_MIN } from './new-work-order.ts';

/** The names of the fields of an order whose change the journal records (the values are NOT recorded). */
export const WORK_ORDER_FIELDS = ['title', 'description', 'plannedDate', 'coordinator'] as const;
export type WorkOrderField = (typeof WORK_ORDER_FIELDS)[number];

/** The patch after the schema of the contract: a key that is absent stays as it is, `null` clears the value. */
export interface WorkOrderPatchInput {
  readonly title?: string | undefined;
  readonly description?: string | null | undefined;
  readonly plannedDate?: string | null | undefined;
  readonly assigneeUserId?: string | undefined;
}

/** The normalised patch: an absent key is untouched, `null` clears (`description`, `plannedDate`). */
export interface WorkOrderPatch {
  readonly title?: string;
  readonly description?: string | null;
  readonly plannedDate?: string | null;
  readonly assigneeUserId?: string;
}

export type WorkOrderPatchResult =
  { readonly ok: true; readonly patch: WorkOrderPatch } | { readonly ok: false; readonly errors: readonly FieldIssue[] };

export const TITLE_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 2000;

export function normalizeWorkOrderPatch(input: WorkOrderPatchInput): WorkOrderPatchResult {
  const issues = new Collector();
  const named = (['title', 'description', 'plannedDate', 'assigneeUserId'] as const).filter((key) => input[key] !== undefined);
  if (named.length === 0) issues.fail('', 'required');

  const title = input.title === undefined ? undefined : issues.required('/title', input.title, { maxLength: TITLE_MAX_LENGTH });
  // an empty text clears the description, like `null` (the column holds 1–2000 characters or NULL)
  const description =
    input.description === undefined || input.description === null
      ? input.description
      : issues.text('/description', input.description, { maxLength: DESCRIPTION_MAX_LENGTH, multiline: true });
  const { plannedDate } = input;
  if (typeof plannedDate === 'string' && (plannedDate < PLANNED_DATE_MIN || plannedDate > PLANNED_DATE_MAX)) {
    issues.fail('/plannedDate', 'out_of_range');
  }
  if (issues.errors.length > 0) return { ok: false, errors: issues.errors };
  return {
    ok: true,
    patch: {
      ...(title === undefined || title === null ? {} : { title }),
      ...(description === undefined ? {} : { description }),
      ...(plannedDate === undefined ? {} : { plannedDate }),
      ...(input.assigneeUserId === undefined ? {} : { assigneeUserId: input.assigneeUserId }),
    },
  };
}

/** The values of an order that a patch may change, as they are in the locked rows. */
export interface WorkOrderCurrent {
  readonly title: string;
  readonly description: string | null;
  readonly plannedDate: string | null;
  readonly coordinatorUserId: string | null;
}

/**
 * What a patch REALLY changes, compared with the locked rows (EVM-035 AC7: the journal names the fields that changed; a patch that
 * changes nothing writes no event and does not raise the version).
 */
export function changedFieldsOf(patch: WorkOrderPatch, current: WorkOrderCurrent): WorkOrderField[] {
  const changed: WorkOrderField[] = [];
  if (patch.title !== undefined && patch.title !== current.title) changed.push('title');
  if (patch.description !== undefined && patch.description !== current.description) changed.push('description');
  if (patch.plannedDate !== undefined && patch.plannedDate !== current.plannedDate) changed.push('plannedDate');
  if (patch.assigneeUserId !== undefined && patch.assigneeUserId !== current.coordinatorUserId) changed.push('coordinator');
  return changed;
}

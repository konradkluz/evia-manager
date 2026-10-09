/**
 * The change of a stage (EVM-031 AC3; SR-INPUT-01, SR-INPUT-02, SR-AUTHZ-04): the rules the schema of the contract cannot state —
 * at least one field is named, and the due date is a business day, not a typo of the year. The result is either the patch or the
 * list of field errors (a JSON Pointer and a code, NEVER the value — SR-ERR-02). Only the person responsible and the due date can
 * change here; the status of a stage is the command of EVM-032.
 */
import { Collector, type FieldIssue } from '../../../platform/input/field-issues.ts';

/** The due date is a business day; both bounds are inclusive (the same bounds as the planned date of an order and the CHECK of the table). */
export const DUE_DATE_MIN = '2000-01-01';
export const DUE_DATE_MAX = '2100-12-31';

/** The patch after the schema of the contract: a key that is absent stays as it is, `null` clears the value. */
export interface StagePatchInput {
  readonly responsibleUserId?: string | null | undefined;
  readonly dueDate?: string | null | undefined;
}

export interface StagePatch {
  readonly responsibleUserId?: string | null;
  readonly dueDate?: string | null;
}

export type StagePatchResult =
  { readonly ok: true; readonly patch: StagePatch } | { readonly ok: false; readonly errors: readonly FieldIssue[] };

export function normalizeStagePatch(input: StagePatchInput): StagePatchResult {
  const issues = new Collector();
  const named = (['responsibleUserId', 'dueDate'] as const).filter((key) => input[key] !== undefined);
  if (named.length === 0) issues.fail('', 'required');
  const { dueDate } = input;
  if (typeof dueDate === 'string' && (dueDate < DUE_DATE_MIN || dueDate > DUE_DATE_MAX)) issues.fail('/dueDate', 'out_of_range');
  if (issues.errors.length > 0) return { ok: false, errors: issues.errors };
  return {
    ok: true,
    patch: {
      ...(input.responsibleUserId === undefined ? {} : { responsibleUserId: input.responsibleUserId }),
      ...(dueDate === undefined ? {} : { dueDate }),
    },
  };
}

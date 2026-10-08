/**
 * The fields of a transition command that the row of the table decides (EVM-030 AC2, AC3; SR-INPUT-01, SR-INPUT-02, SR-DATA-01,
 * SR-ERR-02): the reason (`statusReason`, plain text, 1..500 after NFC and trimming — REQUIRED where the row asks for it and
 * refused where it does not) and the day of completion (`completedOn`, only where the row sets it; default today in
 * `Europe/Warsaw`, not before 2000 and not in the future). The shape of the body (`to` from the closed list, the length bound,
 * no other key) is the schema of the contract; this is what the schema cannot state because it depends on the row.
 *
 * An error is a JSON Pointer and a code — `required`, `too_long`, `invalid_characters`, `not_allowed`, `out_of_range` — NEVER the
 * value: the reason is free text that may name a person (it reaches neither a log nor the audit trail nor an answer).
 */
import { Collector, type FieldIssue } from '../../../platform/input/field-issues.ts';
import type { ResolvedTransition, TransitionFields } from './work-order-transitions.ts';

export const REASON_MAX_LENGTH = 500;

/** Both bounds are inclusive; the upper one is today. */
export const COMPLETED_ON_MIN = '2000-01-01';

/** The body after the schema of the contract. */
export interface TransitionBody {
  readonly to: string;
  readonly reason?: string | undefined;
  readonly completedOn?: string | undefined;
}

export type TransitionFieldsResult =
  { readonly ok: true; readonly fields: TransitionFields } | { readonly ok: false; readonly errors: readonly FieldIssue[] };

/** @param today the current day in `Europe/Warsaw` (`YYYY-MM-DD`) */
export function normalizeTransitionFields(body: TransitionBody, { rule }: ResolvedTransition, today: string): TransitionFieldsResult {
  const issues = new Collector();

  let reason: string | null = null;
  if (rule.reason) reason = issues.required('/reason', body.reason, { maxLength: REASON_MAX_LENGTH });
  else if (body.reason !== undefined) issues.fail('/reason', 'not_allowed');

  let completedOn: string | null = null;
  if (rule.completedOn === 'set') {
    completedOn = body.completedOn ?? today;
    if (completedOn < COMPLETED_ON_MIN || completedOn > today) issues.fail('/completedOn', 'out_of_range');
  } else if (body.completedOn !== undefined) issues.fail('/completedOn', 'not_allowed');

  if (issues.errors.length > 0) return { ok: false, errors: issues.errors };
  return { ok: true, fields: { reason, completedOn } };
}

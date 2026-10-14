import { ApiError } from '../api/client.ts';
import { classifyEdit, type EditFailure } from './edit-failure.ts';

/** The limits of the contract (EVM-042 AC4): 30 active processes in an order, 30 active stages in a process. */
export const PROCEDURES_MAX = 30;
export const STAGES_MAX = 30;
/** The name of a manual stage: 1..120 characters of plain text. */
export const STAGE_NAME_MAX = 120;

export const etagOf = (version: number): string => `"${String(version)}"`;

/** The controls the server refuses in the name of a stage (the same set as in the free text of the scope). */
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
export const normalizeStageName = (text: string): string => text.normalize('NFC').trim();
export const hasControlCharacters = (text: string): boolean => CONTROL_CHARACTERS.test(text);

/**
 * Why an operation on a process or a stage did not go through (EVM-042 AC1, AC3, AC4, AC6, AC7). The answers carry no values:
 * `412` is "changed in the meantime" (the typed data stays), `404` is one answer for a gone object and the object of another order,
 * `409 procedure_already_active` and `409 parent_deleted` say what blocked an add or a restore, `422 limit_exceeded` names the limit.
 */
export type ManageFailure =
  EditFailure | { readonly kind: 'active' | 'parentDeleted' | 'tooManyProcedures' | 'tooManyStages' | 'templateUnavailable' };

export function classifyManage(error: unknown): ManageFailure {
  if (error instanceof ApiError) {
    if (error.status === 409 && error.code === 'procedure_already_active') return { kind: 'active' };
    if (error.status === 409 && error.code === 'parent_deleted') return { kind: 'parentDeleted' };
    if (error.status === 422 && error.code === 'template_unavailable') return { kind: 'templateUnavailable' };
    if (error.status === 422 && error.code === 'limit_exceeded') {
      return { kind: error.errors.some((entry) => entry.code === 'too_many_stages') ? 'tooManyStages' : 'tooManyProcedures' };
    }
    if (error.status === 409 && error.code === 'invalid_state_transition') return { kind: 'conflict' };
    if (error.status === 400) return { kind: 'invalid' };
  }
  // `classifyEdit` does not know `proceduresLimit` of this story: it is handled above, the rest is the shared mapping.
  const shared = classifyEdit(error);
  return shared.kind === 'limit' || shared.kind === 'proceduresLimit' ? { kind: 'invalid' } : shared;
}

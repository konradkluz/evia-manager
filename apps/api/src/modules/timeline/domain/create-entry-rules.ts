/**
 * The rules of a new entry that the schema of the contract does not say (EVM-037 AC1, AC2; SR-INPUT-01, SR-INPUT-05): a note has a
 * category, a comment has none, and the text is normalised once (`entry-body.ts`). Errors are a pointer and a code — never a value
 * (the text may name a person, SR-ERR-02). Pure; no database.
 */
import type { FieldError } from '../../../platform/http/problem.ts';
import type { NoteCategory } from '../infrastructure/tables.ts';
import { normalizeEntryBody } from './entry-body.ts';

/** The body of the request as the schema of the contract left it. */
export interface CreateEntryInput {
  readonly id: string;
  readonly kind: 'note' | 'comment';
  readonly noteCategory?: NoteCategory | undefined;
  readonly body: string;
  readonly procedureStageId?: string | null | undefined;
  readonly supersedesEntryId?: string | undefined;
}

export interface CreateEntryCommand {
  readonly id: string;
  readonly kind: 'note' | 'comment';
  readonly noteCategory: NoteCategory | null;
  readonly body: string;
  /** `undefined`: not said (a correction keeps the stage of the entry it corrects); `null`: no stage. */
  readonly procedureStageId: string | null | undefined;
  readonly supersedesEntryId: string | null;
}

export type CreateEntryResult =
  { readonly ok: true; readonly command: CreateEntryCommand } | { readonly ok: false; readonly errors: FieldError[] };

export function resolveCreateEntry(input: CreateEntryInput): CreateEntryResult {
  const errors: FieldError[] = [];
  if (input.kind === 'note' && input.noteCategory === undefined) errors.push({ pointer: '/noteCategory', code: 'required' });
  if (input.kind === 'comment' && input.noteCategory !== undefined) errors.push({ pointer: '/noteCategory', code: 'not_allowed' });
  const body = normalizeEntryBody(input.body);
  if (!body.ok) errors.push({ pointer: '/body', code: body.code });
  if (errors.length > 0 || !body.ok) return { ok: false, errors };
  return {
    ok: true,
    command: {
      id: input.id,
      kind: input.kind,
      noteCategory: input.noteCategory ?? null,
      body: body.value,
      procedureStageId: input.procedureStageId,
      supersedesEntryId: input.supersedesEntryId ?? null,
    },
  };
}

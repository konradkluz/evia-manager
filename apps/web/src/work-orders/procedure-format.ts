import type { ProcedureStage, ProcedureStagePatch } from '@evia/contracts';
import type { StageStatusKey } from '@evia/ui-web';

/** The range of the due date that the API accepts (`out_of_range` otherwise). */
export const DUE_DATE_MIN = '2000-01-01';
export const DUE_DATE_MAX = '2100-12-31';

const STAGE_KEYS: Readonly<Record<string, StageStatusKey>> = {
  todo: 'todo',
  in_progress: 'in-progress',
  waiting: 'waiting',
  done: 'done',
  not_applicable: 'not-applicable',
  blocked: 'blocked',
};

/** The token key of a stage status (styleguide § 4.4); `undefined` for a status this panel does not know (P-12). */
export const stageStatusKey = (status: string): StageStatusKey | undefined =>
  Object.hasOwn(STAGE_KEYS, status) ? STAGE_KEYS[status] : undefined;

/** `2026-10-02` → `02.10.2026`: a calendar day of the business zone is formatted as text, never through a time zone (§ 6.3). */
export function formatDueDate(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return match === null ? day : `${match[3] ?? ''}.${match[2] ?? ''}.${match[1] ?? ''}`;
}

/** What the person typed into the dialog of a stage: the id of the person ('' is "Brak") and the day ('' is none). */
export interface StageEdit {
  readonly responsibleUserId: string;
  readonly dueDate: string;
}

export const stageEditOf = (stage: Pick<ProcedureStage, 'responsibleUser' | 'dueDate'>): StageEdit => ({
  responsibleUserId: stage.responsibleUser?.id ?? '',
  dueDate: stage.dueDate ?? '',
});

/** The merge-patch of the fields that changed (`null` clears); empty when nothing changed — then nothing is sent. */
export function buildStagePatch(initial: StageEdit, current: StageEdit): ProcedureStagePatch {
  return {
    ...(current.responsibleUserId === initial.responsibleUserId ? {} : { responsibleUserId: current.responsibleUserId || null }),
    ...(current.dueDate === initial.dueDate ? {} : { dueDate: current.dueDate || null }),
  };
}

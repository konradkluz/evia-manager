/**
 * The rules of the stages of a work order that need no framework (EVM-031 AC2, AC3, AC4; domain-model.md → `StageStatus`,
 * `Procedure`): which stages are open, what the progress of a process is, and when a stage is overdue. Every date is a calendar day
 * in the business zone `Europe/Warsaw` written as `YYYY-MM-DD`, so two days compare as text (D8); "today" is passed in, never read
 * here (the clock is injected, ADR-0014).
 */

/** The limits of the API (api-guidelines.md → "Limity obiektów podrzędnych"): processes per order and stages per process. */
export const MAX_PROCEDURES_PER_ORDER = 30;
export const MAX_STAGES_PER_PROCEDURE = 30;

export const STAGE_STATUSES = ['todo', 'in_progress', 'waiting', 'blocked', 'done', 'not_applicable'] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

/** "Open" in the glossary: the work is not finished and not blocked — `todo`, `in_progress`, `waiting`. */
const OPEN_STATUSES: readonly StageStatus[] = ['todo', 'in_progress', 'waiting'];
/** Finished, or not to be done at all: nothing is left to be late with. */
const FINISHED_STATUSES: readonly StageStatus[] = ['done', 'not_applicable'];

export const isOpenStage = (status: StageStatus): boolean => OPEN_STATUSES.includes(status);

/**
 * The stage is late: its due date is before today (`Europe/Warsaw`) and it is not finished. A blocked stage counts — it is not done,
 * and a block does not move the date. A stage without a due date is never late; a due date of today is not late yet.
 */
export const isOverdue = (stage: { readonly status: StageStatus; readonly dueDate: string | null }, today: string): boolean =>
  stage.dueDate !== null && stage.dueDate < today && !FINISHED_STATUSES.includes(stage.status);

export interface Progress {
  readonly done: number;
  readonly total: number;
}

/**
 * "n of m stages" (styleguide § 3.23, confirmed by the owner 2026-10-04): n — the stages `done`, m — the stages WITHOUT
 * `not_applicable` (such a stage is not a part of the work, so it never stops a process from being complete).
 */
export function progressOf(stages: readonly { readonly status: StageStatus }[]): Progress {
  const counted = stages.filter((stage) => stage.status !== 'not_applicable');
  return { done: counted.filter((stage) => stage.status === 'done').length, total: counted.length };
}

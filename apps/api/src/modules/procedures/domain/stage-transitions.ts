/**
 * The table of transitions of a stage (EVM-032 AC1, AC4, AC5, AC6, AC7; domain-model.md → "Stany i przejścia" → "Etap procesu";
 * SR-API-07, SR-AUTHZ-05, SR-AUTHZ-10): the ONE place that says which status may follow which and what the move does to the fields.
 * Pure functions of data — no database, no framework, no clock of its own ("today" and "now" are passed in). A move that is not a
 * row here does not exist (`409 invalid_state_transition`); the status is changed only through a row.
 *
 * The invariant of the fields that every row keeps (the CHECKs of the table repeat the first two as the last line of defence):
 * "waiting for" is set exactly in `waiting`, the reason of a block exactly in `blocked`, the day of completion exactly in `done`.
 * So a row that leaves a status clears what belongs to it, and a row that enters one sets it. "Cofnij" in the panel is an ordinary
 * move with parameters the user could give by hand (the previous "waiting for", reason, day) — there is no restoring of fields.
 */
import type { UserRole } from '@evia/contracts';
import { Collector, type FieldIssue } from '../../../platform/input/field-issues.ts';
import type { StageStatus } from './stage-rules.ts';
import { normalizeWaiting, type Waiting, type WaitingOn } from './waiting.ts';

export const BLOCKED_REASON_MAX_LENGTH = 500;
/** The day of completion is not before this day (the same lower bound as the due date). */
export const COMPLETED_ON_MIN = '2000-01-01';

export interface StageTransitionRule {
  readonly from: StageStatus;
  readonly to: StageStatus;
  readonly roles: readonly UserRole[];
}

const BOTH: readonly UserRole[] = ['administrator', 'editor'];
const row = (from: StageStatus, to: StageStatus): StageTransitionRule => ({ from, to, roles: BOTH });

const OPEN: readonly StageStatus[] = ['todo', 'in_progress', 'waiting'];

/** The order of the rows is the order of the menu of the badge: the way forward first, then "done", "not applicable" and the block. */
export const STAGE_TRANSITION_TABLE: readonly StageTransitionRule[] = Object.freeze([
  row('todo', 'in_progress'),
  row('todo', 'waiting'),
  row('in_progress', 'waiting'),
  row('waiting', 'in_progress'),
  ...OPEN.map((from) => row(from, 'done')),
  ...OPEN.map((from) => row(from, 'not_applicable')),
  ...OPEN.map((from) => row(from, 'blocked')),
  row('blocked', 'in_progress'),
  row('done', 'in_progress'),
  row('not_applicable', 'todo'),
]);

/** The row for the move, or `undefined` when the table has none (never a role decision: see `mayUse`). */
export const findStageTransition = (from: StageStatus, to: StageStatus): StageTransitionRule | undefined =>
  STAGE_TRANSITION_TABLE.find((candidate) => candidate.from === from && candidate.to === to);

export const mayUse = (rule: StageTransitionRule, role: UserRole): boolean => rule.roles.includes(role);

/** The targets the role may choose from `from` (the menu of the badge, AC1; a hint for the UI — the server decides again). */
export const allowedStageTransitions = (from: StageStatus, role: UserRole): StageStatus[] =>
  STAGE_TRANSITION_TABLE.filter((candidate) => candidate.from === from && mayUse(candidate, role)).map((candidate) => candidate.to);

/** The command after the schema of the contract. */
export interface StageTransitionCommand {
  readonly to: StageStatus;
  readonly waitingOn?: WaitingOn | undefined;
  readonly waitingOnPartyId?: string | undefined;
  readonly waitingSince?: string | undefined;
  readonly blockedReason?: string | undefined;
  readonly completedOn?: string | undefined;
}

/** What the target takes: only the fields of `to` are allowed; the others are `not_allowed`. */
export interface TransitionFields {
  readonly waiting: Waiting | null;
  /** Normalised reason; `null` where the target takes none. */
  readonly blockedReason: string | null;
  readonly completedOn: string | null;
}

export type TransitionFieldsResult =
  { readonly ok: true; readonly fields: TransitionFields } | { readonly ok: false; readonly errors: readonly FieldIssue[] };

const WAITING_KEYS = ['waitingOn', 'waitingOnPartyId', 'waitingSince'] as const;

/**
 * The fields the target decides — they do not depend on the status the stage is in now, so this runs on the command alone, before
 * the stage is compared with the table. The reason of a block is free text that may name a person: errors carry a pointer and a code
 * (`required`, `too_long`, `invalid_characters`, `not_allowed`, `out_of_range`), NEVER the value.
 *
 * @param today the current day in `Europe/Warsaw` (`YYYY-MM-DD`)
 */
export function normalizeTransitionFields(command: StageTransitionCommand, today: string): TransitionFieldsResult {
  const issues = new Collector();

  let waiting: Waiting | null = null;
  if (command.to === 'waiting') {
    const result = normalizeWaiting(command, today);
    if (result.ok) waiting = result.waiting;
    else issues.errors.push(...result.errors);
  } else {
    for (const key of WAITING_KEYS) if (command[key] !== undefined) issues.fail(`/${key}`, 'not_allowed');
  }

  let blockedReason: string | null = null;
  if (command.to === 'blocked')
    blockedReason = issues.required('/blockedReason', command.blockedReason, { maxLength: BLOCKED_REASON_MAX_LENGTH });
  else if (command.blockedReason !== undefined) issues.fail('/blockedReason', 'not_allowed');

  let completedOn: string | null = null;
  if (command.to === 'done') {
    completedOn = command.completedOn ?? today;
    if (completedOn < COMPLETED_ON_MIN || completedOn > today) issues.fail('/completedOn', 'out_of_range');
  } else if (command.completedOn !== undefined) issues.fail('/completedOn', 'not_allowed');

  if (issues.errors.length > 0) return { ok: false, errors: issues.errors };
  return { ok: true, fields: { waiting, blockedReason, completedOn } };
}

/** The columns the move writes (`startedAt` only where it is set: absent keeps the value). */
export interface StageUpdate {
  readonly status: StageStatus;
  readonly waitingOn: WaitingOn | null;
  readonly waitingOnPartyId: string | null;
  readonly waitingSince: string | null;
  readonly blockedReason: string | null;
  readonly completedOn: string | null;
  readonly startedAt?: Date;
}

/** The stage after the row: the status of the target, the fields that belong to it set, every other field cleared. */
export function applyStageTransition({ from, to }: StageTransitionRule, fields: TransitionFields, now: Date): StageUpdate {
  return {
    status: to,
    waitingOn: fields.waiting?.waitingOn ?? null,
    waitingOnPartyId: fields.waiting?.waitingOnPartyId ?? null,
    waitingSince: fields.waiting?.waitingSince ?? null,
    blockedReason: fields.blockedReason,
    completedOn: fields.completedOn,
    ...(from === 'todo' && to === 'in_progress' ? { startedAt: now } : {}),
  };
}

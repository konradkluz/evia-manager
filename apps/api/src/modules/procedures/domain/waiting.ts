/**
 * "Czekamy na…" of a stage (EVM-032 AC2, AC3; domain-model.md → `ProcedureStage`; SR-INPUT-01, SR-INPUT-02, SR-ERR-02): the ONE
 * place that states who is waited for and since when. It is used by the transition into `waiting` (POST) AND by the change of the
 * party in `waiting` (PATCH), so the rule exists once. The CHECKs of the table are the last line of defence, not the rule.
 *
 * `customer` takes no party; `party` needs one. "Since" is a day in `Europe/Warsaw`: by default today, never in the future (a
 * counter of days that started tomorrow means nothing) and not before 2000. An error is a JSON Pointer and a code — never the value.
 */
import type { FieldIssue } from '../../../platform/input/field-issues.ts';

export const WAITING_ON = ['customer', 'party'] as const;
export type WaitingOn = (typeof WAITING_ON)[number];

/** Both bounds are inclusive; the upper one is today (the same lower bound as the due date and the day of completion). */
export const WAITING_SINCE_MIN = '2000-01-01';

/** The fields named by the caller, after the schema of the contract. */
export interface WaitingInput {
  readonly waitingOn?: WaitingOn | undefined;
  readonly waitingOnPartyId?: string | undefined;
  readonly waitingSince?: string | undefined;
}

/** Who is waited for and since when: `waitingOnPartyId` is `null` exactly for the customer. */
export interface Waiting {
  readonly waitingOn: WaitingOn;
  readonly waitingOnPartyId: string | null;
  readonly waitingSince: string;
}

export type WaitingResult = { readonly ok: true; readonly waiting: Waiting } | { readonly ok: false; readonly errors: FieldIssue[] };

/** @param today the current day in `Europe/Warsaw` (`YYYY-MM-DD`) */
export function normalizeWaiting(input: WaitingInput, today: string): WaitingResult {
  const errors: FieldIssue[] = [];
  const { waitingOn, waitingOnPartyId } = input;
  if (waitingOn === undefined) errors.push({ pointer: '/waitingOn', code: 'required' });
  else if (waitingOn === 'party' && waitingOnPartyId === undefined) errors.push({ pointer: '/waitingOnPartyId', code: 'required' });
  else if (waitingOn === 'customer' && waitingOnPartyId !== undefined) errors.push({ pointer: '/waitingOnPartyId', code: 'not_allowed' });

  const waitingSince = input.waitingSince ?? today;
  if (waitingSince < WAITING_SINCE_MIN || waitingSince > today) errors.push({ pointer: '/waitingSince', code: 'out_of_range' });

  if (errors.length > 0 || waitingOn === undefined) return { ok: false, errors };
  return { ok: true, waiting: { waitingOn, waitingOnPartyId: waitingOnPartyId ?? null, waitingSince } };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / DAY_MS;

/**
 * Full calendar days from `since` to `today` (both `YYYY-MM-DD` in `Europe/Warsaw`): 2026-09-18 to 2026-10-03 is 15, "since today" is 0.
 * Never negative (a day in the future cannot be stored, but a clock that stepped back must not show a negative counter).
 */
export const waitingDays = (since: string, today: string): number => Math.max(0, dayNumber(today) - dayNumber(since));

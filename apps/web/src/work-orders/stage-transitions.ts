import type { ProcedureStage, StageStatus, TransitionProcedureStageRequest } from '@evia/contracts';
import { ApiError } from '../api/client.ts';

/**
 * The menu of the badge of a stage (EVM-032 AC1, AC4, AC5; W-07, flows/04): a name for each edge of the table "Etap procesu" of
 * `domain-model.md` plus the edit "Zmień, na kogo czekamy…" (not a transition). The menu shows only what the table allows from the
 * status on screen; the server decides all the same (SR-API-07, SR-AUTHZ-05).
 */
export type StageAction =
  'start' | 'wait' | 'finish' | 'notApplicable' | 'block' | 'answered' | 'changeWaiting' | 'unblock' | 'reopen' | 'restore';

export interface StageEntry {
  readonly action: StageAction;
  /** The target of the transition; `undefined` for the edit "Zmień, na kogo czekamy…". */
  readonly to?: StageStatus;
}

const entry = (action: StageAction, to?: StageStatus): StageEntry => (to === undefined ? { action } : { action, to });

const OPEN_TAIL: readonly StageEntry[] = [entry('finish', 'done'), entry('notApplicable', 'not_applicable'), entry('block', 'blocked')];

/** The order of the menu: the way forward first, then "done" and "not applicable", the block last (flows/04). */
const MENU: Readonly<Record<StageStatus, readonly StageEntry[]>> = {
  todo: [entry('start', 'in_progress'), entry('wait', 'waiting'), ...OPEN_TAIL],
  in_progress: [entry('wait', 'waiting'), ...OPEN_TAIL],
  waiting: [entry('answered', 'in_progress'), entry('changeWaiting'), ...OPEN_TAIL],
  blocked: [entry('unblock', 'in_progress')],
  done: [entry('reopen', 'in_progress')],
  not_applicable: [entry('restore', 'todo')],
};

/** The entries for a status; none for a status this panel does not know (P-12: such a badge is static). */
export const stageEntries = (status: string): readonly StageEntry[] => (Object.hasOwn(MENU, status) ? MENU[status as StageStatus] : []);

/** The actions that ask for a field before anything is sent. */
export const STAGE_DIALOG_ACTIONS: ReadonlySet<StageAction> = new Set<StageAction>(['wait', 'changeWaiting', 'finish', 'block']);

/** Longer than this the wait is a warning in the row (AC8: more than 14 days). */
export const LONG_WAIT_DAYS = 14;

export const BLOCKED_REASON_MAX = 500;
export const DATE_MIN = '2000-01-01';

/**
 * "Cofnij" (AC5; flows/04 "Cofnij — lista przejść"): the reverse transition of the table that leads exactly to the previous status,
 * with the parameters a person could give by hand — never a restore of fields and never a `PATCH` of the status. `undefined` for a
 * transition that has no reverse (`todo → in_progress`, `in_progress → not_applicable`, anything out of `waiting` but the answer…).
 * `before` is the stage as it was on screen, `request` what was sent.
 */
export function undoOf(before: ProcedureStage, request: TransitionProcedureStageRequest): TransitionProcedureStageRequest | undefined {
  switch (`${before.status}>${request.to}`) {
    case 'todo>not_applicable':
      return { to: 'todo' };
    case 'not_applicable>todo':
      return { to: 'not_applicable' };
    case 'in_progress>waiting':
    case 'in_progress>done':
    case 'in_progress>blocked':
      return { to: 'in_progress' };
    case 'waiting>in_progress':
      if (before.waitingOn === null) return undefined;
      return {
        to: 'waiting',
        waitingOn: before.waitingOn,
        ...(before.waitingParty === null ? {} : { waitingOnPartyId: before.waitingParty.id }),
        ...(before.waitingSince === null ? {} : { waitingSince: before.waitingSince }),
      };
    case 'blocked>in_progress':
      return before.blockedReason === null ? undefined : { to: 'blocked', blockedReason: before.blockedReason };
    case 'done>in_progress':
      return before.completedOn === null ? undefined : { to: 'done', completedOn: before.completedOn };
    default:
      return undefined;
  }
}

export type StageFailure =
  | { readonly kind: 'conflict' | 'closed' | 'gone' | 'forbidden' | 'network' | 'party' }
  | { readonly kind: 'rate'; readonly seconds: number }
  | { readonly kind: 'server'; readonly code: string }
  | { readonly kind: 'fields'; readonly pointers: ReadonlyMap<string, string> };

/**
 * Why a stage request did not go through. `412` and `409 invalid_state_transition` both say the stage is not what the person saw
 * (the answers carry no state); `409 work_order_closed`, `404` and `403` say so; the field errors name a pointer and a code, never
 * the value (SR-ERR-02), and `unknown_party` is one answer for a party that does not exist or was deleted.
 */
export function describeStageFailure(error: unknown): StageFailure {
  if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) return { kind: 'network' };
  if (error.status === 412 || (error.status === 409 && error.code === 'invalid_state_transition')) return { kind: 'conflict' };
  if (error.status === 409 && error.code === 'work_order_closed') return { kind: 'closed' };
  if (error.status === 404) return { kind: 'gone' };
  if (error.status === 403) return { kind: 'forbidden' };
  if (error.status === 429) return { kind: 'rate', seconds: error.retryAfterSeconds ?? 60 };
  if (error.status === 400) {
    if (error.errors.some((issue) => issue.pointer === '/waitingOnPartyId' && issue.code === 'unknown_party')) return { kind: 'party' };
    const pointers = new Map(error.errors.map((issue) => [issue.pointer, issue.code] as const));
    if (pointers.size > 0) return { kind: 'fields', pointers };
  }
  return { kind: 'server', code: error.traceId?.slice(0, 8) ?? error.code };
}

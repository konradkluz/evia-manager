import type { WorkOrderDetails, WorkOrderStatus } from '@evia/contracts';
import { ApiError } from '../api/client.ts';

/**
 * The actions of the menu of the status badge (W-06, EVM-030 AC1–AC4): a name for each edge of the table of transitions of
 * `domain-model.md` ("Zlecenie") the panel offers. The menu shows only what the API allows this person (`allowedTransitions`);
 * the server decides all the same (SR-AUTHZ-01, SR-AUTHZ-05).
 */
export type TransitionAction =
  'quote' | 'acceptWithoutQuote' | 'accept' | 'start' | 'complete' | 'settle' | 'reopen' | 'hold' | 'resume' | 'cancel' | 'restore';

export type TransitionRole = 'administrator' | 'editor' | 'read_only';

export interface TransitionEntry {
  readonly action: TransitionAction;
  readonly to: WorkOrderStatus;
  /** `restore` for a person who may not restore: shown, but disabled with the reason. */
  readonly forbidden?: boolean;
}

/** The order of the menu (§ W-06: by frequency, the harmful ones last). */
const RANK: Readonly<Record<TransitionAction, number>> = {
  quote: 0,
  acceptWithoutQuote: 1,
  accept: 1,
  start: 1,
  complete: 1,
  resume: 1,
  settle: 1,
  reopen: 2,
  hold: 3,
  cancel: 4,
  restore: 5,
};

export const isClosed = (status: string): boolean => status === 'settled' || status === 'cancelled';

/** What the edge `from → to` is called in the menu; `undefined` for an edge the panel does not offer. */
export function actionOf(from: string, to: WorkOrderStatus): TransitionAction | undefined {
  if (to === 'cancelled') return from === 'settled' ? undefined : 'cancel';
  if (to === 'on_hold') return from === 'cancelled' ? 'restore' : 'hold';
  if (from === 'new' && to === 'quoting') return 'quote';
  if (from === 'new' && to === 'accepted') return 'acceptWithoutQuote';
  if (from === 'quoting' && to === 'accepted') return 'accept';
  if (from === 'accepted' && to === 'in_progress') return 'start';
  if (from === 'in_progress' && to === 'completed') return 'complete';
  if (from === 'completed' && to === 'settled') return 'settle';
  if (from === 'completed' && to === 'in_progress') return 'reopen';
  if (from === 'settled' && to === 'completed') return 'restore';
  if (from === 'on_hold') return 'resume';
  return undefined;
}

/**
 * The entries of the menu for the order and the role. A closed order always offers "Przywróć zlecenie…": enabled for the
 * Administrator (the API lists the target), disabled for the Editor (the API does not, and says so with a hint). A person
 * with the right to read only gets no menu at all (a static badge).
 */
export function menuEntries(
  order: Pick<WorkOrderDetails, 'status' | 'allowedTransitions'>,
  role: TransitionRole | undefined,
): TransitionEntry[] {
  if (role === undefined || role === 'read_only') return [];
  if (order.status === 'settled')
    return [{ action: 'restore', to: 'completed', ...(order.allowedTransitions.includes('completed') ? {} : { forbidden: true }) }];
  if (order.status === 'cancelled')
    return [{ action: 'restore', to: 'on_hold', ...(order.allowedTransitions.includes('on_hold') ? {} : { forbidden: true }) }];
  const entries: TransitionEntry[] = [];
  for (const to of order.allowedTransitions) {
    const action = actionOf(order.status, to);
    if (action !== undefined && action !== 'restore') entries.push({ action, to });
  }
  return entries.sort((a, b) => RANK[a.action] - RANK[b.action]);
}

/** The actions that open a dialog before anything is sent. */
export const DIALOG_ACTIONS: ReadonlySet<TransitionAction> = new Set<TransitionAction>(['hold', 'cancel', 'complete', 'settle', 'restore']);

export type TransitionFailure =
  | { readonly kind: 'conflict' | 'forbidden' | 'stepUp' | 'condition' | 'network' }
  | { readonly kind: 'rate'; readonly seconds: number }
  | { readonly kind: 'server'; readonly code: string }
  | { readonly kind: 'fields'; readonly reason?: string; readonly completedOn?: string };

/**
 * Why a transition did not go through. `412` and `409 invalid_state_transition` both say the order is not what the person saw
 * (the answers carry no state); the field errors name the pointer and a code, never the value (SR-ERR-02).
 */
export function describeTransitionFailure(error: unknown): TransitionFailure {
  if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) return { kind: 'network' };
  if (error.status === 412 || (error.status === 409 && error.code === 'invalid_state_transition')) return { kind: 'conflict' };
  if (error.status === 403) return { kind: error.code === 'step_up_required' ? 'stepUp' : 'forbidden' };
  if (error.status === 422 && error.code === 'transition_condition_not_met') return { kind: 'condition' };
  if (error.status === 429) return { kind: 'rate', seconds: error.retryAfterSeconds ?? 60 };
  if (error.status === 400) {
    const pick = (pointer: string) => error.errors.find((entry) => entry.pointer === pointer)?.code;
    const reason = pick('/reason');
    const completedOn = pick('/completedOn');
    if (reason !== undefined || completedOn !== undefined) {
      return { kind: 'fields', ...(reason === undefined ? {} : { reason }), ...(completedOn === undefined ? {} : { completedOn }) };
    }
  }
  return { kind: 'server', code: error.traceId?.slice(0, 8) ?? error.code };
}

const dayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Today in the business zone as `YYYY-MM-DD` (the default of the date of completion). */
export const todayWarsaw = (instantMs: number): string => dayFormat.format(new Date(instantMs));

export const REASON_MAX = 500;

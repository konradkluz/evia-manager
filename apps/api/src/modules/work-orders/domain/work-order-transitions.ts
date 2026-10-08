/**
 * The table of transitions of a work order (EVM-030 AC1–AC4, AC7; domain-model.md → "Stany i przejścia" → "Zlecenie"; SR-API-07,
 * SR-AUTHZ-05, SR-AUTHZ-10, SR-SESS-08): the ONE place that says which status may follow which, for whom and with what effect.
 * Pure functions of data — no database, no framework, no clock of its own. A transition that is not a row here does not exist
 * (`409 invalid_state_transition`); the status is changed only through a row.
 *
 * "Paths do not bypass roles": a closed order (`settled`, `cancelled`) is left ONLY by a restoration, and a restoration is a row of
 * the Administrator with a step-up. No row that an Editor may use leaves a closed status or clears `closedAt`, so no sequence of
 * the Editor's transitions has the effect of a restoration — the test walks this graph from the table (the BFS of AC7), so a row
 * added here that breaks the rule fails it.
 */
import type { UserRole } from '@evia/contracts';
import type { WorkOrderStatus } from './work-order-list-query.ts';

export const ACTIVE_STATUSES = ['new', 'quoting', 'accepted', 'in_progress'] as const;
export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];
export const isActiveStatus = (status: WorkOrderStatus | null): status is ActiveStatus =>
  status !== null && (ACTIVE_STATUSES as readonly string[]).includes(status);

/** Where an order was held or cancelled from: the target of the resumption. */
const RESUME = 'resume';

export type AuditedTransition = 'work_order.cancelled' | 'work_order.restored';

export interface TransitionRule {
  readonly from: WorkOrderStatus;
  /** `resume` — the status the order was held from (`resumeStatus`). */
  readonly to: WorkOrderStatus | typeof RESUME;
  readonly roles: readonly UserRole[];
  /** A restoration needs a passkey authentication of the session within 15 minutes (SR-SESS-08). */
  readonly stepUp: boolean;
  /** The reason (`statusReason`) is required; where it is not, it is refused. */
  readonly reason: boolean;
  /** How `resumeStatus` changes: `record` — the current status; `keep`; `clear`. */
  readonly resumeStatus: 'record' | 'keep' | 'clear';
  readonly closedAt: 'set' | 'clear' | 'keep';
  readonly completedOn: 'set' | 'clear' | 'keep';
  readonly audit?: AuditedTransition;
}

const BOTH: readonly UserRole[] = ['administrator', 'editor'];
const ADMIN_ONLY: readonly UserRole[] = ['administrator'];

const row = (
  from: WorkOrderStatus,
  to: TransitionRule['to'],
  effects: Partial<Omit<TransitionRule, 'from' | 'to'>> = {},
): TransitionRule => ({
  from,
  to,
  roles: BOTH,
  stepUp: false,
  reason: false,
  resumeStatus: 'keep',
  closedAt: 'keep',
  completedOn: 'keep',
  ...effects,
});

/** A restoration: Administrator only, with a step-up; it clears the closing and is audited. */
const restore = (from: WorkOrderStatus, to: WorkOrderStatus): TransitionRule =>
  row(from, to, { roles: ADMIN_ONLY, stepUp: true, closedAt: 'clear', audit: 'work_order.restored' });

/** The order of the rows is the order of the menu of the badge: the way forward first, then the hold, the cancellation and the restoration. */
export const TRANSITION_TABLE: readonly TransitionRule[] = Object.freeze([
  row('new', 'quoting'),
  row('new', 'accepted'),
  row('quoting', 'accepted'),
  row('accepted', 'in_progress'),
  row('in_progress', 'completed', { completedOn: 'set' }),
  row('completed', 'in_progress', { completedOn: 'clear' }),
  row('completed', 'settled', { closedAt: 'set' }),
  ...ACTIVE_STATUSES.map((status) => row(status, 'on_hold', { reason: true, resumeStatus: 'record' })),
  row('on_hold', RESUME, { resumeStatus: 'clear' }),
  ...ACTIVE_STATUSES.map((status) =>
    row(status, 'cancelled', { reason: true, resumeStatus: 'record', closedAt: 'set', audit: 'work_order.cancelled' }),
  ),
  row('on_hold', 'cancelled', { reason: true, closedAt: 'set', audit: 'work_order.cancelled' }),
  restore('cancelled', 'on_hold'),
  restore('settled', 'completed'),
]);

/** What the table needs to know of an order. */
export interface TransitionState {
  readonly status: WorkOrderStatus;
  readonly resumeStatus: ActiveStatus | null;
  readonly closedAt: Date | null;
  readonly completedOn: string | null;
}

/** A row of the table with its target resolved (`resume` becomes the status the order was held from). */
export interface ResolvedTransition {
  readonly rule: TransitionRule;
  readonly to: WorkOrderStatus;
}

type StatusPair = Pick<TransitionState, 'status' | 'resumeStatus'>;

/**
 * The rows that leave the status of the order. A resumption of an order that has no `resumeStatus` (data that was not made by the
 * hold command) has no target and is not offered: fail closed, `409 invalid_state_transition`.
 */
export function transitionsFrom(state: StatusPair): ResolvedTransition[] {
  return TRANSITION_TABLE.filter((candidate) => candidate.from === state.status).flatMap((candidate) => {
    const to = candidate.to === RESUME ? state.resumeStatus : candidate.to;
    return to === null ? [] : [{ rule: candidate, to }];
  });
}

/** The row for the move to `to`, or `undefined` when the table has none (never a role decision: see `mayUse`). */
export const findTransition = (state: StatusPair, to: WorkOrderStatus): ResolvedTransition | undefined =>
  transitionsFrom(state).find((candidate) => candidate.to === to);

export const mayUse = (transition: ResolvedTransition, role: UserRole): boolean => transition.rule.roles.includes(role);

/** The targets the role may choose NOW (`allowedTransitions`, a hint for the UI — the server decides again). Read-only gets none. */
export const allowedTransitions = (state: StatusPair, role: UserRole): WorkOrderStatus[] =>
  transitionsFrom(state)
    .filter((transition) => mayUse(transition, role))
    .map((transition) => transition.to);

export interface TransitionFields {
  /** Normalised reason; `null` where the row takes none. */
  readonly reason: string | null;
  /** The day the work was completed (`YYYY-MM-DD`); used where the row sets it. */
  readonly completedOn: string | null;
}

export interface TransitionResult {
  readonly state: TransitionState;
  readonly statusReason: string | null;
}

function nextResumeStatus(state: TransitionState, how: TransitionRule['resumeStatus']): ActiveStatus | null {
  if (how === 'clear') return null;
  if (how === 'record') return isActiveStatus(state.status) ? state.status : state.resumeStatus;
  return state.resumeStatus;
}

/** The order after the row: the status, `resumeStatus`, `closedAt` and `completedOn` as the row says, the reason as given. */
export function applyTransition(
  state: TransitionState,
  { rule, to }: ResolvedTransition,
  fields: TransitionFields,
  now: Date,
): TransitionResult {
  return {
    state: {
      status: to,
      resumeStatus: nextResumeStatus(state, rule.resumeStatus),
      closedAt: rule.closedAt === 'set' ? now : rule.closedAt === 'clear' ? null : state.closedAt,
      completedOn: rule.completedOn === 'set' ? fields.completedOn : rule.completedOn === 'clear' ? null : state.completedOn,
    },
    statusReason: fields.reason,
  };
}

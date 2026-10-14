/**
 * Domain events of the `procedures` module (EVM-031). Published through the platform event bus inside the transaction of the change;
 * `audit` subscribes to them (the dependency points from `audit` to this file, never back). The event type is the audit action:
 * `<object>.<past tense>`. An event carries identifiers only — never the name of the person responsible, the due date, or a field name
 * or value (the audit trail is append-only and cannot be erased, RODO art. 17) — in particular never the reason of a block, the name of
 * a party or the days of "waiting for" (EVM-032). The object is the stage; its order is the one the stage
 * belongs to. The creation of the processes is a part of `work_order.created`, not an event of its own.
 */
import type { DomainEvent } from '../../platform/events/event-bus.ts';
import type { StageStatus } from './domain/stage-rules.ts';
import type { WaitingOn } from './domain/waiting.ts';

/**
 * The audited actions of the module. EVM-042 adds six: the creation, the deletion and the restoration of a process and of a stage —
 * the removal and the return of a record are always told apart in the trail (TM-21). The object is the process or the stage; the
 * event carries its identifier only, never the NAME of a stage (free text typed by the user, it may name a person).
 */
export const PROCEDURE_EVENT_TYPES = [
  'procedure_stage.updated',
  'procedure_stage.transitioned',
  'procedure.created',
  'procedure.deleted',
  'procedure.restored',
  'procedure_stage.created',
  'procedure_stage.deleted',
  'procedure_stage.restored',
] as const;

export interface ProcedureStageEvent extends DomainEvent {
  readonly type:
    | 'procedure_stage.updated'
    | 'procedure_stage.transitioned'
    | 'procedure_stage.created'
    | 'procedure_stage.deleted'
    | 'procedure_stage.restored';
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'success';
  readonly objectType: 'procedure_stage';
  readonly objectId: string;
}

/** The audited actions on a PROCESS (EVM-042): the object is the process. */
export interface ProcedureEvent extends DomainEvent {
  readonly type: 'procedure.created' | 'procedure.deleted' | 'procedure.restored';
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'success';
  readonly objectType: 'procedure';
  readonly objectId: string;
}

/** Everything `audit` writes for this module. */
export type ProcedureAuditEvent = ProcedureStageEvent | ProcedureEvent;

/**
 * The changes of a stage for the JOURNAL (EVM-038), published inside the transaction of the change. They are NOT in
 * `PROCEDURE_EVENT_TYPES`: `audit` does not subscribe to them (the journal of an order does not replace the audit trail). One event
 * per KIND of change: the status (with "waiting for" when the stage moves into `waiting`), the party waited for, the person
 * responsible and the due date. They carry codes, identifiers and the NAMES of the changed fields — never the reason of a block, a
 * name, a date or the person responsible (SR-LOG-03, SR-DATA-01; RODO art. 17: the journal is append-only).
 */
export const PROCEDURE_JOURNAL_EVENT_TYPES = [
  'procedure_stage.status_changed',
  'procedure_stage.waiting_on_changed',
  'procedure_stage.fields_changed',
  'procedure.added',
  'procedure.removed',
  'procedure.reinstated',
  'procedure_stage.added',
  'procedure_stage.removed',
  'procedure_stage.reinstated',
] as const;

interface StageJournalEvent extends DomainEvent {
  readonly type: 'procedure_stage.status_changed' | 'procedure_stage.waiting_on_changed' | 'procedure_stage.fields_changed';
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'success';
  readonly objectType: 'procedure_stage';
  /** The stage. */
  readonly objectId: string;
  /** The order the stage belongs to. */
  readonly workOrderId: string;
}

export interface StageStatusChangedEvent extends StageJournalEvent {
  readonly type: 'procedure_stage.status_changed';
  readonly fromStatus: StageStatus;
  readonly toStatus: StageStatus;
  /** Set exactly when the stage moved into `waiting`. */
  readonly waitingOn: WaitingOn | null;
  readonly waitingOnPartyId: string | null;
}

export interface StageWaitingOnChangedEvent extends StageJournalEvent {
  readonly type: 'procedure_stage.waiting_on_changed';
  readonly waitingOn: WaitingOn;
  readonly waitingOnPartyId: string | null;
}

export interface StageFieldsChangedEvent extends StageJournalEvent {
  readonly type: 'procedure_stage.fields_changed';
  readonly changedFields: readonly ('responsibleUserId' | 'dueDate')[];
}

/**
 * A process or a stage added, removed or restored by hand (EVM-042 AC5). The journal gets the object, the order and the stable CODE
 * of the process (the process itself, or the process of the stage) — never the name of a stage: it is read from the current data
 * when the journal is shown (SR-LOG-03, SR-DATA-01; RODO art. 17).
 */
export interface ProcedureMembershipEvent extends DomainEvent {
  readonly type:
    | 'procedure.added'
    | 'procedure.removed'
    | 'procedure.reinstated'
    | 'procedure_stage.added'
    | 'procedure_stage.removed'
    | 'procedure_stage.reinstated';
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'success';
  readonly objectType: 'procedure' | 'procedure_stage';
  /** The process or the stage. */
  readonly objectId: string;
  /** The order the object belongs to. */
  readonly workOrderId: string;
  /** The stable code of the process (of the stage's process for a stage). */
  readonly procedureCode: string;
}

export type StageJournalChangeEvent =
  StageStatusChangedEvent | StageWaitingOnChangedEvent | StageFieldsChangedEvent | ProcedureMembershipEvent;

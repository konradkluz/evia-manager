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

export const PROCEDURE_EVENT_TYPES = ['procedure_stage.updated', 'procedure_stage.transitioned'] as const;

export interface ProcedureStageEvent extends DomainEvent {
  readonly type: (typeof PROCEDURE_EVENT_TYPES)[number];
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'success';
  readonly objectType: 'procedure_stage';
  readonly objectId: string;
}

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
] as const;

interface StageJournalEvent extends DomainEvent {
  readonly type: (typeof PROCEDURE_JOURNAL_EVENT_TYPES)[number];
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

export type StageJournalChangeEvent = StageStatusChangedEvent | StageWaitingOnChangedEvent | StageFieldsChangedEvent;

/**
 * Domain events of the `procedures` module (EVM-031). Published through the platform event bus inside the transaction of the change;
 * `audit` subscribes to them (the dependency points from `audit` to this file, never back). The event type is the audit action:
 * `<object>.<past tense>`. An event carries identifiers only — never the name of the person responsible, the due date, or a field name
 * or value (the audit trail is append-only and cannot be erased, RODO art. 17) — in particular never the reason of a block, the name of
 * a party or the days of "waiting for" (EVM-032). The object is the stage; its order is the one the stage
 * belongs to. The creation of the processes is a part of `work_order.created`, not an event of its own.
 */
import type { DomainEvent } from '../../platform/events/event-bus.ts';

export const PROCEDURE_EVENT_TYPES = ['procedure_stage.updated', 'procedure_stage.transitioned'] as const;

export interface ProcedureStageEvent extends DomainEvent {
  readonly type: (typeof PROCEDURE_EVENT_TYPES)[number];
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'success';
  readonly objectType: 'procedure_stage';
  readonly objectId: string;
}

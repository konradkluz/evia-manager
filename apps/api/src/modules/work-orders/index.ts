/** Public API of the `work-orders` module (other modules reach it only through this file — ADR-0001). */
export { WorkOrdersModule } from './work-orders.module.ts';
export {
  WORK_ORDER_EVENT_TYPES,
  WORK_ORDER_JOURNAL_EVENT_TYPES,
  type ScopeItemAddedEvent,
  type ScopeItemRemovedEvent,
  type ScopeItemUpdatedEvent,
  type WorkOrderEvent,
  type WorkOrderFieldsChangedEvent,
  type WorkOrderJournalChangeEvent,
  type WorkOrderStatusChangedEvent,
} from './events.ts';
export type { ScopeItemField } from './domain/scope-item-rules.ts';
export type { WorkOrderField } from './domain/work-order-patch.ts';
export { ScopeLimitError, WorkOrderScopeRegistry, type ScopeAdditionContext, type WorkOrderScopeParticipant } from './scope-participant.ts';
export { WorkOrderTransitionRegistry, type TransitionContext, type WorkOrderTransitionParticipant } from './transition-participant.ts';
export { WorkOrderDeletionRegistry, type DeletionContext, type WorkOrderDeletionParticipant } from './deletion-participant.ts';
export { decideDeletion, type DeletionAssessment, type DeletionDecision } from './domain/work-order-deletion.ts';
export {
  WorkOrderCompositionRegistry,
  type CompositionContext,
  type CompositionScopeItem,
  type WorkOrderCompositionContributor,
} from './composition-contributor.ts';
export { WORK_ORDER_DIRECTORY, type WorkOrderDirectory, type WorkOrderListRef, type WorkOrderRef } from './work-order-directory.ts';

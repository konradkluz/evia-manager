/** Public API of the `work-orders` module (other modules reach it only through this file — ADR-0001). */
export { WorkOrdersModule } from './work-orders.module.ts';
export { WORK_ORDER_EVENT_TYPES, type WorkOrderEvent } from './events.ts';
export {
  WorkOrderCompositionRegistry,
  type CompositionContext,
  type CompositionScopeItem,
  type WorkOrderCompositionContributor,
} from './composition-contributor.ts';

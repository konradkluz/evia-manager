import type { WorkOrder, WorkOrderDetails } from '@evia/contracts';

/**
 * The header of W-06 made from the answer of the creation (EVM-022): the page shows it at once and asks the API again, so the
 * scope — which the header does not carry — is dropped here and the answer of the API replaces the rest (EVM-018).
 */
export function headerOf(order: WorkOrder): WorkOrderDetails {
  return {
    id: order.id,
    number: order.number,
    title: order.title,
    status: order.status,
    customer: order.customer,
    site: order.site,
    coordinator: order.coordinator,
    // the menu of transitions depends on the role: the creation answer does not carry it, the API answer that replaces this one does (EVM-030)
    allowedTransitions: [],
    version: order.version,
    createdAt: order.createdAt,
  };
}

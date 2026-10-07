/**
 * The read policy of work orders as a condition of the query (EVM-017 AC6; SR-AUTHZ-02, SR-AUTHZ-03, ASVS V8.2.2): the ONE
 * place that says which work orders a caller may see. Lists, the detail, the search and the synchronisation use it, so a
 * rule changed here changes them all — and nobody filters a page after it was read. Today every signed-in role sees every
 * work order that is not soft deleted (RR-13), the Administrator included: the view of deleted orders is a story of its own
 * (EVM-060). The switch over the role is exhaustive: a role added later (the installer of M4) does not compile until this
 * policy says what it may see.
 */
import type { ExpressionBuilder } from 'kysely';
import type { Principal } from '../../../platform/http/principal.ts';
import type { WorkOrderTables } from './tables.ts';

export const visibleWorkOrders = (principal: Principal) => (eb: ExpressionBuilder<WorkOrderTables, 'work_orders.work_orders'>) => {
  switch (principal.role) {
    case 'administrator':
    case 'editor':
    case 'read_only':
      return eb('work_orders.work_orders.deleted_at', 'is', null);
  }
};

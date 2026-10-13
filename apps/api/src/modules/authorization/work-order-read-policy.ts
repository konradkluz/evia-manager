/**
 * The read policy of work orders as a CONDITION of a query (EVM-017 AC6, EVM-034 W2; SR-AUTHZ-02, SR-AUTHZ-03, ASVS V8.2.2): the ONE
 * place that says which work orders a caller may see. `work-orders` (the detail, the lists of a site, the locks) and `overview` (the
 * list and the summary, over the projection) both build their condition here, each naming the column that holds the deletion time in
 * ITS table — so there is one rule, not a copy per table. Nobody filters a page after it was read.
 *
 * Today every signed-in role sees every order that is not soft deleted (RR-13), the Administrator included: the view of deleted
 * orders is a story of its own (EVM-060). The switch over the role is exhaustive: a role added later (the installer of M4) does not
 * compile until this policy says what it may see.
 */
import { sql, type RawBuilder, type SqlBool } from 'kysely';
import type { Principal } from '../../platform/http/principal.ts';

/** The table of the query whose deletion time the policy is a condition on (v1: the deletion time; M4 adds the assignments). */
export type WorkOrderPolicySource = 'work_orders.work_orders' | 'overview.work_order_summaries';

/** The column of the authorisation (`deleted_at`) of the source — fixed identifiers written in code, never a value of a request. */
const deletedAtOf = (source: WorkOrderPolicySource) =>
  source === 'work_orders.work_orders'
    ? sql.ref('work_orders.work_orders.deleted_at')
    : sql.ref('overview.work_order_summaries.deleted_at');

export function workOrderReadCondition(principal: Principal, source: WorkOrderPolicySource): RawBuilder<SqlBool> {
  switch (principal.role) {
    case 'administrator':
    case 'editor':
    case 'read_only':
      return sql<SqlBool>`${deletedAtOf(source)} is null`;
  }
}

/**
 * The target of a mutation of the phone (EVM-098 AC6; SR-AUTHZ-02, SR-AUTHZ-03, SR-AUTHZ-05, ASVS V8.2.2, CWE-639): the CURRENT access of the caller to the
 * order, judged when the mutation reaches the server - not when the entry was written. ONE query with the policy (mode `access`) in its condition: a row
 * that is missing and a row the caller has no access to are the same answer, `forbidden`, so the answer tells nothing about the existence of an order. Only
 * the state comes back - no field of the order.
 */
import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import type { MutationTargetState, WorkOrderMutationTarget } from '../system-ports.ts';
import { accessibleWorkOrders } from './read-policy.ts';
import { workOrderTables } from './tables.ts';

@Injectable()
export class WorkOrderMutationTargetService implements WorkOrderMutationTarget {
  async stateOf(tx: Kysely<Database>, principal: Principal, workOrderId: string): Promise<MutationTargetState> {
    const row = await workOrderTables(tx)
      .selectFrom('work_orders.work_orders')
      .select(sql<boolean>`deleted_at is not null`.as('deleted'))
      .where('id', '=', workOrderId)
      .where(accessibleWorkOrders(principal))
      .executeTakeFirst();
    if (row === undefined) return 'forbidden';
    return row.deleted ? 'target_unavailable' : 'available';
  }
}

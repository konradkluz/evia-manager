/**
 * The read policy of work orders on the table `work_orders.work_orders` (EVM-017 AC6; SR-AUTHZ-02, SR-AUTHZ-03, ASVS V8.2.2). The rule
 * itself lives in `authorization` (`workOrderReadCondition`) and is shared with the list of `overview`: this file only names the
 * column of this table. Lists, the detail, the search and the synchronisation use it, so a rule changed there changes them all.
 */
import { workOrderReadCondition } from '../../authorization/index.ts';
import type { Principal } from '../../../platform/http/principal.ts';

export const visibleWorkOrders = (principal: Principal) => workOrderReadCondition(principal, 'work_orders.work_orders');

/** The mode `deleted` of the policy (EVM-060): the soft deleted orders for the Administrator, never true for another role. Used by the view "Usunięte" only. */
export const deletedWorkOrders = (principal: Principal) => workOrderReadCondition(principal, 'work_orders.work_orders', 'deleted');

/** The mode `access` of the policy (EVM-098 AC6): deleted or not. Used by the target of a mutation of the phone ONLY (`mutation-target.ts`), never by a read. */
export const accessibleWorkOrders = (principal: Principal) => workOrderReadCondition(principal, 'work_orders.work_orders', 'access');

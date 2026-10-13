/**
 * The status of a work order as a type and a list (domain-model.md → `WorkOrderStatus`): the values come from the contract, so the
 * schema, the database CHECK and the code say the same. "Open" is every status but the closed ones.
 */
import { zWorkOrderStatus } from '@evia/contracts/zod';
import type { z } from 'zod';

export const WORK_ORDER_STATUSES = zWorkOrderStatus.options;
export type WorkOrderStatus = z.infer<typeof zWorkOrderStatus>;

/** "Open" is every status but the closed ones (domain-model.md → WorkOrderStatus). */
export const CLOSED_STATUSES: readonly WorkOrderStatus[] = ['settled', 'cancelled'];

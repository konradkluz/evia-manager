/**
 * What the commands on one milestone share (EVM-053 AC3, EVM-054 AC1–AC4): the answer — the milestone of THIS order as it is NOW, with
 * the transitions of the role of the caller — and the columns no request may name (they are not in the representation either, so the
 * contract cannot list them as read-only: a request that names one is `400 read_only_field` all the same, CWE-915).
 */
import type { PaymentMilestone } from '@evia/contracts';
import type { Kysely } from 'kysely';
import { businessDate } from '../../../platform/clock/business-date.ts';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import type { WorkOrderRef } from '../../work-orders/index.ts';
import { findMilestone } from '../infrastructure/milestone-reader.ts';
import { paymentTables } from '../infrastructure/tables.ts';
import { toPaymentMilestone } from './milestone-representation.ts';

export const HIDDEN_MILESTONE_COLUMNS = [
  'workOrderId',
  'sourceTemplateId',
  'currency',
  'amountMinor',
  'notes',
  'statusReason',
  'createdAt',
  'createdBy',
  'updatedAt',
  'updatedBy',
  'deletedAt',
  'deletedBy',
] as const;

/** The milestone of THIS order as it is now (the answer of a change and of a repeat); a milestone gone meanwhile is `404`. */
export async function currentMilestone(
  tx: Kysely<Database>,
  clock: Clock,
  principal: Principal,
  order: WorkOrderRef,
  milestoneId: string,
): Promise<PaymentMilestone> {
  const row = await findMilestone(paymentTables(tx), order.id, milestoneId);
  if (row === undefined) throw new ProblemException('not_found');
  return toPaymentMilestone(row, businessDate(clock.now()), { role: principal.role, orderClosed: order.closed });
}

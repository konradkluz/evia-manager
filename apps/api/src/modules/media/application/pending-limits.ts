/**
 * The limits of unfinished media (EVM-049 D9, RR-NOC-T1-4), shared by the batch of the panel and by the declaration of the file of a medium of the phone (EVM-131): per creator and per
 * order, counted in the transaction under an advisory lock of each subject, so two parallel requests cannot both pass the count (CWE-367). `422 limit_exceeded` (a limit of subordinate
 * objects); what would pass the limit is refused whole.
 */
import { ProblemException } from '../../../platform/http/problem.ts';
import type { MediaLimits } from '../../../platform/config/media-config.ts';
import { countPendingOfCreator, countPendingOfOrder, lockPendingCounter } from '../infrastructure/media-store.ts';
import type { MediaDb } from '../infrastructure/tables.ts';

export async function checkPendingLimits(
  tables: MediaDb,
  limits: MediaLimits,
  userId: string,
  workOrderId: string,
  adding: number,
): Promise<void> {
  await lockPendingCounter(tables, 'user', userId);
  await lockPendingCounter(tables, 'order', workOrderId);
  const errors: Array<{ pointer: string; code: string }> = [];
  if ((await countPendingOfCreator(tables, userId)) + adding > limits.maxPendingPerUser) {
    errors.push({ pointer: '/items', code: 'too_many_unfinished_for_user' });
  }
  if ((await countPendingOfOrder(tables, workOrderId)) + adding > limits.maxPendingPerOrder) {
    errors.push({ pointer: '/items', code: 'too_many_unfinished_for_order' });
  }
  if (errors.length > 0) throw new ProblemException('limit_exceeded', { errors });
}

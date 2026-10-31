import type { PendingObjectsSource, QueueStore, SessionOwner } from './ports.ts';
import type { PendingObjects } from './pull-types.ts';
import { UUID_PATTERN } from './types.ts';
import { parseEntry } from './validate.ts';

/**
 * Pending objects derived from the queue of the signed-in user (the queue stays the source of truth): objects the phone created
 * and the server has not confirmed (`applied`/`duplicate` removes the entry), the work orders they belong to, and the existing
 * customer/site a pending quick work order points to. Corrupt entries are ignored (they are reported by the push side).
 */
export function queuePendingSource(store: QueueStore, session: SessionOwner): PendingObjectsSource {
  return {
    async read(): Promise<PendingObjects> {
      const userId = await session.currentUserId();
      const objectIds = new Set<string>();
      const workOrderIds = new Set<string>();
      const referencedIds = new Set<string>();
      for (const raw of await store.readAll()) {
        const parsed = parseEntry(raw);
        if (!parsed.ok || parsed.record.ownerUserId !== userId) continue;
        const { record } = parsed;
        objectIds.add(record.objectId);
        workOrderIds.add(record.orderingKey);
        if (record.type === 'CreateQuickWorkOrder') {
          for (const field of ['customerId', 'siteId']) {
            const value = record.payload[field];
            if (typeof value === 'string' && UUID_PATTERN.test(value)) referencedIds.add(value);
          }
        }
      }
      return { objectIds, workOrderIds, referencedIds };
    },
  };
}

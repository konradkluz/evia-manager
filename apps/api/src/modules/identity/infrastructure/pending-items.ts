/** The write behind the port `DEVICE_PENDING_ITEMS` (see `../system-ports.ts`): one parameterised UPDATE of one column of the device of the session. */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { MAX_PENDING_ITEMS_REPORTED, type DevicePendingItems } from '../system-ports.ts';
import { identityTables } from './tables.ts';

export class DevicePendingItemsService implements DevicePendingItems {
  async report(tx: Kysely<Database>, deviceId: string, pendingItems: number): Promise<void> {
    await identityTables(tx)
      .updateTable('identity.devices')
      .set({ pending_items_reported: sql<number>`least(${pendingItems}::integer, ${MAX_PENDING_ITEMS_REPORTED}::integer)` })
      .where('id', '=', deviceId)
      .execute();
  }
}

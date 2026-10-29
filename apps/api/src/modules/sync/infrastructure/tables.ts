/**
 * Kysely types of the tables the `sync` module owns (EVM-096; migration 0053). `platform` does not know module tables: the module narrows a handle with
 * `db.$extendTables<SyncTables>()`. The application role may only READ `sync.change_log` (the trigger writes it); `txid` is an `xid8` (the driver returns a
 * string) and is compared in SQL only.
 */
import type { Generated, Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';

export interface ChangeLogTable {
  seq: string;
  txid: string;
  entity_type: string;
  entity_id: string;
  operation: 'upsert' | 'delete';
  work_order_id: string | null;
  entity_version: number;
  recorded_at: Date;
}

export interface DeviceSyncStateTable {
  device_id: string;
  last_full_sync_at: Date | null;
  resync_requested_reason: 'periodic' | 'access_changed' | 'scope_changed' | 'cursor_expired' | 'cursor_invalid' | null;
  updated_at: Date;
}

export interface FullDownloadsTable {
  id: Generated<string>;
  device_id: string;
  user_id: string;
  reason: string;
  started_at: Date;
  work_order_count: Generated<number>;
  customer_count: Generated<number>;
  site_count: Generated<number>;
}

export type SyncTables = {
  'sync.change_log': ChangeLogTable;
  'sync.device_sync_state': DeviceSyncStateTable;
  'sync.full_downloads': FullDownloadsTable;
};

export type SyncDb = Kysely<SyncTables>;

export const syncTables = (db: Kysely<Database>): SyncDb => db.$extendTables<SyncTables>();

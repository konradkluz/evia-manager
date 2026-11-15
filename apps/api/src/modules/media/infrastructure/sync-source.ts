/**
 * The queries behind the sync port of `media` (see `../system-ports.ts`): SELECT only, the listed columns. The state of the file comes from `stored_files` by a LEFT JOIN - a medium
 * created on the phone has no file until its upload session is opened (`pending`) - and goes through the allow-list of `syncFileStatus` (the reason of a quarantine never leaves).
 * A medium that is soft deleted or whose file was erased is not live: `sync` sends a marker for it. The version is `version + file_state_revision` (`syncVersionOfAsset`).
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { SyncChildAnchor } from '../../../platform/sync/sync-row-state.ts';
import { syncFileStatus } from '../domain/sync-state.ts';
import type { FileState } from '../domain/scan-outcome.ts';
import type { MediaAssetSyncSource, SyncMediaAssetProjection } from '../system-ports.ts';
import { syncVersionOfAsset } from './sync-version.ts';
import { mediaTables } from './tables.ts';

export class MediaAssetSyncSourceService implements MediaAssetSyncSource {
  async anchorsOf(tx: Kysely<Database>, ids: readonly string[]): Promise<ReadonlyMap<string, SyncChildAnchor>> {
    if (ids.length === 0) return new Map();
    const rows = await mediaTables(tx)
      .selectFrom('media.media_assets as a')
      .select(['a.id as id', 'a.work_order_id as workOrderId', 'a.deleted_at as deletedAt', 'a.file_purged_at as purgedAt'])
      .where('a.id', 'in', ids)
      .execute();
    return new Map(
      rows.map((row): [string, SyncChildAnchor] => [
        row.id,
        { workOrderId: row.workOrderId, state: row.deletedAt === null && row.purgedAt === null ? 'live' : 'deleted' },
      ]),
    );
  }

  async liveOf(
    tx: Kysely<Database>,
    ids: readonly string[],
    workOrderIds: readonly string[],
  ): Promise<ReadonlyMap<string, SyncMediaAssetProjection>> {
    if (ids.length === 0 || workOrderIds.length === 0) return new Map();
    const rows = await this.#select(tx).where('a.id', 'in', ids).where('a.work_order_id', 'in', workOrderIds).execute();
    return new Map(rows.map((row) => [row.id, toProjection(row)]));
  }

  /** ONE query for the whole page of orders (`work_order_id = any`, the index `media_assets_order_idx`), in the order of the phone. */
  async ofOrders(tx: Kysely<Database>, workOrderIds: readonly string[]): Promise<readonly SyncMediaAssetProjection[]> {
    if (workOrderIds.length === 0) return [];
    const rows = await this.#select(tx)
      .where('a.work_order_id', 'in', workOrderIds)
      .orderBy('a.work_order_id')
      .orderBy('a.created_at')
      .orderBy('a.id')
      .execute();
    return rows.map(toProjection);
  }

  #select(tx: Kysely<Database>) {
    return mediaTables(tx)
      .selectFrom('media.media_assets as a')
      .leftJoin('media.stored_files as f', 'f.media_asset_id', 'a.id')
      .select([
        'a.id as id',
        syncVersionOfAsset().as('version'),
        'a.work_order_id as workOrderId',
        'a.media_type as mediaType',
        'a.category as category',
        'a.procedure_stage_id as procedureStageId',
        'f.state as fileState',
        'f.state_reason_code as reasonCode',
      ])
      .where('a.deleted_at', 'is', null)
      .where('a.file_purged_at', 'is', null);
  }
}

interface Row {
  readonly id: string;
  readonly version: number;
  readonly workOrderId: string;
  readonly mediaType: 'photo' | 'video';
  readonly category: string;
  readonly procedureStageId: string | null;
  readonly fileState: FileState | null;
  readonly reasonCode: string | null;
}

function toProjection(row: Row): SyncMediaAssetProjection {
  return {
    id: row.id,
    version: row.version,
    workOrderId: row.workOrderId,
    mediaType: row.mediaType,
    category: row.category,
    procedureStageId: row.procedureStageId,
    ...syncFileStatus(row.fileState, row.reasonCode),
  };
}

/**
 * The SYNC and COMMAND ports of `media` for the phone (EVM-131; ADR-0021 D4, D8): the media of the orders for the pull, and the command `CreateMediaAsset` of the push. Like
 * `timeline/system-ports.ts`: only `sync` may import them (`pnpm run deps:check`), and `media` imports nothing of `sync`. The columns are listed, never `*`: the name of the
 * file, the key of the object, the checksum, the address and the details of a quarantine never leave (SR-MOB-10, SR-FILE).
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';
import type { EventContext } from '../../platform/events/event-bus.ts';
import type { OrderChildSyncSource } from '../../platform/sync/sync-row-state.ts';
import type { SyncFileState, SyncReasonCode } from './domain/sync-state.ts';

export const MEDIA_ASSET_SYNC_SOURCE = Symbol('MEDIA_ASSET_SYNC_SOURCE');

/** The fields of `SyncMediaAsset` (contract) that the server fills; `type` is added by the serializer of `sync`, the rest of the contract is sent as `null`. */
export interface SyncMediaAssetProjection {
  readonly id: string;
  /** The version of the synchronisation: `version + file_state_revision`. */
  readonly version: number;
  readonly workOrderId: string;
  readonly mediaType: 'photo' | 'video';
  readonly category: string;
  readonly procedureStageId: string | null;
  readonly fileState: SyncFileState;
  readonly fileStateReasonCode: SyncReasonCode | null;
}

export type MediaAssetSyncSource = OrderChildSyncSource<SyncMediaAssetProjection>;

/**
 * The COMMAND port for the mutations of the phone: a medium created offline, in the transaction of `sync`, with the rules of the panel (`resolveNewMediaMetadata`: the category, the
 * description; the stage of THIS order) and INSERT only (origin `mobile`, `created_by` the user of the session). The order has been judged by `work-orders` before this runs. The
 * answer is a code only: no pointer, no value of the request, nothing of an existing row (the description may name a person).
 */
export const MOBILE_MEDIA_COMMANDS = Symbol('MOBILE_MEDIA_COMMANDS');

export interface MobileMediaCommand {
  readonly id: string;
  readonly workOrderId: string;
  readonly mediaType: 'photo' | 'video';
  readonly category: string;
  readonly description: string | undefined;
  readonly procedureStageId: string | undefined;
  /** In range or `null` (decided by `sync`); metadata only - the order and the audit are the time of the server. */
  readonly capturedAt: Date | null;
}

/** The author and the device of the SESSION of the request. */
export interface MobileMediaAuthor {
  readonly userId: string;
  readonly deviceId: string;
}

/** `applied`: the medium is written and `media_asset.created` published; `invalid`: a rule of the content or the stage; `id_conflict`: the identifier exists (any order, any user). */
export type MobileMediaResult = 'applied' | 'invalid' | 'id_conflict';

export interface MobileMediaCommands {
  create(tx: Kysely<Database>, author: MobileMediaAuthor, command: MobileMediaCommand, context: EventContext): Promise<MobileMediaResult>;
}

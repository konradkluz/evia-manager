/**
 * The command `CreateMediaAsset` of the phone (EVM-130, contract `paths/sync.yaml` / `components/sync.yaml` of EVM-131): the metadata of
 * a photo or a video is a queue entry like a note; the FILE is declared later, in the upload session, after the server applied the
 * command. Only the payload is built here (minimal; the camera and the forms are EVM-108/110) — the description may hold personal data,
 * so it never goes to a log, a notification or a diagnostic. Ids are UUIDv7 made on the phone (the `assetId` is also the name of the file
 * in the private directory of the native module).
 */
import type { EnqueueInput } from '@evia/sync-core';

export const MEDIA_COMMAND_VERSION = 1;
export const MEDIA_CATEGORIES = ['site_survey', 'before_work', 'in_progress', 'completed_work', 'defect', 'measurement', 'other'] as const;
export type MediaCategory = (typeof MEDIA_CATEGORIES)[number];
export const MEDIA_TYPES = ['photo', 'video'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export interface NewMediaAsset {
  /** UUIDv7; also the id of the file of the native module. */
  readonly assetId: string;
  readonly workOrderId: string;
  readonly mediaType: MediaType;
  readonly category: MediaCategory;
  /** Plain text, at most 1000 characters. */
  readonly description?: string;
  readonly procedureStageId?: string;
  /** ISO time of the capture. */
  readonly capturedAt?: string;
}

const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const DESCRIPTION_MAX = 1000;

/** The entry for the queue, or `null` when a field would be refused by the server (`additionalProperties: false`, closed lists). */
export function createMediaAssetInput(asset: NewMediaAsset): EnqueueInput | null {
  if (!CLIENT_ID.test(asset.assetId) || !UUID.test(asset.workOrderId)) return null;
  if (!(MEDIA_TYPES as readonly string[]).includes(asset.mediaType)) return null;
  if (!(MEDIA_CATEGORIES as readonly string[]).includes(asset.category)) return null;
  if (asset.description !== undefined && asset.description.length > DESCRIPTION_MAX) return null;
  if (asset.procedureStageId !== undefined && !UUID.test(asset.procedureStageId)) return null;
  if (asset.capturedAt !== undefined && Number.isNaN(Date.parse(asset.capturedAt))) return null;
  return {
    type: 'CreateMediaAsset',
    commandVersion: MEDIA_COMMAND_VERSION,
    payload: {
      id: asset.assetId,
      workOrderId: asset.workOrderId,
      mediaType: asset.mediaType,
      category: asset.category,
      ...(asset.description === undefined ? {} : { description: asset.description }),
      ...(asset.procedureStageId === undefined ? {} : { procedureStageId: asset.procedureStageId }),
      ...(asset.capturedAt === undefined ? {} : { capturedAt: asset.capturedAt }),
    },
  };
}

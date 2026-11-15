/**
 * Types of the files of the queue that screens may import (EVM-130): no runtime dependency on the service, the store or the module
 * (dependency-cruiser `mobile-screens-without-adapters`). The screens read `MediaUploadsSnapshot` and call `MediaControl`.
 */
import type { CapturePipeline, CapturePorts } from '../capture/capture-pipeline';
import type { MediaCategory } from './create-media-asset';

export type MediaFileStatus = 'waiting' | 'uploading' | 'sent' | 'error' | 'attention';
export type MediaFileAction = 'retry' | 'discard';

export interface MediaFileView {
  readonly assetId: string;
  readonly status: MediaFileStatus;
  /** 0..100 while uploading, else `null`. */
  readonly percent: number | null;
  readonly sizeBytes: number;
  readonly actions: readonly MediaFileAction[];
  /** A code for the technical details (`checksum_mismatch`, `quarantined`, …); never a message. */
  readonly code: string | null;
  readonly updatedAt: number;
  /** What the technician chose (EVM-108); `null` for a file without a category (before v3, the hook of the e2e variant), `unknown` for a code this version does not know. */
  readonly category: MediaCategory | 'unknown' | null;
  readonly mediaType: 'photo' | 'video';
  /** When the file was taken (ms): the time of the capture, not of the last change. */
  readonly capturedAt: number;
}

export interface MediaUploadsSnapshot {
  readonly files: readonly MediaFileView[];
  /** Whether the system lets the app show notifications (Android 13+ consent and the switch in the settings). */
  readonly notifications: 'granted' | 'denied';
}

/** What the Queue needs of the queue of files. */
export interface MediaControl {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => MediaUploadsSnapshot;
  /** "Ponów": hands the job to the system again; `false` = nothing to retry (a quarantined file has no retry). */
  retry(assetId: string): Promise<boolean>;
  /**
   * "Usuń z telefonu" (EVM-108 AC6; security 19): a file of "Wymaga uwagi" that cannot be retried (`quarantined`, `id_conflict`, `missing_original`).
   * The native file (the job and the original) goes FIRST, the row after; a refusal of the module leaves the row. `false` = nothing was removed.
   */
  discard(assetId: string): Promise<boolean>;
  /** The system consent for notifications (after the explaining sheet). */
  requestNotifications(): Promise<'granted' | 'denied'>;
  /** "Włącz powiadomienia" of the Banner: the notification settings of the app. */
  openNotificationSettings(): Promise<boolean>;
  /** Where the touch of the notification sent the user; one read; a value of a fixed set. */
  consumeLaunchTarget(): 'queue' | null;
  /** The save of the pictures of ONE opening of the camera (EVM-108): `takePicture` is the source of the picture, the rest is the durable save of the session. */
  capturePipeline(takePicture: CapturePorts['takePicture']): CapturePipeline;
  /** Free bytes of the storage of the app (`null` = unknown) for the warning of the camera. */
  freeDiskBytes(): number | null;
  /** Return to the foreground: the permission and the view are read again, the files are reconciled. */
  refresh(): Promise<void>;
}

export const NO_MEDIA_FILES: MediaUploadsSnapshot = { files: [], notifications: 'granted' };

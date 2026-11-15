/**
 * Types of the files of the queue that screens may import (EVM-130): no runtime dependency on the service, the store or the module
 * (dependency-cruiser `mobile-screens-without-adapters`). The screens read `MediaUploadsSnapshot` and call `MediaControl`.
 */
export type MediaFileStatus = 'waiting' | 'uploading' | 'sent' | 'error' | 'attention';
export type MediaFileAction = 'retry';

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
  /** The system consent for notifications (after the explaining sheet). */
  requestNotifications(): Promise<'granted' | 'denied'>;
  /** "Włącz powiadomienia" of the Banner: the notification settings of the app. */
  openNotificationSettings(): Promise<boolean>;
  /** Where the touch of the notification sent the user; one read; a value of a fixed set. */
  consumeLaunchTarget(): 'queue' | null;
  /** Return to the foreground: the permission and the view are read again, the files are reconciled. */
  refresh(): Promise<void>;
}

export const NO_MEDIA_FILES: MediaUploadsSnapshot = { files: [], notifications: 'granted' };

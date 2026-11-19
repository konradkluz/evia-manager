/**
 * Types of the files of the queue that screens may import (EVM-130): no runtime dependency on the service, the store or the module
 * (dependency-cruiser `mobile-screens-without-adapters`). The screens read `MediaUploadsSnapshot` and call `MediaControl`.
 */
import type { CapturePipeline, CapturePorts, VideoSource } from '../capture/capture-pipeline';
import type { MediaCategory } from './create-media-asset';

/**
 * `waiting_wifi` (EVM-110 AC4): a film that waits for a network without charges - not an error, not "Wymaga uwagi". There is no "sent" (EVM-111 AC5): the
 * entry of a file leaves the phone when the server confirms it, so every entry is a file that is still to be sent or confirmed.
 */
export type MediaFileStatus = 'waiting' | 'waiting_wifi' | 'uploading' | 'error' | 'attention';
export type MediaFileAction = 'retry' | 'discard';

export interface MediaFileView {
  readonly assetId: string;
  /** The order of the file - only for the filter of "Pliki zlecenia" (EVM-111); never rendered, never in an accessible name or a log. */
  readonly workOrderId: string;
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
  /** The length of a film in milliseconds (EVM-110); `null` for a picture and for a row without it. */
  readonly durationMs?: number | null;
  /** When the file was taken (ms): the time of the capture, not of the last change. */
  readonly capturedAt: number;
  /** The file waits for a site survey that is still only in the queue ("Wyślemy po utworzeniu wizji"; EVM-137). */
  readonly awaitsSurvey?: boolean;
  /** The transfer is done (the module reported it) and the server has not confirmed the file yet; the view says "Wysyła się 100%" (EVM-111 AC2, AC5). */
  readonly awaitsConfirmation?: boolean;
}

export interface MediaUploadsSnapshot {
  readonly files: readonly MediaFileView[];
  /** Whether the system lets the app show notifications (Android 13+ consent and the switch in the settings). */
  readonly notifications: 'granted' | 'denied';
  /** How many entries of confirmed files were removed since the start (EVM-111): a rise tells the screens that a file was SENT (not discarded). Absent = 0. */
  readonly confirmed?: number;
  /**
   * EVM-111 AC3: `loading` until the first read of the local table ends, `failed` when the last read failed (the rows are then unknown, nothing was changed),
   * `ready` otherwise. Absent = `ready`.
   */
  readonly read?: 'loading' | 'ready' | 'failed';
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
  capturePipeline(takePicture: CapturePorts['takePicture'], video?: VideoSource): CapturePipeline;
  /**
   * EVM-110 AC3 (SEC-110-12): stops the recording in progress, if any, and waits for its save - at most [timeoutMs] (default 3 s). Called before a
   * sign-out, a lock-out or a wipe cleans anything; never throws.
   */
  stopRecording(timeoutMs?: number): Promise<void>;
  /**
   * EVM-110 AC4: the setting "Filmy tylko przez Wi-Fi" (a local value of the phone, default `true`, stays after the sign-out). Only `video/*` files wait
   * for a network without charges; pictures and entries go through any network.
   */
  videoWifiOnly(): boolean;
  /** Stores the setting (the module hands the unfinished films to the system again) and refreshes the rows; `false` = the value was not stored. */
  setVideoWifiOnly(value: boolean): Promise<boolean>;
  /** EVM-110 AC3: `true` when a start found a recording killed with the process (reading does not remove the marker). */
  consumeInterruptedRecording(): Promise<boolean>;
  /** The notice of the killed recording was shown: removes the marker (reading it does not). */
  dismissInterruptedRecording(): Promise<void>;
  /** EVM-110 AC3: keeps the screen on while a film is recorded (`true`) and lets it sleep again (`false`). */
  keepScreenOn(on: boolean): void;
  /** Free bytes of the storage of the app (`null` = unknown) for the warning of the camera. */
  freeDiskBytes(): number | null;
  /** Return to the foreground: the permission and the view are read again, the files are reconciled. */
  refresh(): Promise<void>;
  /** EVM-111 AC3: reads the table of files again - ONLY a read: no file, row or job is touched ("Spróbuj ponownie" of a failed read). */
  reload(): Promise<void>;
}

export const NO_MEDIA_FILES: MediaUploadsSnapshot = { files: [], notifications: 'granted' };

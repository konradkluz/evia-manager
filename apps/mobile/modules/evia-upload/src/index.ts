/**
 * Typed binding of the native module `EviaUpload` (EVM-130, ADR-0020/0020a): the background upload of files, the OWNER of the tokens and
 * the private notification, in Kotlin (`../android`). This file is types and one loader - no logic. The adapters of the app
 * (SessionOwner, the token store, the Queue) are written against `EviaUploadModule`; the full description of every function, answer and
 * event is in `../README.md`.
 *
 * What the interface does NOT have, on purpose (EVM-130 AC3, SR-SESS-09): a function that returns a refresh token or a revocation token,
 * and a function that takes the bytes of a file. Tokens go IN once (`stageLogin`, `commitLogin`: write only), out comes the access
 * token (`accessToken`) with how long it holds; a file lies in the private directory of the app under the name of its UUID and the
 * native side reads it itself.
 */
import { requireOptionalNativeModule } from 'expo';

export const EVIA_UPLOAD_MODULE_NAME = 'EviaUpload';

export type SessionStateName = 'signed_out' | 'signed_in' | 'needs_login' | 'paused_revoked' | 'paused_update' | 'wipe_required';

/** `unavailable`: the build has no usable API address (or there is no module): the module answers this to the session functions. */
export type Availability = 'unavailable';

/**
 * The build has the API address (the session works) but no storage hosts (`EVIA_STORAGE_HOSTS`): the functions that SEND files answer this
 * - `armUpload`, `retryUpload`, every item of `reconcile` - without an exception and without a request; `uploadStatuses` is empty. It is
 * NOT a missing session: the app treats the files as waiting ("oczekuje") and signs in as usual. Contrast `unavailable`: no API address
 * at all (or no module), and then nothing works.
 */
export type UploadUnavailable = 'upload_unavailable';

export type StageLoginResult = 'ok' | 'invalid' | Availability;
export type CommitStagedResult = 'ok' | 'storage_failed' | 'nothing_staged' | Availability;
export type CommitLoginResult = 'ok' | 'invalid' | 'storage_failed' | Availability;

export type AccessTokenResult =
  | { readonly status: 'ready'; readonly accessToken: string; readonly ownerId: string; readonly validForMs: number }
  | { readonly status: 'retry_later' }
  | { readonly status: 'blocked'; readonly state: SessionStateName }
  | { readonly status: Availability };

export interface SessionStateResult {
  readonly state: SessionStateName | Availability;
  /** `userId:deviceId` of the signed-in session, else `null`. Not a secret. */
  readonly ownerId: string | null;
}

/** The answer of arming a file; `armed_user_initiated` and `armed` are both "the system has the job". */
export type ArmResultName =
  | 'armed_user_initiated'
  | 'armed'
  | 'already_armed'
  | 'missing_original'
  | 'invalid'
  | 'wipe_active'
  | 'failed'
  | UploadUnavailable
  | Availability;

/** What the app shows for a file on the native side. */
export type UploadFileState = 'queued' | 'uploading' | 'uploaded' | 'paused_revoked';

export interface UploadStatus {
  readonly assetId: string;
  readonly state: UploadFileState;
  readonly partsDone: number;
  readonly partCount: number;
  /** 0..100 */
  readonly percent: number;
  readonly sizeBytes: number;
}

/**
 * One file of the queue of the app that must have a job (`reconcile`). The ids are UUIDs. `contentType` is the MIME type of the file
 * (`image/jpeg`, `video/mp4`, ...; the allow-list of the contract): the module declares it - with the size and the SHA-256 it computes
 * itself - when it opens the upload session (EVM-131), and refuses (`invalid`) a type outside the list.
 */
export interface UploadItem {
  readonly assetId: string;
  readonly workOrderId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly contentType: string;
}

/**
 * The answer of `importOriginal` (EVM-108): a short code, never a path or a message. `unavailable` = no native module / no configuration.
 */
export type ImportResultName = 'ok' | 'invalid' | 'source_missing' | 'no_space' | 'io_error' | 'wipe_active' | 'exists' | 'unavailable';

export interface OriginalDigest {
  readonly sizeBytes: number;
  /** Lower-case hex, 64 characters. */
  readonly sha256: string;
}

/** What to do with the local original after the server's state of the file (`completeUpload`). */
export type OriginalVerdictName = 'delete' | 'keep' | 'keep_and_retry' | 'keep_quarantined';

export interface LastContact {
  readonly wallMs: number;
  readonly monoMs: number;
  /** In the form of the JavaScript `ContactClock`: `boot-<counter>` or `boot-w<minutes>`. */
  readonly bootId: string;
  readonly serverTimeMs: number | null;
}

export type NotificationPermissionName = 'granted' | 'denied';

/** Where the notification sent the user; a value of the fixed set, navigation only. */
export type LaunchTarget = 'queue';

/** The state of a file after a run of its job (`onFileState`). */
export type FileEventState =
  'uploaded' | 'queued' | 'paused_revoked' | 'paused_update' | 'wrong_owner' | 'needs_attention' | 'wiped' | 'dropped';

/** Throttled: at most one per second per file, the end of a file and a pause always come. */
export interface UploadProgressEvent extends UploadStatus {
  readonly state: UploadFileState;
}

export interface FileStateEvent {
  readonly assetId: string;
  readonly state: FileEventState;
  /** `needs_attention`: the reason (`id_conflict`, `quarantined`, `plan_mismatch`, ...); `queued`: `checksum_mismatch` ("Ponów"); else `null`. */
  readonly reason: string | null;
}

/** The session needs something from the user: `needs_login` (also `signed_out`), `paused_revoked`, `paused_update`, `wipe_required`. */
export interface SessionStateEvent {
  readonly state: SessionStateName;
}

/** The names of the events, as the Kotlin module declares them (`Events(...)`). */
export const EVIA_UPLOAD_EVENTS = [
  'onUploadProgress',
  'onFileState',
  'onSessionState',
] as const satisfies readonly (keyof EviaUploadEvents)[];

export interface EviaUploadEvents {
  onUploadProgress: (event: UploadProgressEvent) => void;
  onFileState: (event: FileStateEvent) => void;
  onSessionState: (event: SessionStateEvent) => void;
}

export interface EventSubscription {
  remove(): void;
}

export interface EviaUploadModule {
  // session: tokens go in once (write only), the access token comes out
  stageLogin(
    userId: string,
    deviceId: string,
    refreshToken: string,
    accessToken: string,
    accessValidForMs: number,
    serverTimeMs: number | null,
  ): Promise<StageLoginResult>;
  commitStaged(sameInstallation: boolean): Promise<CommitStagedResult>;
  abandonStaged(): Promise<'ok' | Availability>;
  commitLogin(
    userId: string,
    deviceId: string,
    refreshToken: string,
    accessToken: string,
    accessValidForMs: number,
    sameInstallation: boolean,
    serverTimeMs: number | null,
  ): Promise<CommitLoginResult>;
  accessToken(rejected: string | null): Promise<AccessTokenResult>;
  reportApiRevoked(): Promise<boolean>;
  reportDeviceWipeRequired(): Promise<boolean>;
  reportUpdateRequired(): Promise<boolean>;
  signOut(online: boolean): Promise<boolean>;
  flushPendingRevocations(): Promise<boolean>;
  sessionState(): Promise<SessionStateResult>;
  clearWipeMarkerAfterLogin(): Promise<boolean>;
  // files and jobs
  originalPath(assetId: string): Promise<string | null>;
  digestOriginal(assetId: string): Promise<OriginalDigest | null>;
  /**
   * EVM-108: makes the picture the camera wrote (`file://` URI in the capture cache of the app) the durable original of [assetId]:
   * checked natively, copied with `fsync`, the source removed. Only a code comes back.
   */
  importOriginal(assetId: string, sourceUri: string): Promise<ImportResultName>;
  /**
   * EVM-108: removes originals nobody knows (not in [keepAssetIds], older than [olderThanMs]), leftovers of imports and old pictures of
   * the camera cache. Resolves the number of removed files (`0` when unavailable).
   */
  sweepOriginals(keepAssetIds: readonly string[], olderThanMs: number): Promise<number>;
  armUpload(
    assetId: string,
    workOrderId: string,
    userId: string,
    deviceId: string,
    wifiOnly: boolean,
    contentType: string | null,
  ): Promise<ArmResultName>;
  reconcile(items: readonly UploadItem[], wifiOnly: boolean): Promise<Readonly<Record<string, ArmResultName>>>;
  retryUpload(assetId: string, wifiOnly: boolean): Promise<ArmResultName>;
  cancelUpload(assetId: string, deleteOriginal: boolean): Promise<boolean>;
  completeUpload(assetId: string, serverState: string, reasonCode: string | null): Promise<OriginalVerdictName | 'invalid' | Availability>;
  uploadStatuses(): Promise<readonly UploadStatus[]>;
  wipeUploads(): Promise<boolean>;
  lastContact(): Promise<LastContact | null>;
  // notifications
  notificationPermission(): NotificationPermissionName;
  requestNotificationPermission(): Promise<NotificationPermissionName>;
  openNotificationSettings(): Promise<boolean>;
  launchTarget(): LaunchTarget | null;
  /** E2E package only: a synthetic file as the original of the asset; `null` (and nothing written) in every other package. */
  e2eInjectFile(assetId: string, sizeBytes: number, seed: number): Promise<OriginalDigest | null>;
  // events
  addListener<K extends keyof EviaUploadEvents>(eventName: K, listener: EviaUploadEvents[K]): EventSubscription;
}

/**
 * The names of the functions of the module, in the order of `EviaUploadModule` (the type checks every name). A test compares them with the
 * `AsyncFunction` / `Function` definitions of `EviaUploadModule.kt`, so the binding cannot drift from the native side.
 */
export const EVIA_UPLOAD_FUNCTIONS = [
  'stageLogin',
  'commitStaged',
  'abandonStaged',
  'commitLogin',
  'accessToken',
  'reportApiRevoked',
  'reportDeviceWipeRequired',
  'reportUpdateRequired',
  'signOut',
  'flushPendingRevocations',
  'sessionState',
  'clearWipeMarkerAfterLogin',
  'originalPath',
  'digestOriginal',
  'importOriginal',
  'sweepOriginals',
  'armUpload',
  'reconcile',
  'retryUpload',
  'cancelUpload',
  'completeUpload',
  'uploadStatuses',
  'wipeUploads',
  'lastContact',
  'notificationPermission',
  'requestNotificationPermission',
  'openNotificationSettings',
  'launchTarget',
  'e2eInjectFile',
] as const satisfies readonly Exclude<keyof EviaUploadModule, 'addListener'>[];

/** The native module, or `null` where it does not exist (Jest, another platform): the callers treat `null` as "no background upload". */
export function loadEviaUpload(): EviaUploadModule | null {
  return requireOptionalNativeModule<EviaUploadModule>(EVIA_UPLOAD_MODULE_NAME);
}

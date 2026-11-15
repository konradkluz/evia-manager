/**
 * The queue of files of the phone (EVM-130 AC1, AC4, AC6; architect 6, 7; media-pipeline.md §1–§3): the JavaScript side of the upload
 * that the native module performs in the background. It owns NO bytes and NO tokens — only the durable rows of `media_files` (identifiers,
 * digest, state), the calls that hand a file to the system and the view of the Queue.
 * - the job of the system is armed only AFTER the server applied `CreateMediaAsset` (the same transaction that settles the mutation
 *   marks the row `applied`); at start, on return to the foreground and after every synchronization each `applied` row is armed again,
 *   idempotently (a file in `needs_attention` waits for "Ponów");
 * - the original stays until the replica says `clean` (not before: `uploaded` of the module, `processing`, `ready` change nothing);
 *   `failed` + `checksum_mismatch` is "Ponów", `quarantined` is "Wymaga uwagi", the row stays after `clean`;
 * - the percentage comes from the native status and its events and is never written to the database;
 * - a command that is in the queue without a row (the process died between the two writes) is repaired from its payload and the
 *   digest of the original — nothing the technician registered is lost.
 * The view carries no order, name, address or path: it is the same in the hidden-data mode (the upload goes on there, SR-MOB-05).
 */
import type { EnqueueInput } from '@evia/sync-core';
import type { FileStateEvent, UploadProgressEvent, UploadStatus } from '../../modules/evia-upload/src';
import type { MediaFileRecord, MediaFileState } from '../storage/media-file-store';
import type { UnlockedStore } from '../storage';
import { createMediaAssetInput, type NewMediaAsset } from './create-media-asset';
import type { NativeUpload } from './native-upload';
import type { MediaControl, MediaFileView, MediaUploadsSnapshot } from './types';

export type { MediaControl, MediaFileAction, MediaFileStatus, MediaFileView, MediaUploadsSnapshot } from './types';

export type AddMediaResult =
  { readonly ok: true } | { readonly ok: false; readonly code: 'invalid' | 'no_session' | 'missing_original' | 'enqueue_failed' };

export interface MediaUploadsDeps {
  readonly native: NativeUpload;
  /** The store of the signed-in owner (`null` without a session). */
  readonly store: () => UnlockedStore | null;
  /** The queue of the synchronization (`SyncControl.enqueue`): resolves with the id of the new mutation. */
  readonly enqueue: (input: EnqueueInput) => Promise<{ readonly ok: boolean; readonly mutationId?: string }>;
  readonly now: () => number;
  /** "Filmy tylko przez Wi-Fi" (EVM-110); `false` until that option exists. */
  readonly wifiOnly?: () => boolean;
  /** `false` in the hidden-data mode: nothing is read from the replica then. */
  readonly dataVisible: () => boolean;
  /** After an event of the module (the contact of a refresh made in the background is merged, EVM-130 architect 9). */
  readonly onNativeEvent?: () => void;
}

/** Files confirmed by the server stay in the view as "Wysłano" this many (newest first). */
export const CLEAN_KEPT = 20;
const EMPTY: MediaUploadsSnapshot = { files: [], notifications: 'granted' };

const mimeOf = (mediaType: unknown): string => (mediaType === 'video' ? 'video/mp4' : 'image/jpeg');

export class MediaUploads implements MediaControl {
  readonly #deps: MediaUploadsDeps;
  readonly #listeners = new Set<() => void>();
  readonly #progress = new Map<string, UploadStatus>();
  #snapshot: MediaUploadsSnapshot = EMPTY;
  #running: Promise<void> | undefined;
  #again = false;
  #subscriptions: { remove(): void }[] = [];

  constructor(deps: MediaUploadsDeps) {
    this.#deps = deps;
  }

  // ---- state for the screens ------------------------------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getSnapshot = (): MediaUploadsSnapshot => this.#snapshot;

  #publish(next: MediaUploadsSnapshot): void {
    this.#snapshot = next;
    for (const listener of [...this.#listeners]) listener();
  }

  /** Listens to the module (alive while the app runs; a job in the background without JavaScript loses nothing: its state is in files). */
  start(): void {
    if (this.#subscriptions.length > 0) return;
    const { native } = this.#deps;
    this.#subscriptions = [
      native.addListener('onUploadProgress', (event) => {
        this.#onProgress(event);
      }),
      native.addListener('onFileState', (event) => {
        void this.#onFileState(event);
      }),
      native.addListener('onSessionState', () => {
        this.#deps.onNativeEvent?.();
      }),
    ];
  }

  stop(): void {
    for (const subscription of this.#subscriptions) subscription.remove();
    this.#subscriptions = [];
  }

  #onProgress(event: UploadProgressEvent): void {
    this.#progress.set(event.assetId, event);
    void this.#rebuild();
  }

  async #onFileState(event: FileStateEvent): Promise<void> {
    this.#deps.onNativeEvent?.();
    const store = this.#deps.store();
    if (store === null) return;
    try {
      const at = this.#deps.now();
      if (event.state === 'uploaded') await this.#moveTo(store, event.assetId, ['applied'], 'uploaded', null, at);
      else if (event.state === 'needs_attention')
        await this.#moveTo(store, event.assetId, ['applied', 'uploaded'], 'needs_attention', event.reason, at);
      else if (event.state === 'queued' && event.reason === 'checksum_mismatch') {
        await this.#moveTo(store, event.assetId, ['applied', 'uploaded'], 'failed', 'checksum_mismatch', at);
      }
      if (event.state !== 'queued') this.#progress.delete(event.assetId);
    } catch {
      // the row keeps its state; the next reconcile asks the module again
    }
    await this.#rebuild();
  }

  /** Changes the state of a row when it is in one of the `from` states (a late event never undoes a later decision). */
  async #moveTo(
    store: UnlockedStore,
    assetId: string,
    from: readonly MediaFileState[],
    to: MediaFileState,
    code: string | null,
    at: number,
  ): Promise<void> {
    const row = (await store.media.list()).find((file) => file.assetId === assetId);
    if (row !== undefined && from.includes(row.state)) await store.media.setState(assetId, to, code, at);
  }

  // ---- adding a file --------------------------------------------------------------------------------------------------------

  /**
   * A file the native side already holds in its private directory (the camera of EVM-108, or the hook of the e2e variant) becomes a
   * command in the durable queue and a row of the table of files. The command is saved BEFORE the row: a kill in between leaves a
   * command that the next reconcile repairs, never a row without a command. Nothing is uploaded yet — the job is armed after `applied`.
   */
  async add(asset: NewMediaAsset): Promise<AddMediaResult> {
    const input = createMediaAssetInput(asset);
    if (input === null) return { ok: false, code: 'invalid' };
    const store = this.#deps.store();
    if (store === null) return { ok: false, code: 'no_session' };
    const digest = await this.#deps.native.digestOriginal(asset.assetId).catch(() => null);
    if (digest === null) return { ok: false, code: 'missing_original' };
    const queued = await this.#deps.enqueue(input).catch(() => ({ ok: false }) as const);
    if (!queued.ok || queued.mutationId === undefined) return { ok: false, code: 'enqueue_failed' };
    try {
      await store.media.register({
        assetId: asset.assetId,
        mutationId: queued.mutationId,
        workOrderId: asset.workOrderId,
        ownerUserId: store.userId,
        fileName: asset.assetId,
        sizeBytes: digest.sizeBytes,
        sha256: digest.sha256,
        mime: mimeOf(asset.mediaType),
        createdAt: this.#deps.now(),
      });
    } catch {
      // repaired by the next reconcile from the command in the queue
    }
    void this.reconcile();
    return { ok: true };
  }

  // ---- reconciliation -------------------------------------------------------------------------------------------------------

  /** Start, return to the foreground, after a synchronization, after an event: single-flight, one more run when asked meanwhile. */
  reconcile(): Promise<void> {
    if (this.#running !== undefined) {
      this.#again = true;
      return this.#running;
    }
    this.#running = this.#run().finally(() => {
      this.#running = undefined;
      if (this.#again) {
        this.#again = false;
        void this.reconcile();
      }
    });
    return this.#running;
  }

  async #run(): Promise<void> {
    const store = this.#deps.store();
    if (store === null) {
      this.#publish(EMPTY);
      return;
    }
    try {
      await this.#repairOrphans(store);
      await this.#arm(store);
      await this.#syncStatuses(store);
      await this.#confirm(store);
    } catch {
      // a failing store or module leaves the rows as they are; the next run starts again
    }
    await this.#rebuild();
  }

  /** Commands of the queue whose row is missing (the process died between the two writes of `add`): the row is written again. */
  async #repairOrphans(store: UnlockedStore): Promise<void> {
    const known = new Set((await store.media.list()).map((file) => file.assetId));
    for (const raw of await store.queue.readAll()) {
      if (typeof raw !== 'object' || raw === null) continue;
      const record = raw as Record<string, unknown>;
      const payload =
        typeof record['payload'] === 'object' && record['payload'] !== null ? (record['payload'] as Record<string, unknown>) : {};
      const { mutationId, ownerUserId, createdAt } = record;
      const { id, workOrderId, mediaType } = payload;
      if (record['type'] !== 'CreateMediaAsset' || ownerUserId !== store.userId) continue;
      if (typeof id !== 'string' || typeof workOrderId !== 'string' || typeof mutationId !== 'string' || known.has(id)) continue;
      const digest = await this.#deps.native.digestOriginal(id).catch(() => null);
      if (digest === null) continue;
      await store.media
        .register({
          assetId: id,
          mutationId,
          workOrderId,
          ownerUserId: store.userId,
          fileName: id,
          sizeBytes: digest.sizeBytes,
          sha256: digest.sha256,
          mime: mimeOf(mediaType),
          createdAt: typeof createdAt === 'number' ? createdAt : this.#deps.now(),
        })
        .catch(() => undefined);
    }
  }

  /** Every `applied` file gets its job (idempotent); a file that is gone or refused goes to "Wymaga uwagi" (nothing is deleted). */
  async #arm(store: UnlockedStore): Promise<void> {
    const identity = await store.identity.read().catch(() => null);
    if (identity === null) return;
    const applied = (await store.media.list()).filter((file) => file.state === 'applied');
    if (applied.length === 0) return;
    const results = await this.#deps.native.reconcile(
      applied.map((file) => ({ assetId: file.assetId, workOrderId: file.workOrderId, userId: store.userId, deviceId: identity.deviceId })),
      this.#deps.wifiOnly?.() ?? false,
    );
    const at = this.#deps.now();
    for (const file of applied) {
      const result = results[file.assetId];
      if (result === 'missing_original' || result === 'invalid') await store.media.setState(file.assetId, 'needs_attention', result, at);
    }
  }

  /** A file the module finished while no JavaScript listened (the event was lost) is `uploaded` here too. */
  async #syncStatuses(store: UnlockedStore): Promise<void> {
    const statuses = await this.#deps.native.uploadStatuses();
    const uploaded = new Set(statuses.filter((status) => status.state === 'uploaded').map((status) => status.assetId));
    if (uploaded.size === 0) return;
    const at = this.#deps.now();
    for (const file of await store.media.list()) {
      if (file.state === 'applied' && uploaded.has(file.assetId)) await store.media.setState(file.assetId, 'uploaded', null, at);
    }
  }

  /**
   * The decision about the original comes from the REPLICA `media_asset` and from nothing else (AC4, offline-sync.md pkt 7): `clean` →
   * the original is removed (one native call) and the row stays; `failed` with `checksum_mismatch` → "Ponów" (the file stays, a new
   * session follows); `quarantined` → "Wymaga uwagi" (the file stays, no retry). What the module says (`uploaded`) and the replica
   * states `processing` / `ready` / `uploading` only mean "sent, waiting for the confirmation" — the original STAYS. `clean` is honoured
   * for a row still `applied` too (the replica came before the event of the module); a failure or a quarantine only for a row the
   * module reported as `uploaded` (after "Ponów" the replica still shows the old failure until the new upload is judged). Nothing is read
   * from the replica in the hidden-data mode.
   */
  async #confirm(store: UnlockedStore): Promise<void> {
    if (!this.#deps.dataVisible()) return;
    const waiting = (await store.media.list()).filter((file) => file.state === 'applied' || file.state === 'uploaded');
    if (waiting.length === 0) return;
    const states = await store.replicaExtras.readMediaServerStates(waiting.map((file) => file.assetId));
    const at = this.#deps.now();
    for (const file of waiting) {
      const server = states.get(file.assetId);
      if (server === undefined) continue;
      if (server.fileState === 'clean') {
        const verdict = await this.#deps.native.completeUpload(file.assetId, 'clean', null);
        if (verdict === 'delete') await store.media.setState(file.assetId, 'clean', null, at);
      } else if (file.state === 'uploaded' && server.fileState === 'failed' && server.reasonCode === 'checksum_mismatch') {
        await store.media.setState(file.assetId, 'failed', 'checksum_mismatch', at);
      } else if (file.state === 'uploaded' && server.fileState === 'quarantined') {
        await store.media.setState(file.assetId, 'needs_attention', 'quarantined', at);
      }
    }
  }

  // ---- "Ponów" --------------------------------------------------------------------------------------------------------------

  /** "Ponów": the same job is handed to the system again; the row goes back to `applied`. A quarantined file has no retry. */
  async retry(assetId: string): Promise<boolean> {
    const store = this.#deps.store();
    if (store === null) return false;
    const file = (await store.media.list()).find((row) => row.assetId === assetId);
    if (file === undefined || (file.state !== 'failed' && file.state !== 'needs_attention') || file.lastCode === 'quarantined')
      return false;
    const result = await this.#deps.native.retryUpload(assetId, this.#deps.wifiOnly?.() ?? false).catch(() => 'failed' as const);
    if (result !== 'armed_user_initiated' && result !== 'armed' && result !== 'already_armed') return false;
    await store.media.setState(assetId, 'applied', null, this.#deps.now());
    this.#progress.delete(assetId);
    await this.#rebuild();
    return true;
  }

  // ---- notifications --------------------------------------------------------------------------------------------------------

  /** The system consent (the explaining sheet is shown by the caller first); the view follows the answer. */
  async requestNotifications(): Promise<'granted' | 'denied'> {
    const answer = await this.#deps.native.requestNotificationPermission().catch(() => 'denied' as const);
    await this.#rebuild();
    return answer;
  }

  /** "Włącz powiadomienia" of the Banner: the notification settings of the app. */
  openNotificationSettings(): Promise<boolean> {
    return this.#deps.native.openNotificationSettings().catch(() => false);
  }

  /** Where the touch of the notification sent the user (one read; a value of a fixed set); `null` = nowhere. */
  consumeLaunchTarget(): 'queue' | null {
    try {
      return this.#deps.native.launchTarget();
    } catch {
      return null;
    }
  }

  /** Return to the foreground: the permission and the view are read again, every file is reconciled (armed, confirmed). */
  refresh(): Promise<void> {
    return this.reconcile();
  }

  // ---- the view -------------------------------------------------------------------------------------------------------------

  async #rebuild(): Promise<void> {
    const store = this.#deps.store();
    const notifications = this.#permission();
    if (store === null) {
      this.#publish({ files: [], notifications });
      return;
    }
    let rows: readonly MediaFileRecord[];
    try {
      rows = await store.media.list();
    } catch {
      return;
    }
    const statuses = new Map<string, UploadStatus>(this.#progress);
    if (rows.some((row) => row.state === 'applied')) {
      for (const status of await this.#deps.native.uploadStatuses().catch(() => [] as readonly UploadStatus[])) {
        if (!statuses.has(status.assetId)) statuses.set(status.assetId, status);
      }
    }
    const clean = rows
      .filter((row) => row.state === 'clean')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, CLEAN_KEPT);
    const open = rows.filter((row) => row.state !== 'clean');
    this.#publish({ files: [...open, ...clean].map((row) => viewOf(row, statuses.get(row.assetId))), notifications });
  }

  #permission(): 'granted' | 'denied' {
    try {
      return this.#deps.native.notificationPermission();
    } catch {
      return 'granted';
    }
  }
}

function viewOf(row: MediaFileRecord, status: UploadStatus | undefined): MediaFileView {
  const base = { assetId: row.assetId, sizeBytes: row.sizeBytes, updatedAt: row.updatedAt, code: row.lastCode };
  switch (row.state) {
    case 'pending':
      return { ...base, status: 'waiting', percent: null, actions: [] };
    case 'applied':
      return status?.state === 'uploading'
        ? { ...base, status: 'uploading', percent: Math.max(0, Math.min(100, Math.round(status.percent))), actions: [] }
        : { ...base, status: 'waiting', percent: null, actions: [] };
    case 'uploaded':
    case 'clean':
      return { ...base, status: 'sent', percent: null, actions: [] };
    case 'failed':
      return { ...base, status: 'error', percent: null, actions: ['retry'] };
    case 'needs_attention':
      return { ...base, status: 'attention', percent: null, actions: row.lastCode === 'quarantined' ? [] : ['retry'] };
  }
}

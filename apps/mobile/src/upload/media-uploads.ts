/**
 * The queue of files of the phone (EVM-130 AC1, AC4, AC6; architect 6, 7; media-pipeline.md §1–§3): the JavaScript side of the upload
 * that the native module performs in the background. It owns NO bytes and NO tokens — only the durable rows of `media_files` (identifiers,
 * digest, state), the calls that hand a file to the system and the view of the Queue.
 * - the job of the system is armed only AFTER the server applied `CreateMediaAsset` (the same transaction that settles the mutation
 *   marks the row `applied`); at start, on return to the foreground and after every synchronization each `applied` row is armed again,
 *   idempotently (a file in `needs_attention` waits for "Ponów");
 * - the original stays until the replica says `clean`, `processing` or `ready` (the last two follow `clean` only, and the replica keeps
 *   just the latest state, so `clean` may never be seen; the native OriginalPolicy decides; `uploaded` of the module changes nothing);
 *   `failed` + `checksum_mismatch` is "Ponów", `quarantined` is "Wymaga uwagi", the row stays after `clean`;
 * - the percentage comes from the native status and its events and is never written to the database;
 * - a command that is in the queue without a row (the process died between the two writes) is repaired from its payload and the
 *   digest of the original — nothing the technician registered is lost.
 * The view carries no order, name, address or path: it is the same in the hidden-data mode (the upload goes on there, SR-MOB-05).
 */
import type { EnqueueInput } from '@evia/sync-core';
import type { FileStateEvent, OriginalDigest, UploadProgressEvent, UploadStatus } from '../../modules/evia-upload/src';
import type { MediaFileRecord, MediaFileState } from '../storage/media-file-store';
import type { UnlockedStore } from '../storage';
import {
  createCapturedPhotoInput,
  createMediaAssetInput,
  type AddMediaResult,
  type CapturedPhoto,
  type NewMediaAsset,
} from './create-media-asset';
import { CapturePipeline, type CapturePorts } from '../capture/capture-pipeline';
import type { DiskSpace } from '../capture/disk-space';
import type { NativeUpload } from './native-upload';
import type { MediaControl, MediaFileView, MediaUploadsSnapshot } from './types';

export type { MediaControl, MediaFileAction, MediaFileStatus, MediaFileView, MediaUploadsSnapshot } from './types';

export type { AddMediaResult };

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
  /** The camera (EVM-108): the free space and the id generator of the session; without them a picture cannot be taken (`camera_failed`). */
  readonly capture?: { readonly disk: DiskSpace; readonly newId: () => string };
}

/** Files confirmed by the server stay in the view as "Wysłano" this many (newest first). */
export const CLEAN_KEPT = 20;
/**
 * The sweep of the module removes only files older than this (EVM-108): a picture that is being saved right now has no row yet and is never touched.
 */
export const SWEEP_MIN_AGE_MS = 10 * 60 * 1000;
const EMPTY: MediaUploadsSnapshot = { files: [], notifications: 'granted' };

/** The codes of "Wymaga uwagi" for which "Usuń z telefonu" is offered (EVM-108 AC6, decision of Konrad 2026-11-15). */
const DISCARDABLE_CODES: readonly string[] = ['quarantined', 'id_conflict', 'missing_original'];
const isDiscardable = (code: string | null): boolean => code !== null && DISCARDABLE_CODES.includes(code);

const mimeOf = (mediaType: unknown): string => (mediaType === 'video' ? 'video/mp4' : 'image/jpeg');

export class MediaUploads implements MediaControl {
  readonly #deps: MediaUploadsDeps;
  readonly #listeners = new Set<() => void>();
  readonly #progress = new Map<string, UploadStatus>();
  /** Files retried by the user whose replica may still show the old failure. */
  readonly #retried = new Set<string>();
  #snapshot: MediaUploadsSnapshot = EMPTY;
  #running: Promise<void> | undefined;
  #again = false;
  #againSweep = false;
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
    // no sweep here: a series of 30 shots would sweep 30 times; the start, the return to the foreground and the end of a cycle sweep
    void this.reconcile({ sweep: false });
    return { ok: true };
  }

  /**
   * A picture the native import made the durable original (EVM-108 AC1): the command `CreateMediaAsset` and the row of the file are written in
   * ONE transaction of the encrypted database (`registerPendingMedia` + `enqueue`; the row takes the mutation id of the command, its time is the
   * time of the capture). The file was made durable BEFORE this call; the caller removes it when this answers a failure. Nothing is uploaded
   * yet — the job is armed after `applied`.
   */
  async addCaptured(photo: CapturedPhoto, digest: OriginalDigest): Promise<AddMediaResult> {
    const input = createCapturedPhotoInput(photo);
    if (input === null) return { ok: false, code: 'invalid' };
    const store = this.#deps.store();
    if (store === null) return { ok: false, code: 'no_session' };
    store.queue.registerPendingMedia({
      assetId: photo.assetId,
      workOrderId: photo.workOrderId,
      ownerUserId: store.userId,
      fileName: photo.assetId,
      sizeBytes: digest.sizeBytes,
      sha256: digest.sha256,
      mime: mimeOf('photo'),
      createdAt: Date.parse(photo.capturedAt),
      category: photo.category,
    });
    let queued: { readonly ok: boolean; readonly mutationId?: string };
    try {
      queued = await this.#deps.enqueue(input);
    } catch {
      queued = { ok: false };
    } finally {
      // a registration that was not used up (the command was refused before the store) must not wait for another command
      store.queue.clearPendingMedia(photo.assetId);
    }
    if (!queued.ok || queued.mutationId === undefined) return { ok: false, code: 'enqueue_failed' };
    void this.reconcile({ sweep: false });
    return { ok: true };
  }

  capturePipeline(takePicture: CapturePorts['takePicture']): CapturePipeline {
    const capture = this.#deps.capture;
    return new CapturePipeline({
      takePicture: capture === undefined ? () => Promise.resolve(null) : takePicture,
      native: this.#deps.native,
      disk: capture?.disk ?? { freeBytes: () => null },
      registerAndEnqueue: (photo, digest) => this.addCaptured(photo, digest),
      now: this.#deps.now,
      newId: capture?.newId ?? (() => ''),
    });
  }

  freeDiskBytes(): number | null {
    return this.#deps.capture?.disk.freeBytes() ?? null;
  }

  // ---- reconciliation -------------------------------------------------------------------------------------------------------

  /** Start, return to the foreground, after a synchronization, after an event: single-flight, one more run when asked meanwhile. */
  reconcile({ sweep = true }: { readonly sweep?: boolean } = {}): Promise<void> {
    if (this.#running !== undefined) {
      this.#again = true;
      this.#againSweep ||= sweep;
      return this.#running;
    }
    this.#running = this.#run(sweep).finally(() => {
      this.#running = undefined;
      if (this.#again) {
        const sweepAgain = this.#againSweep;
        this.#again = false;
        this.#againSweep = false;
        void this.reconcile({ sweep: sweepAgain });
      }
    });
    return this.#running;
  }

  async #run(sweep: boolean): Promise<void> {
    const store = this.#deps.store();
    if (store === null) {
      this.#publish(EMPTY);
      return;
    }
    try {
      await this.#repairOrphans(store);
      if (sweep) await this.#sweep(store);
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

  /**
   * The native sweep (EVM-108): originals nobody knows and leftovers of imports go; every file of a row that is not `clean` is kept, whatever its
   * state. Only files older than [SWEEP_MIN_AGE_MS] — a picture saved right now has no row yet.
   */
  async #sweep(store: UnlockedStore): Promise<void> {
    const keep = (await store.media.list()).filter((file) => file.state !== 'clean').map((file) => file.assetId);
    await this.#deps.native.sweepOriginals(keep, SWEEP_MIN_AGE_MS).catch(() => 0);
  }

  /** Every `applied` file gets its job (idempotent); a file that is gone or refused goes to "Wymaga uwagi" (nothing is deleted). */
  async #arm(store: UnlockedStore): Promise<void> {
    const identity = await store.identity.read().catch(() => null);
    if (identity === null) return;
    const applied = (await store.media.list()).filter((file) => file.state === 'applied');
    if (applied.length === 0) return;
    const results = await this.#deps.native.reconcile(
      applied.map((file) => ({
        assetId: file.assetId,
        workOrderId: file.workOrderId,
        userId: store.userId,
        deviceId: identity.deviceId,
        // the module declares the type in the upload session (EVM-131); the size and the SHA-256 it computes itself
        contentType: file.mime,
      })),
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
   * (or `processing` / `ready`) the original is removed (one native call) and the row stays; `failed` with `checksum_mismatch` → "Ponów" (the file stays, a new
   * session follows); `quarantined` → "Wymaga uwagi" (the file stays, no retry). What the module says (`uploaded`) and the replica
   * states `pending` / `uploading` only mean "sent, waiting for the confirmation" — the original STAYS. `clean` is honoured
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
      // after "Ponów" the replica still carries the old failure until the new upload is judged: it is not honoured (the new failure
      // comes from the module event); any other state of the replica ends the protection
      if (server.fileState !== 'failed') this.#retried.delete(file.assetId);
      if (server.fileState === 'clean' || server.fileState === 'processing' || server.fileState === 'ready') {
        // `processing` and `ready` follow `clean` only (SR-FILE-05); the replica keeps the last state, so `clean` may never be seen
        const verdict = await this.#deps.native.completeUpload(file.assetId, server.fileState, null);
        if (verdict === 'delete') await store.media.setState(file.assetId, 'clean', null, at);
      } else if (
        file.state === 'uploaded' &&
        server.fileState === 'failed' &&
        server.reasonCode === 'checksum_mismatch' &&
        !this.#retried.has(file.assetId)
      ) {
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
    this.#retried.add(assetId);
    await store.media.setState(assetId, 'applied', null, this.#deps.now());
    this.#progress.delete(assetId);
    await this.#rebuild();
    return true;
  }

  // ---- "Usuń z telefonu" ------------------------------------------------------------------------------------------------------

  /**
   * "Usuń z telefonu" (EVM-108 AC6; security 19): only for a file of "Wymaga uwagi" with a code from [DISCARDABLE_CODES]. The native file goes FIRST
   * (`cancelUpload(assetId, true)`: the job and the original, no row yet); only when the module says it is gone is the row removed - a refusal
   * leaves the row and the user sees the file again, so nothing is ever left on the disk without a row. A removal of the row that fails after
   * the file is gone changes nothing for the user: the next try finds no file and ends the job.
   */
  async discard(assetId: string): Promise<boolean> {
    const store = this.#deps.store();
    if (store === null) return false;
    const file = (await store.media.list()).find((row) => row.assetId === assetId);
    if (file === undefined || file.state !== 'needs_attention' || !isDiscardable(file.lastCode)) return false;
    const removed = await this.#deps.native.cancelUpload(assetId, true).catch(() => false);
    if (!removed) return false;
    try {
      await store.media.discard(assetId);
    } catch {
      return false;
    }
    this.#progress.delete(assetId);
    this.#retried.delete(assetId);
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
  const base = {
    assetId: row.assetId,
    sizeBytes: row.sizeBytes,
    updatedAt: row.updatedAt,
    code: row.lastCode,
    category: row.category ?? null,
    mediaType: row.mime === 'video/mp4' ? ('video' as const) : ('photo' as const),
    capturedAt: row.createdAt,
  };
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
      return {
        ...base,
        status: 'attention',
        percent: null,
        actions: [
          ...(row.lastCode === 'quarantined' ? [] : (['retry'] as const)),
          ...(isDiscardable(row.lastCode) ? (['discard'] as const) : []),
        ],
      };
  }
}

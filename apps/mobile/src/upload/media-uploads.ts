/**
 * The queue of files of the phone (EVM-130 AC1, AC4, AC6; architect 6, 7; media-pipeline.md §1–§3): the JavaScript side of the upload
 * that the native module performs in the background. It owns NO bytes and NO tokens — only the durable rows of `media_files` (identifiers,
 * digest, state), the calls that hand a file to the system and the view of the Queue.
 * - the job of the system is armed only AFTER the server applied `CreateMediaAsset` (the same transaction that settles the mutation
 *   marks the row `applied`); at start, on return to the foreground and after every synchronization each `applied` row is armed again,
 *   idempotently (a file in `needs_attention` waits for "Ponów");
 * - the original stays until the replica says `clean`, `processing` or `ready` (the last two follow `clean` only, and the replica keeps
 *   just the latest state, so `clean` may never be seen; the native OriginalPolicy decides; `uploaded` of the module changes nothing);
 *   `failed` + `checksum_mismatch` is "Ponów", `quarantined` is "Wymaga uwagi"; after `clean` the original goes FIRST and the entry of the file
 *   right after it (EVM-111 AC5): no row of a file stays that the server confirmed, and no row goes without that confirmation;
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
  createCapturedVideoInput,
  createMediaAssetInput,
  type AddMediaResult,
  type CapturedPhoto,
  type CapturedVideo,
  type NewMediaAsset,
} from './create-media-asset';
import { CapturePipeline, type CapturePorts, type VideoRecording, type VideoSource } from '../capture/capture-pipeline';
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
  /** `false` in the hidden-data mode: nothing is read from the replica then. */
  readonly dataVisible: () => boolean;
  /** After an event of the module (the contact of a refresh made in the background is merged, EVM-130 architect 9). */
  readonly onNativeEvent?: () => void;
  /** The queue lost an entry behind the service of the synchronization (the rejected command of a discarded file): its counters must be read again (EVM-137 W10). */
  readonly onQueueChanged?: () => void;
  /** The camera (EVM-108): the free space and the id generator of the session; without them a picture cannot be taken (`camera_failed`). */
  readonly capture?: { readonly disk: DiskSpace; readonly newId: () => string };
  /**
   * EVM-110 AC3: a marker that outlives the process while a film is recorded (a tiny file, no data in it): present at the next start = the recording was
   * killed with the process ("Poprzednie nagranie zostało przerwane i nie zostało zapisane."), shown once. Without it the notice is never shown.
   */
  /** EVM-110: the code of the last failed save of a film (the e2e variant writes it to a file for the tool; absent in the app proper). */
  readonly filmFailure?: (code: string) => void;
  readonly recordingMarker?: {
    readonly set: () => Promise<void>;
    readonly clear: () => Promise<void>;
    readonly present: () => Promise<boolean>;
  };
}

/** How long a sign-out or a wipe waits for a recording to stop and be saved (SEC-110-12). */
const STOP_RECORDING_MS = 3000;
/**
 * The sweep of the module removes only files older than this (EVM-108): a picture that is being saved right now has no row yet and is never touched.
 */
export const SWEEP_MIN_AGE_MS = 10 * 60 * 1000;
const EMPTY: MediaUploadsSnapshot = { files: [], notifications: 'granted', confirmed: 0, read: 'loading' };

/** The codes of "Wymaga uwagi" for which "Usuń z telefonu" is offered (EVM-108 AC6, decision of Konrad 2026-11-15). */
const DISCARDABLE_CODES: readonly string[] = [
  'quarantined',
  'id_conflict',
  'missing_original',
  'order_gone',
  'survey_gone',
  'command_rejected',
];
/**
 * The codes of a file whose COMMAND the server rejected or that left the queue with a discarded group (EVM-137 AC6, W10): `order_gone` (the
 * order is deleted or not ours), `survey_gone` (the same for a site survey), `command_rejected` (any other rejection). The row of the file leaves
 * `pending` for "Wymaga uwagi" with ONLY "Usuń z telefonu": nothing is armed, nothing is retried, the file never goes to another order, and the
 * command is not a row of the Queue any more - so every such file has exactly one row, with its action.
 */
const COMMAND_CODES: readonly string[] = ['order_gone', 'survey_gone', 'command_rejected'];
const isCommandCode = (code: string | null): boolean => code !== null && COMMAND_CODES.includes(code);
const isDiscardable = (code: string | null): boolean => code !== null && DISCARDABLE_CODES.includes(code);

const mimeOf = (mediaType: unknown): string => (mediaType === 'video' ? 'video/mp4' : 'image/jpeg');

export class MediaUploads implements MediaControl {
  readonly #deps: MediaUploadsDeps;
  readonly #listeners = new Set<() => void>();
  readonly #progress = new Map<string, UploadStatus>();
  /** Files retried by the user whose replica may still show the old failure. */
  readonly #retried = new Set<string>();
  #snapshot: MediaUploadsSnapshot = EMPTY;
  /** How many entries of confirmed files this service removed (EVM-111 AC2: the screens announce "Wszystko wysłane" only after a confirmation, never after "Usuń z telefonu"). */
  #confirmed = 0;
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
      // a job that ended (done, stopped, retrying, waiting for Wi-Fi) is not "sending" any more: its last progress must not outlive it, or the row
      // hangs at "Wysyła się 37%" after the module stopped at the gate of the network (EVM-110 AC5). The next progress event brings a new one.
      this.#progress.delete(event.assetId);
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
    return this.#registerCaptured(input, photo, 'photo', digest, undefined);
  }

  async #registerCaptured(
    input: EnqueueInput,
    media: CapturedPhoto,
    mediaType: 'photo' | 'video',
    digest: OriginalDigest,
    durationMs: number | undefined,
  ): Promise<AddMediaResult> {
    const store = this.#deps.store();
    if (store === null) return { ok: false, code: 'no_session' };
    store.queue.registerPendingMedia({
      assetId: media.assetId,
      workOrderId: media.workOrderId,
      ownerUserId: store.userId,
      fileName: media.assetId,
      sizeBytes: digest.sizeBytes,
      sha256: digest.sha256,
      mime: mimeOf(mediaType),
      createdAt: Date.parse(media.capturedAt),
      category: media.category,
      ...(durationMs === undefined ? {} : { durationMs }),
    });
    let queued: { readonly ok: boolean; readonly mutationId?: string };
    try {
      queued = await this.#deps.enqueue(input);
    } catch {
      queued = { ok: false };
    } finally {
      // a registration that was not used up (the command was refused before the store) must not wait for another command
      store.queue.clearPendingMedia(media.assetId);
    }
    if (!queued.ok || queued.mutationId === undefined) return { ok: false, code: 'enqueue_failed' };
    void this.reconcile({ sweep: false });
    return { ok: true };
  }

  /** The recording in progress, if any (EVM-110): the one the session owner stops before it ends the session. */
  #recording: VideoRecording | null = null;

  async stopRecording(timeoutMs = STOP_RECORDING_MS): Promise<void> {
    const recording = this.#recording;
    // the session ends after this call: a marker left by an earlier killed recording must not show its notice to the next user (EVM-110 AC3)
    this.#mark(false);
    if (recording === null) return;
    recording.stop('interrupted');
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      recording.done.then(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]).finally(() => {
      clearTimeout(timer);
    });
  }

  #markerChain: Promise<unknown> = Promise.resolve();

  /** The marker is written when a recording starts and removed when it ends (saved or not); one write after another, a failure is only a missing notice. */
  #mark(recording: boolean): void {
    const marker = this.#deps.recordingMarker;
    if (marker === undefined) return;
    this.#markerChain = this.#markerChain.then(() => (recording ? marker.set() : marker.clear())).catch(() => undefined);
  }

  /**
   * EVM-110 AC3: `true` when a start found the marker of a recording that was killed with the process. It only READS: the marker goes with
   * `dismissInterruptedRecording`, called when the notice was SHOWN - a screen that went away before that leaves it for the next one.
   */
  async consumeInterruptedRecording(): Promise<boolean> {
    const marker = this.#deps.recordingMarker;
    if (marker === undefined || this.#recording !== null) return false;
    try {
      await this.#markerChain;
      return await marker.present();
    } catch {
      return false;
    }
  }

  /** The notice of the killed recording was shown: the marker goes, so a later start shows nothing. */
  async dismissInterruptedRecording(): Promise<void> {
    await this.#markerChain;
    await this.#deps.recordingMarker?.clear().catch(() => undefined);
  }

  videoWifiOnly(): boolean {
    try {
      return this.#deps.native.getVideoWifiOnly();
    } catch {
      return true;
    }
  }

  async setVideoWifiOnly(value: boolean): Promise<boolean> {
    const saved = await this.#deps.native.setVideoWifiOnly(value).catch(() => false);
    // the rows are read again: the module re-armed the films with the network the new value asks for
    void this.reconcile({ sweep: false });
    return saved;
  }

  /** EVM-110 AC3: the screen stays on while a film is recorded; never throws (a phone without the module just sleeps as usual). */
  keepScreenOn(on: boolean): void {
    try {
      this.#deps.native.setKeepScreenOn(on);
    } catch {
      // the screen may sleep: the recording is not affected
    }
  }

  /** The registration of a recorded film: one transaction with the command of 5 keys; the length goes to the row only. */
  async addCapturedVideo(video: CapturedVideo, digest: OriginalDigest): Promise<AddMediaResult> {
    const input = createCapturedVideoInput(video);
    if (input === null) return { ok: false, code: 'invalid' };
    return this.#registerCaptured(input, video, 'video', digest, video.durationMs);
  }

  capturePipeline(takePicture: CapturePorts['takePicture'], video?: VideoSource): CapturePipeline {
    const capture = this.#deps.capture;
    return new CapturePipeline({
      ...(video === undefined || capture === undefined
        ? {}
        : {
            video,
            registerVideo: (recorded: CapturedVideo, digest: OriginalDigest) => this.addCapturedVideo(recorded, digest),
            sessionUser: () => this.#deps.store()?.userId ?? null,
            ...(this.#deps.filmFailure === undefined ? {} : { onFailure: this.#deps.filmFailure }),
            onRecording: (recording: VideoRecording | null) => {
              this.#recording = recording;
              this.#mark(recording !== null);
            },
          }),
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

  /**
   * Resolves when no reconciliation is running or waiting for its repeat. `reconcile` starts a repeat of its own when it was asked meanwhile
   * (`add` and every event ask), and that repeat is not part of the promise the caller got: a caller that must see the final state (a test, a
   * screen that measures the Queue) waits here instead of guessing a time.
   */
  async settled(): Promise<void> {
    while (this.#running !== undefined) await this.#running;
  }

  async #run(sweep: boolean): Promise<void> {
    const store = this.#deps.store();
    if (store === null) {
      this.#publish(EMPTY);
      return;
    }
    try {
      await this.#repairOrphans(store);
      // a failing adoption never stops the arming, the sweep and the statuses below it
      await this.#adoptRejections(store).catch(() => undefined);
      // a leftover of a removal that failed (or of a version before EVM-111): the server confirmed the file and its original is gone - needs no replica,
      // so it works in the hidden-data mode too and reveals nothing
      await this.#purgeConfirmed(store).catch(() => undefined);
      if (sweep) await this.#sweep(store);
      await this.#arm(store);
      await this.#syncStatuses(store);
      await this.#confirm(store);
    } catch {
      // a failing store or module leaves the rows as they are; the next run starts again
    }
    await this.#rebuild();
  }

  /** A file whose command the server rejected: the row is "Wymaga uwagi" with a code of ours (never the message of the server). */
  async #adoptRejections(store: UnlockedStore): Promise<void> {
    const waiting = new Map((await store.media.list()).filter((file) => file.state === 'pending').map((file) => [file.mutationId, file]));
    if (waiting.size === 0) return;
    const at = this.#deps.now();
    // the orders that are (or were) site surveys: the text of the row says "Wizja została usunięta" for them
    const surveys = new Set<string>();
    try {
      for (const id of await store.replicaExtras.readSurveyMarks()) surveys.add(id);
    } catch {
      // without the marks a survey's file only gets the general words
    }
    for (const raw of await store.queue.readAll()) {
      if (typeof raw !== 'object' || raw === null) continue;
      const { mutationId, state, lastCode, ownerUserId, type, objectId } = raw as Record<string, unknown>;
      if (type === 'CreateSiteSurvey' && typeof objectId === 'string') surveys.add(objectId);
      if (typeof mutationId !== 'string' || state !== 'needs_attention' || ownerUserId !== store.userId) continue;
      const file = waiting.get(mutationId);
      if (file === undefined || typeof lastCode !== 'string') continue;
      const gone = lastCode === 'target_unavailable' || lastCode === 'forbidden';
      const code = gone ? (surveys.has(file.workOrderId) ? 'survey_gone' : 'order_gone') : 'command_rejected';
      await store.media.setState(file.assetId, 'needs_attention', code, at);
    }
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
   * The native sweep (EVM-108): originals nobody knows and leftovers of imports go; every file of a row that is still there is kept, whatever its
   * state (a row exists only for a file the server has not confirmed, and the entry goes AFTER the original, never before - EVM-111 AC5).
   * Only files older than [SWEEP_MIN_AGE_MS] — a picture saved right now has no row yet.
   */
  async #sweep(store: UnlockedStore): Promise<void> {
    const keep = (await store.media.list()).filter((file) => file.state !== 'clean').map((file) => file.assetId);
    await this.#deps.native.sweepOriginals(keep, SWEEP_MIN_AGE_MS).catch(() => 0);
  }

  /**
   * EVM-111 AC5: a row in `clean` is only a leftover - the state was written after the server confirmed the file and the module removed its original, so the
   * entry goes now (the original is gone, nothing is lost). Any other state is never touched here, whatever its age.
   */
  async #purgeConfirmed(store: UnlockedStore): Promise<void> {
    for (const file of (await store.media.list()).filter((row) => row.state === 'clean')) {
      await store.media.discardConfirmed(file.assetId);
      this.#confirmed += 1;
    }
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
        if (verdict === 'delete') await this.#removeEntry(store, file.assetId, at);
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

  /**
   * EVM-111 AC5: the module removed the original (the server confirmed the file), so the entry goes AFTER it - never before (a sweep treats an
   * original without an entry as nobody's and removes it). Only the local row; the queue of the synchronization is not touched. A removal that
   * fails leaves the row as `clean` (the view keeps it as not sent) and every next run removes it again.
   */
  async #removeEntry(store: UnlockedStore, assetId: string, at: number): Promise<void> {
    try {
      await store.media.discardConfirmed(assetId);
      this.#confirmed += 1;
    } catch {
      await store.media.setState(assetId, 'clean', null, at).catch(() => undefined);
    }
    this.#progress.delete(assetId);
    this.#retried.delete(assetId);
  }

  // ---- "Ponów" --------------------------------------------------------------------------------------------------------------

  /** "Ponów": the same job is handed to the system again; the row goes back to `applied`. A quarantined file has no retry. */
  async retry(assetId: string): Promise<boolean> {
    const store = this.#deps.store();
    if (store === null) return false;
    const file = (await store.media.list()).find((row) => row.assetId === assetId);
    if (
      file === undefined ||
      (file.state !== 'failed' && file.state !== 'needs_attention') ||
      file.lastCode === 'quarantined' ||
      isCommandCode(file.lastCode)
    )
      return false;
    const result = await this.#deps.native.retryUpload(assetId).catch(() => 'failed' as const);
    if (result !== 'armed_user_initiated' && result !== 'armed' && result !== 'already_armed') return false;
    this.#retried.add(assetId);
    await store.media.setState(assetId, 'applied', null, this.#deps.now());
    this.#progress.delete(assetId);
    await this.#rebuild();
    return true;
  }

  /**
   * The commands of files that left the queue with a discarded group (EVM-137 W10): the original and the row of each go too. A file that the
   * module cannot remove keeps its row as "Wymaga uwagi" (`command_rejected`, "Usuń z telefonu") - never a file on the disk without a row.
   */
  async forgetFiles(mutationIds: readonly string[]): Promise<void> {
    const store = this.#deps.store();
    if (store === null || mutationIds.length === 0) return;
    const wanted = new Set(mutationIds);
    try {
      for (const file of await store.media.list()) {
        if (!wanted.has(file.mutationId) || (file.state !== 'pending' && file.state !== 'needs_attention')) continue;
        const removed = await this.#deps.native.cancelUpload(file.assetId, true).catch(() => false);
        if (file.state === 'pending') await store.media.setState(file.assetId, 'needs_attention', 'command_rejected', this.#deps.now());
        if (removed) await store.media.discard(file.assetId);
      }
    } catch {
      // a failing store leaves the rows as they are; the next reconciliation shows them
    }
    await this.#rebuild();
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
      // the rejected command of the file goes with it, so that it is not shown twice and never sent again (W10); a missing one is fine
      if (isCommandCode(file.lastCode)) {
        await store.queue.rewrite([file.mutationId], []);
        this.#deps.onQueueChanged?.();
      }
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

  /** EVM-111 AC3: only the read of the table (a failed one is shown by the screens and repeated here). */
  reload(): Promise<void> {
    return this.#rebuild();
  }

  // ---- the view -------------------------------------------------------------------------------------------------------------

  async #rebuild(): Promise<void> {
    const store = this.#deps.store();
    const notifications = this.#permission();
    if (store === null) {
      this.#publish({ files: [], notifications, confirmed: this.#confirmed, read: 'loading' });
      return;
    }
    let rows: readonly MediaFileRecord[];
    try {
      rows = await store.media.list();
    } catch {
      // EVM-111 AC3: the rows are unknown - the screens say so ("Spróbuj ponownie"); nothing is changed
      this.#publish({ files: [], notifications, confirmed: this.#confirmed, read: 'failed' });
      return;
    }
    const statuses = new Map<string, UploadStatus>(this.#progress);
    if (rows.some((row) => row.state === 'applied')) {
      for (const status of await this.#deps.native.uploadStatuses().catch(() => [] as readonly UploadStatus[])) {
        if (!statuses.has(status.assetId)) statuses.set(status.assetId, status);
      }
    }
    // the orders whose site survey is still only a command of the queue: their files wait for the survey (EVM-137)
    const surveys = new Set<string>();
    // only a file that waits can carry the mark, so the queue is read only then (not on every progress event)
    try {
      if (rows.some((row) => row.state === 'pending')) {
        for (const raw of await store.queue.readAll()) {
          if (typeof raw === 'object' && raw !== null && (raw as Record<string, unknown>)['type'] === 'CreateSiteSurvey') {
            const id = (raw as Record<string, unknown>)['objectId'];
            if (typeof id === 'string') surveys.add(id);
          }
        }
      }
    } catch {
      // without the queue the files are still shown, only without the words about the survey
    }
    this.#publish({
      files: rows.map((row) => viewOf(row, statuses.get(row.assetId), row.state === 'pending' && surveys.has(row.workOrderId))),
      notifications,
      confirmed: this.#confirmed,
      read: 'ready',
    });
  }

  #permission(): 'granted' | 'denied' {
    try {
      return this.#deps.native.notificationPermission();
    } catch {
      return 'granted';
    }
  }
}

function viewOf(row: MediaFileRecord, status: UploadStatus | undefined, awaitsSurvey = false): MediaFileView {
  const base = {
    assetId: row.assetId,
    workOrderId: row.workOrderId,
    sizeBytes: row.sizeBytes,
    updatedAt: row.updatedAt,
    code: row.lastCode,
    category: row.category ?? null,
    mediaType: row.mime === 'video/mp4' ? ('video' as const) : ('photo' as const),
    capturedAt: row.createdAt,
    durationMs: row.durationMs ?? null,
    ...(awaitsSurvey ? { awaitsSurvey: true } : {}),
  };
  switch (row.state) {
    case 'pending':
      return { ...base, status: 'waiting', percent: null, actions: [] };
    case 'applied':
      if (status?.state === 'uploading') {
        return { ...base, status: 'uploading', percent: Math.max(0, Math.min(100, Math.round(status.percent))), actions: [] };
      }
      // EVM-110 AC4, AC5: a film that waits for a network without charges. The server's `failed` / `abandoned` of a file without a session (after 7
      // days) is NOT looked at for a row that waits: it stays "Czeka na Wi-Fi" and is sent again as the same medium, with no "Ponów".
      return status?.waitingForWifi === true && base.mediaType === 'video'
        ? { ...base, status: 'waiting_wifi', percent: null, actions: [] }
        : { ...base, status: 'waiting', percent: null, actions: [] };
    // EVM-111 AC1, AC2, AC5: there is no "Wysłano" on the phone - a file the module sent but the server has not confirmed yet (`uploaded`) is still on
    // the list as "Wysyła się 100%" (the transfer is done, the confirmation is not; "Oczekuje" would look as if nothing had started) and counts as not sent;
    // the app asks for the confirmation itself (confirmation-poll.ts). A `clean` row is a removal that failed and is repeated
    case 'uploaded':
      return { ...base, status: 'uploading', percent: 100, actions: [], awaitsConfirmation: true };
    case 'clean':
      return { ...base, status: 'waiting', percent: null, actions: [] };
    case 'failed':
      return { ...base, status: 'error', percent: null, actions: ['retry'] };
    case 'needs_attention':
      return {
        ...base,
        status: 'attention',
        percent: null,
        actions: [
          ...(row.lastCode === 'quarantined' || isCommandCode(row.lastCode) ? [] : (['retry'] as const)),
          ...(isDiscardable(row.lastCode) ? (['discard'] as const) : []),
        ],
      };
  }
}

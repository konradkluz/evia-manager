/**
 * The playback session of ONE film (EVM-143 AC2-AC5; SR-MOB-08, SR-MOB-14): the state machine between the screen of the player, the viewer (which issues the signed
 * address) and the player behind the port (`video-player-adapter.ts`, the only file that imports `expo-video`). It never logs, never keeps a message of an error, and the
 * signed address lives in a local variable of one call: it goes to the port and nowhere else.
 *
 * - Nothing is asked until `start()` (the "Odtwórz" touch); the address of the preview is requested then, not before.
 * - Offline (the signal of the app, not the text of a player error) = `offline`, no request; coming back online does NOT start anything.
 * - A failure of the player (an expired address makes a range request fail) gets ONE silent refresh: the position is noted, a new address is requested, the source is replaced and
 *   playback goes on from the same second. The count is of errors in a row WITHOUT progress: it is cleared when the position has advanced by `PROGRESS_SECONDS` after a restart,
 *   so a long film whose address expires every five minutes is not cut short. A second failure without progress is `failed` ("Spróbuj ponownie" = a manual `start()`).
 * - 403 / 404 of the issue = `unavailable`; 429 or any other failure = `failed`; neither is repeated by itself.
 * - `stop()` (the viewer lost its permission: lock, hidden data, background, end of the session - or the screen is closed): the request is aborted, the player is paused and
 *   RELEASED, a late answer or event is ignored (generation) and the phase is `idle`; nothing starts again by itself.
 */
import type { MediaViewControl, VideoUrlResult } from './types';

export type PlayerEvent =
  | { readonly kind: 'ready' }
  | { readonly kind: 'playing'; readonly playing: boolean }
  | { readonly kind: 'ended' }
  | { readonly kind: 'error' }
  | { readonly kind: 'time'; readonly seconds: number };

/** The player as the session sees it. After `release()` every call is a no-op and no event is delivered. */
export interface VideoPlayerPort {
  /** Replaces the source (no caching, no headers, no metadata) and, once it is ready to play, seeks to `startAt` seconds. Does not start playback by itself. */
  load(url: string, startAt: number): void;
  play(): void;
  pause(): void;
  /** The current position in seconds. */
  position(): number;
  subscribe(listener: (event: PlayerEvent) => void): () => void;
  /** Pauses and frees the native player. Idempotent. */
  release(): void;
}

export type VideoPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'failed' | 'unavailable' | 'offline';

export interface VideoSnapshot {
  readonly phase: VideoPhase;
  /** The live port while there is one (the screen draws the video surface of it); `null` otherwise. */
  readonly port: VideoPlayerPort | null;
}

/** Seconds of playback after a restart that count as progress (clears the count of errors in a row). */
export const PROGRESS_SECONDS = 1;
/** At most this many silent refreshes in a row without progress. */
export const MAX_SILENT_REFRESHES = 1;

export interface VideoSessionOptions {
  readonly viewer: Pick<MediaViewControl, 'isAllowed' | 'requestVideoUrl' | 'subscribe'>;
  readonly createPort: () => VideoPlayerPort;
  /** The signal of connectivity of the app. */
  readonly isOnline: () => boolean;
  readonly workOrderId: string;
  readonly mediaAssetId: string;
}

export class VideoSession {
  readonly #options: VideoSessionOptions;
  readonly #listeners = new Set<() => void>();
  readonly #stopWatching: () => void;
  #snapshot: VideoSnapshot = { phase: 'idle', port: null };
  #generation = 0;
  #controller: AbortController | null = null;
  #stopPort: (() => void) | null = null;
  #resumeAt = 0;
  #restartedAt = 0;
  #refreshes = 0;
  #disposed = false;

  constructor(options: VideoSessionOptions) {
    this.#options = options;
    // the viewer lost its permission (lock, hidden data, background, end of the session): the player is gone at once
    this.#stopWatching = options.viewer.subscribe(() => {
      if (!options.viewer.isAllowed()) this.stop();
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getSnapshot = (): VideoSnapshot => this.#snapshot;

  /** "Odtwórz" / "Odtwórz ponownie" / "Spróbuj ponownie": always a person's touch. */
  start(): void {
    if (this.#disposed || !this.#options.viewer.isAllowed()) return;
    const phase = this.#snapshot.phase;
    if (phase === 'loading' || phase === 'playing' || phase === 'unavailable') return;
    if (phase === 'paused') {
      this.#snapshot.port?.play();
      return;
    }
    if (phase === 'ended') this.#resumeAt = 0;
    this.#refreshes = 0;
    if (!this.#options.isOnline()) {
      this.#end('offline');
      return;
    }
    this.#set('loading', this.#snapshot.port);
    void this.#open();
  }

  /** The one button: pause while playing, play while paused. */
  toggle(): void {
    if (this.#snapshot.phase === 'playing') this.#snapshot.port?.pause();
    else if (this.#snapshot.phase === 'paused') this.#snapshot.port?.play();
  }

  /** Frees everything; the phase is `idle` (a new `start()` creates a new player). */
  stop(): void {
    this.#teardown();
    this.#resumeAt = 0;
    if (this.#snapshot.phase !== 'idle' || this.#snapshot.port !== null) this.#set('idle', null);
  }

  /** The screen is closed: like `stop()`, and the session accepts nothing more. */
  dispose(): void {
    this.#disposed = true;
    this.#stopWatching();
    this.stop();
    this.#listeners.clear();
  }

  #set(phase: VideoPhase, port: VideoPlayerPort | null): void {
    this.#snapshot = { phase, port };
    for (const listener of [...this.#listeners]) listener();
  }

  /** Aborts the request, pauses and releases the player, invalidates every late answer and event. */
  #teardown(): void {
    this.#generation += 1;
    this.#controller?.abort();
    this.#controller = null;
    this.#stopPort?.();
    this.#stopPort = null;
    const port = this.#snapshot.port;
    if (port !== null) {
      port.pause();
      port.release();
    }
  }

  /** A final state with the player released (`failed`, `unavailable`, `offline`, `ended` keeps the player for "Odtwórz ponownie" - see `#onEvent`). */
  #end(phase: 'failed' | 'unavailable' | 'offline'): void {
    this.#teardown();
    this.#set(phase, null);
  }

  async #open(): Promise<void> {
    const generation = (this.#generation += 1);
    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;
    const { workOrderId, mediaAssetId } = this.#options;
    let answer: VideoUrlResult;
    try {
      answer = await this.#options.viewer.requestVideoUrl({ workOrderId, mediaAssetId, signal: controller.signal });
    } catch {
      answer = { kind: 'failed' };
    }
    if (generation !== this.#generation || this.#disposed) return;
    switch (answer.kind) {
      case 'ok':
        this.#attach(answer.url);
        return;
      case 'forbidden':
      case 'not_found':
        this.#end('unavailable');
        return;
      case 'aborted':
        // the viewer refused (lock, hidden data, background) or the request was cancelled: nothing is shown, nothing continues
        this.stop();
        return;
      case 'rate_limited':
      case 'failed':
        this.#end(this.#options.isOnline() ? 'failed' : 'offline');
        return;
    }
  }

  #attach(url: string): void {
    let port = this.#snapshot.port;
    if (port === null) {
      const created = this.#options.createPort();
      port = created;
      this.#stopPort = created.subscribe((event) => {
        this.#onEvent(event, created);
      });
    }
    this.#restartedAt = this.#resumeAt;
    port.load(url, this.#resumeAt);
    this.#set('loading', port);
  }

  #onEvent(event: PlayerEvent, source: VideoPlayerPort): void {
    // an event of a released player (an older port, or none after a stop) is ignored
    const port = this.#snapshot.port;
    if (this.#disposed || port === null || port !== source) return;
    switch (event.kind) {
      case 'ready':
        if (this.#snapshot.phase === 'loading') port.play();
        return;
      case 'playing':
        if (event.playing) this.#set('playing', port);
        else if (this.#snapshot.phase === 'playing') this.#set('paused', port);
        return;
      case 'time':
        this.#resumeAt = event.seconds;
        if (event.seconds >= this.#restartedAt + PROGRESS_SECONDS) this.#refreshes = 0;
        return;
      case 'ended':
        this.#resumeAt = 0;
        this.#set('ended', port);
        return;
      case 'error':
        this.#onError();
        return;
    }
  }

  #onError(): void {
    const port = this.#snapshot.port;
    if (port === null) return;
    if (!this.#options.isOnline()) {
      this.#end('offline');
      return;
    }
    if (this.#refreshes >= MAX_SILENT_REFRESHES) {
      this.#end('failed');
      return;
    }
    this.#refreshes += 1;
    this.#resumeAt = Math.max(this.#resumeAt, port.position());
    this.#set('loading', port);
    void this.#open();
  }
}

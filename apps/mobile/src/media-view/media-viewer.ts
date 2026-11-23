/**
 * The viewer of the photos of an order (EVM-142 AC2-AC5): the ONE place where the images of the server are fetched and held. The images live in the memory of the
 * process only - fetched as bytes, kept as `data:` addresses, shown by a plain `Image` (the default loading of an `https:` address by `Image` makes the native layer
 * keep a copy on the disk; that path is not used). If a test on the emulator shows files of images in `cache/` or `files/`, this module is the one to replace.
 *
 * - Nothing is requested unless `setAllowed(true)`: the lock, the hidden-data mode, the background and the end of the session turn it off (see `wire-media-view.ts`);
 *   turning it off (and `releaseAll`) aborts every request in flight, forgets every image and makes a late answer harmless: it stores nothing.
 * - An address is used at once and kept in a local variable only. A refusal of the bucket that looks like an expired address (403, 400) gets ONE more address;
 *   a second failure is `failed` (never two address requests for a photo that works). A `429` stops every new request until the end of `Retry-After` (capped).
 * - At most `MAX_PARALLEL` thumbnails are fetched at a time (the battery and the limit of 1000 addresses / 10 min of the server); a preview goes at once.
 * - It never logs and never throws: a screen gets an `ImageResult`, which holds no address, status or message.
 */
import { parseRetryAfter } from '../auth/retry-after';
import type { BytesAnswer, MediaSource } from './http-media-source';
import { toBase64 } from './base64';
import type { ImageRequest, ImageResult, ImageVariant, MediaViewControl } from './types';

export const MAX_PARALLEL = 4;
/** A `Retry-After` is honoured up to this long (a photo is not worth the hour that the sign-in screen may wait). */
export const MAX_IMAGE_BACKOFF_MS = 300_000;

const ABORTED: ImageResult = { kind: 'aborted' };
const NOTHING = Symbol('aborted');
// a function call, so that the compiler does not keep the earlier narrowing of `signal.aborted` across an await
const isAborted = (signal: AbortSignal): boolean => signal.aborted;

/** The answer of `work`, or `NOTHING` as soon as the signal aborts - a source that ignores the signal cannot keep a request (and its slot) alive. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T | typeof NOTHING> {
  if (signal.aborted) return Promise.resolve(NOTHING);
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      resolve(NOTHING);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

const keyOf = (variant: ImageVariant, id: string): string => `${variant}:${id}`;

export interface MediaViewerOptions {
  readonly source: MediaSource;
  readonly now: () => number;
}

type Fetched = ImageResult | { readonly kind: 'stored'; readonly uri: string };

export class MediaViewer implements MediaViewControl {
  readonly #source: MediaSource;
  readonly #now: () => number;
  readonly #images = new Map<string, string>();
  readonly #inflight = new Set<AbortController>();
  readonly #listeners = new Set<() => void>();
  readonly #queue: (() => void)[] = [];
  #running = 0;
  #epoch = 0;
  #allowed = false;
  #blockedUntil = 0;

  constructor(options: MediaViewerOptions) {
    this.#source = options.source;
    this.#now = options.now;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getEpoch = (): number => this.#epoch;

  /** Whether images may be requested now. */
  get allowed(): boolean {
    return this.#allowed;
  }

  peek(variant: ImageVariant, mediaAssetId: string): string | undefined {
    return this.#images.get(keyOf(variant, mediaAssetId));
  }

  release(variant: ImageVariant, mediaAssetId: string): void {
    this.#images.delete(keyOf(variant, mediaAssetId));
  }

  /** The lock, the hidden-data mode, the background or the end of the session: `false` frees everything at once; `true` lets the screens load again. */
  setAllowed(allowed: boolean): void {
    if (allowed === this.#allowed) return;
    this.#allowed = allowed;
    if (allowed) this.#bump();
    else this.releaseAll();
  }

  /** Aborts every request and forgets every image; the wait of a `429` stays (the lock and the background must not bypass `Retry-After`). The screens that are drawn load again if they may. */
  releaseAll(): void {
    for (const controller of [...this.#inflight]) controller.abort();
    this.#inflight.clear();
    this.#images.clear();
    this.#bump();
  }

  /** The end of the session (sign-out, revoked session, wipe): everything is freed and the wait of a `429` is forgotten - the next sign-in starts clean. The lock does NOT do this. */
  endSession(): void {
    this.setAllowed(false);
    this.#blockedUntil = 0;
  }

  async load(request: ImageRequest): Promise<ImageResult> {
    const { variant, mediaAssetId, signal } = request;
    if (!this.#allowed || signal.aborted) return ABORTED;
    if (this.#images.has(keyOf(variant, mediaAssetId))) return { kind: 'ok' };
    if (this.#now() < this.#blockedUntil) return { kind: 'rate_limited' };
    const control = new AbortController();
    const forward = (): void => {
      control.abort();
    };
    signal.addEventListener('abort', forward, { once: true });
    this.#inflight.add(control);
    const epoch = this.#epoch;
    let slot = false;
    try {
      if (variant === 'thumbnail') {
        slot = await this.#acquire(control.signal);
        if (!slot) return ABORTED;
        // a `429` may have arrived while this tile waited for its slot: the request does not go out
        if (this.#now() < this.#blockedUntil) return { kind: 'rate_limited' };
      }
      const result = await this.#fetchImage(request, control.signal);
      // a late answer: the request was cancelled, or the images were released / the permission changed meanwhile - nothing is stored, nothing is shown
      if (isAborted(control.signal) || epoch !== this.#epoch || !this.allowed) return ABORTED;
      if (result.kind !== 'stored') return result;
      this.#images.set(keyOf(variant, mediaAssetId), result.uri);
      return { kind: 'ok' };
    } catch {
      return control.signal.aborted ? ABORTED : { kind: 'failed' };
    } finally {
      signal.removeEventListener('abort', forward);
      this.#inflight.delete(control);
      if (slot) this.#free();
    }
  }

  #bump(): void {
    this.#epoch += 1;
    for (const listener of [...this.#listeners]) listener();
  }

  async #fetchImage({ workOrderId, mediaAssetId, variant }: ImageRequest, signal: AbortSignal): Promise<Fetched> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const answer = await untilAborted(this.#source.requestUrl({ workOrderId, mediaAssetId, variant, signal }), signal);
      if (answer === NOTHING || signal.aborted) return ABORTED;
      if (answer.kind === 'none') return ABORTED;
      if (answer.kind === 'error') return { kind: 'failed' };
      if (answer.kind === 'status') return this.#refusal(answer.status, answer.retryAfter);
      // the address is used at once whatever the clock of the phone says of its expiry (a clock that runs ahead must not refuse a fresh address); the bucket is the judge
      const bytes: BytesAnswer | typeof NOTHING = await untilAborted(this.#source.fetchImage(answer.url, signal), signal);
      if (bytes === NOTHING || isAborted(signal)) return ABORTED;
      if (bytes.kind === 'ok') return { kind: 'stored', uri: `data:image/webp;base64,${toBase64(bytes.bytes)}` };
      // the bucket refuses an address that has expired (403, or 400 for some stores): once more with a fresh one, silently
      if (bytes.kind === 'status' && (bytes.status === 403 || bytes.status === 400)) continue;
      return { kind: 'failed' };
    }
    return { kind: 'failed' };
  }

  #refusal(status: number, retryAfter: string | null): ImageResult {
    if (status === 403) return { kind: 'forbidden' };
    if (status === 404) return { kind: 'not_found' };
    if (status === 429) {
      this.#blockedUntil = this.#now() + Math.min(parseRetryAfter(retryAfter, this.#now()), MAX_IMAGE_BACKOFF_MS);
      return { kind: 'rate_limited' };
    }
    return { kind: 'failed' };
  }

  /** A slot for a thumbnail; `false` = the request was aborted while it waited. */
  #acquire(signal: AbortSignal): Promise<boolean> {
    if (this.#running < MAX_PARALLEL) {
      this.#running += 1;
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      const turn = (): void => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) resolve(false);
        else {
          this.#running += 1;
          resolve(true);
        }
      };
      const onAbort = (): void => {
        const at = this.#queue.indexOf(turn);
        if (at >= 0) this.#queue.splice(at, 1);
        resolve(false);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.#queue.push(turn);
    });
  }

  #free(): void {
    this.#running -= 1;
    this.#queue.shift()?.();
  }
}

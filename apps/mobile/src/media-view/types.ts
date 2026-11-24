/**
 * Types of the viewer of the photos of an order (EVM-142). Screens import ONLY this file of the module: the viewer itself, the HTTP source and the wiring
 * live in the composition (`src/session.ts`). The images exist in the memory of the process only (AC5): they are held by the viewer, shown as `data:`
 * addresses and never written to a file; the signed address of the server is never handed out of the module.
 */

/** The phone asks for these two variants only; the original stays in the panel (it may carry the location). */
export type ImageVariant = 'thumbnail' | 'preview';

export interface ImageRequest {
  readonly workOrderId: string;
  readonly mediaAssetId: string;
  readonly variant: ImageVariant;
  /** Aborts the request in flight; a late answer is dropped and stores nothing. */
  readonly signal: AbortSignal;
}

/**
 * What a screen learns of a request. No status code, no address and no message: `forbidden` is a 403, `not_found` a 404 (the server gives one answer to "no such
 * photo" and "not allowed"), `rate_limited` a 429 (or the wait after one), `failed` everything else, `aborted` a request that was cancelled, came too late or is not
 * allowed in the present state (lock, hidden data, background, no session).
 */
export type ImageResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'rate_limited' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'aborted' };

export interface VideoUrlRequest {
  readonly workOrderId: string;
  readonly mediaAssetId: string;
  /** Aborts the request for the address; an answer that comes after it is dropped. */
  readonly signal: AbortSignal;
}

/** The address of the 720p preview of a film (EVM-143): the only thing of the module that hands a signed address out - to the player, never to a screen state, Linking, the clipboard or a log. */
export type VideoUrlResult =
  | { readonly kind: 'ok'; readonly url: string }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'rate_limited' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'aborted' };

export interface MediaViewControl {
  /** Whether addresses may be requested now (no lock, hidden data, background or end of the session). */
  isAllowed: () => boolean;
  /** Asks for the address of the preview of a film; every refusal of the state of the app is "aborted". The address is validated against the policy of the bucket before it is returned. */
  requestVideoUrl(request: VideoUrlRequest): Promise<VideoUrlResult>;
  /** Changes whenever images were released or the permission to load changed: screens load again on a new value. */
  subscribe: (listener: () => void) => () => void;
  getEpoch: () => number;
  /** The image in memory (`data:` address) or `undefined`. */
  peek(variant: ImageVariant, mediaAssetId: string): string | undefined;
  /** Loads the image into the memory of the process (a cached one answers at once); the address goes to `peek`. */
  load(request: ImageRequest): Promise<ImageResult>;
  /** Frees one image (the tile left the window, the preview closed, the effect of the screen was cleaned). */
  release(variant: ImageVariant, mediaAssetId: string): void;
}

/**
 * The two network steps of an image (EVM-142 AC1, AC5): the signed address from the API (`createMediaAssetDownloadUrl`, with the token of the session) and the bytes
 * from the address of the bucket (plain `fetch`, NO token, no cookies). Nothing of an answer other than the status, `Retry-After` and the validated address and
 * bytes leaves this module; it never logs, and the error of a `fetch` (which may carry the address) is dropped (SR-LOG-02, SR-LOG-08).
 * The default network stack of React Native keeps no HTTP cache on the disk; the images are not written anywhere (AC5) - the viewer keeps them in memory.
 */
import { readDerivativeUrl } from '../api/media-derivative-url';
import { isAllowedMediaUrl, type MediaUrlPolicy } from './media-url-policy';
import type { ImageVariant } from './types';

export type UrlAnswer =
  | { readonly kind: 'ok'; readonly url: string; readonly expiresAt: number }
  | { readonly kind: 'status'; readonly status: number; readonly retryAfter: string | null }
  /** No session: nothing was sent. */
  | { readonly kind: 'none' }
  | { readonly kind: 'error' };

export type BytesAnswer =
  { readonly kind: 'ok'; readonly bytes: Uint8Array } | { readonly kind: 'status'; readonly status: number } | { readonly kind: 'error' };

export interface MediaSource {
  requestUrl(request: {
    readonly workOrderId: string;
    readonly mediaAssetId: string;
    readonly variant: ImageVariant;
    readonly signal: AbortSignal;
  }): Promise<UrlAnswer>;
  fetchImage(url: string, signal: AbortSignal): Promise<BytesAnswer>;
}

/** The shape of `MobileSessionOwner.authorizedFetch`: `null` = no session (nothing was sent). */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response | null>;

export interface HttpMediaSourceOptions {
  readonly baseUrl: string;
  readonly allowLocalHttp?: boolean;
  /** The domain of the bucket, when the build knows it (SR-MOB-10). */
  readonly allowedHost?: string;
  readonly fetch: FetchLike;
  /** `X-Client-Platform` and `X-Client-Version`. */
  readonly headers: Readonly<Record<string, string>>;
  /** The plain network `fetch` for the address of the bucket; default the global one. */
  readonly fetchBytes?: (url: string, init: RequestInit) => Promise<Response>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A 1600 px WebP is a few hundred kB; more than this is not a derivative of ours. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function createHttpMediaSource(options: HttpMediaSourceOptions): MediaSource {
  const policy: MediaUrlPolicy = {
    ...(options.allowLocalHttp === undefined ? {} : { allowLocalHttp: options.allowLocalHttp }),
    ...(options.allowedHost === undefined ? {} : { allowedHost: options.allowedHost }),
  };
  const secureApi = options.baseUrl.startsWith('https://') || (options.allowLocalHttp === true && options.baseUrl.startsWith('http://'));
  const plainFetch = options.fetchBytes ?? ((url: string, init: RequestInit) => fetch(url, init));
  return {
    async requestUrl({ workOrderId, mediaAssetId, variant, signal }) {
      if (!secureApi || !UUID.test(workOrderId) || !UUID.test(mediaAssetId)) return { kind: 'error' };
      try {
        const response = await options.fetch(
          `${options.baseUrl}/api/v1/work-orders/${workOrderId}/media-assets/${mediaAssetId}/download-url`,
          {
            method: 'POST',
            headers: { ...options.headers, Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ variant }),
            signal,
          },
        );
        if (response === null) return { kind: 'none' };
        if (response.status !== 200) return { kind: 'status', status: response.status, retryAfter: response.headers.get('Retry-After') };
        const url = readDerivativeUrl(await response.json());
        return url === null ? { kind: 'error' } : { kind: 'ok', url: url.url, expiresAt: url.expiresAt };
      } catch {
        return { kind: 'error' };
      }
    },
    async fetchImage(url, signal) {
      if (!isAllowedMediaUrl(url, policy)) return { kind: 'error' };
      try {
        const response = await plainFetch(url, { method: 'GET', headers: { Accept: 'image/webp' }, credentials: 'omit', signal });
        if (!response.ok) return { kind: 'status', status: response.status };
        if (!(response.headers.get('Content-Type') ?? '').toLowerCase().startsWith('image/webp')) return { kind: 'error' };
        const declared = Number(response.headers.get('Content-Length'));
        if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) return { kind: 'error' };
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) return { kind: 'error' };
        return { kind: 'ok', bytes: new Uint8Array(buffer) };
      } catch {
        return { kind: 'error' };
      }
    },
  };
}

import { createMediaAssetDownloadUrl } from '@evia/contracts';
import { useCallback, useEffect, useState, type RefObject } from 'react';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';

// The addresses of thumbnails (EVM-068 AC6, AC8; SR-WEB-04, SR-LOG-02, SR-FILE-10 preparation). A signed address is a short-lived secret: it lives in the memory
// of the tab only (component state) - never in localStorage, IndexedDB or a service worker cache - and is not shown, logged or put in a message.

/**
 * At most `max` requests for addresses at a time. A gallery of up to 5000 media would otherwise ask for thousands of addresses at once; the
 * limit of issuing them (SR-FILE-10, P10: 300 per 10 minutes) arrives with EVM-045, and the panel must already behave: it asks only for the tiles
 * in view, and a few at a time.
 */
export class RequestLimiter {
  readonly #max: number;
  #running = 0;
  readonly #waiting: Array<() => void> = [];

  constructor(max: number) {
    this.#max = max;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.#running >= this.#max) await new Promise<void>((resolve) => this.#waiting.push(resolve));
    this.#running += 1;
    try {
      return await task();
    } finally {
      this.#running -= 1;
      this.#waiting.shift()?.();
    }
  }
}

/** The most addresses requested at the same time by one gallery. */
export const MAX_PARALLEL_URL_REQUESTS = 6;

/**
 * True once the element has entered the viewport (a latch: a tile that was seen keeps its picture when it scrolls away). Without
 * `IntersectionObserver` (old browsers, tests) every tile counts as seen.
 */
export function useSeen(ref: RefObject<Element | null>): boolean {
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const element = ref.current;
    if (seen || element === null) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setSeen(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref, seen]);
  return seen;
}

/** One request for the address of the thumbnail of a medium. */
export function useThumbnailRequest(workOrderId: string) {
  const client = useApi();
  return (mediaAssetId: string): Promise<string> =>
    unwrap(createMediaAssetDownloadUrl({ client, path: { workOrderId, mediaAssetId }, body: { variant: 'thumbnail' } })).then(
      (answer) => answer.url,
    );
}

/** Like `useVariantRequest`, with the end of the address (the player of a film renews it before it runs out). */
export function useVariantTicket(workOrderId: string) {
  const client = useApi();
  return useCallback(
    (mediaAssetId: string, variant: 'preview'): Promise<{ readonly url: string; readonly expiresAt: string }> =>
      unwrap(createMediaAssetDownloadUrl({ client, path: { workOrderId, mediaAssetId }, body: { variant } })).then((answer) => ({
        url: answer.url,
        expiresAt: answer.expiresAt,
      })),
    [client, workOrderId],
  );
}

/** One request for the address of the preview (inline) or the original (attachment) of a medium; the address is returned to the caller, never kept. */
export function useVariantRequest(workOrderId: string) {
  const client = useApi();
  return useCallback(
    (mediaAssetId: string, variant: 'preview' | 'original'): Promise<string> =>
      unwrap(createMediaAssetDownloadUrl({ client, path: { workOrderId, mediaAssetId }, body: { variant } })).then((answer) => answer.url),
    [client, workOrderId],
  );
}

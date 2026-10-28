import type { PutResult } from './media-upload-engine.ts';

/** A part of 16 MiB on a poor mobile network; a request without an answer for this long is a network failure ("Ponów"). */
const PUT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * `PUT` of one part straight to the private bucket (EVM-044 AC1, AC6; SR-WEB-04, SR-WEB-05). XMLHttpRequest because it reports the
 * progress of the upload; the request carries NO credentials and no CSRF token (it is another origin and the signature is in the
 * address), only the body — the signed `Content-Length` is set by the browser. The address is never logged and is not kept.
 */
export function putPart(url: string, body: Blob, signal: AbortSignal, onProgress: (loaded: number) => void): Promise<PutResult> {
  return new Promise<PutResult>((resolve, reject) => {
    // A signal aborted between the address and the PUT: an `abort()` of a request that is only OPENED fires no `onabort`, so the
    // promise would never settle and the queue would hang — refuse before anything is opened.
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const request = new XMLHttpRequest();
    const stop = () => {
      request.abort();
    };
    const settle = () => {
      signal.removeEventListener('abort', stop);
    };
    request.open('PUT', url);
    request.withCredentials = false;
    request.timeout = PUT_TIMEOUT_MS;
    request.upload.onprogress = (event) => {
      onProgress(event.loaded);
    };
    request.onload = () => {
      settle();
      resolve({ ok: request.status >= 200 && request.status < 300, status: request.status });
    };
    request.onerror = () => {
      settle();
      reject(new Error('put_failed'));
    };
    request.ontimeout = () => {
      settle();
      reject(new Error('put_failed'));
    };
    request.onabort = () => {
      settle();
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal.addEventListener('abort', stop, { once: true });
    request.send(body);
  });
}

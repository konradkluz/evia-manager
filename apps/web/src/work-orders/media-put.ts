import type { PutResult } from './media-upload-engine.ts';

/**
 * `PUT` of one part straight to the private bucket (EVM-044 AC1, AC6; SR-WEB-04, SR-WEB-05). XMLHttpRequest because it reports the
 * progress of the upload; the request carries NO credentials and no CSRF token (it is another origin and the signature is in the
 * address), only the body — the signed `Content-Length` is set by the browser. The address is never logged and is not kept.
 */
export function putPart(url: string, body: Blob, signal: AbortSignal, onProgress: (loaded: number) => void): Promise<PutResult> {
  return new Promise<PutResult>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.withCredentials = false;
    request.upload.onprogress = (event) => {
      onProgress(event.loaded);
    };
    request.onload = () => {
      resolve({ ok: request.status >= 200 && request.status < 300, status: request.status });
    };
    request.onerror = () => {
      reject(new Error('put_failed'));
    };
    request.onabort = () => {
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal.addEventListener('abort', () => {
      request.abort();
    });
    if (signal.aborted) {
      request.abort();
      return;
    }
    request.send(body);
  });
}

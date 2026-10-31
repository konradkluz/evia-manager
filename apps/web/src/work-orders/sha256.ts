import { hashBlob } from './sha256-stream.ts';

/**
 * SHA-256 of a file in the browser (EVM-044 AC5; SR-CRYPTO-05): the declared checksum the server compares with the object after the
 * upload. `crypto.subtle` works on the whole buffer, which is fine for photos (≤ 50 MB); a film (EVM-046, up to 4 GiB) is hashed over
 * chunks by `sha256-stream.ts`.
 * The digest is computed in a Web Worker so the page stays responsive; where there is no Worker (a test, an old browser) it is
 * computed in the page itself. The worker file is the same origin (CSP `worker-src 'self'`).
 */
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Up to this size the native digest over one buffer is used (fast); above it the file is hashed chunk by chunk. */
export const NATIVE_MAX_BYTES = 32 * 1024 * 1024;

/** The digest of a blob of any size: native for a photo, chunked for a film. */
export async function hashAny(blob: Blob, nativeMax = NATIVE_MAX_BYTES): Promise<string> {
  return blob.size <= nativeMax ? sha256Hex(await blob.arrayBuffer()) : hashBlob(blob);
}

/** Hashes the file in a worker when the browser has one, otherwise in the page. */
export async function hashFile(file: Blob): Promise<string> {
  if (typeof Worker === 'undefined') return hashAny(file);
  const worker = new Worker(new URL('./sha256.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<string>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<{ readonly hex?: string; readonly failed?: true }>) => {
        if (event.data.hex === undefined) reject(new Error('hash_failed'));
        else resolve(event.data.hex);
      };
      worker.onerror = () => {
        reject(new Error('hash_failed'));
      };
      worker.postMessage({ file });
    });
  } finally {
    worker.terminate();
  }
}

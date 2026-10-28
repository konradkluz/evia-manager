import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkFile, MAX_FILE_BYTES } from '../src/work-orders/media-files.ts';
import { filesCount, formatBytes, photosCount, photosNotSent } from '../src/work-orders/media-labels.ts';
import { putPart } from '../src/work-orders/media-put.ts';
import { hashFile, sha256Hex } from '../src/work-orders/sha256.ts';

describe('EVM-044 AC2 the check of a chosen file before anything is sent (SR-FILE-01, SR-FILE-03)', () => {
  const file = (name: string, type: string, size = 1000) => ({ name, type, size });

  it('EVM-044 AC2 JPEG, PNG, WebP and HEIC are accepted and get the content type of the API', () => {
    expect(checkFile(file('IMG_1.JPG', 'image/jpeg'))).toEqual({ ok: true, contentType: 'image/jpeg' });
    expect(checkFile(file('a.jpeg', 'image/jpg'))).toEqual({ ok: true, contentType: 'image/jpeg' });
    expect(checkFile(file('a.png', 'image/png'))).toEqual({ ok: true, contentType: 'image/png' });
    expect(checkFile(file('a.webp', 'image/webp'))).toEqual({ ok: true, contentType: 'image/webp' });
    expect(checkFile(file('a.heic', 'image/heic'))).toEqual({ ok: true, contentType: 'image/heic' });
    expect(checkFile(file('a.heif', 'image/heif'))).toEqual({ ok: true, contentType: 'image/heic' });
  });

  it('EVM-044 AC2 a phone that gives no type is judged by the extension', () => {
    expect(checkFile(file('IMG_1.heic', ''))).toEqual({ ok: true, contentType: 'image/heic' });
  });

  it('EVM-044 AC2 SVG, HTML, an archive and a file without an extension are refused as "format"', () => {
    for (const [name, type] of [
      ['plan.svg', 'image/svg+xml'],
      ['strona.html', 'text/html'],
      ['archiwum.zip', 'application/zip'],
      ['zdjecie', 'image/jpeg'],
      ['plan.jpg.svg', 'image/svg+xml'],
      ['a.jpg', 'text/html'],
    ] as const)
      expect(checkFile(file(name, type)), name).toEqual({ ok: false, reason: 'format' });
  });

  it('EVM-044 AC2 a photo over 50 MB is refused as "size" and an empty file as "empty"', () => {
    expect(checkFile(file('a.jpg', 'image/jpeg', MAX_FILE_BYTES))).toEqual({ ok: true, contentType: 'image/jpeg' });
    expect(checkFile(file('a.jpg', 'image/jpeg', MAX_FILE_BYTES + 1))).toEqual({ ok: false, reason: 'size' });
    expect(checkFile(file('a.jpg', 'image/jpeg', 0))).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('EVM-044 AC4 the texts of the upload', () => {
  it('EVM-044 AC4 the Polish plural of photos and files and the genitive after a negation', () => {
    expect(photosCount(1)).toBe('1 zdjęcie');
    expect(photosCount(3)).toBe('3 zdjęcia');
    expect(photosCount(12)).toBe('12 zdjęć');
    expect(photosNotSent(1)).toBe('Nie wysłano 1 zdjęcia');
    expect(photosNotSent(3)).toBe('Nie wysłano 3 zdjęć');
    expect(filesCount(1)).toBe('1 plik');
    expect(filesCount(5)).toBe('5 plików');
    expect(filesCount(22)).toBe('22 pliki');
  });

  it('EVM-044 AC4 sizes in decimal units', () => {
    expect(formatBytes(720)).toBe('720 B');
    expect(formatBytes(4_100_000)).toBe('4,1 MB');
    expect(formatBytes(2_500)).toBe('2,5 kB');
    expect(formatBytes(1_500_000_000)).toBe('1,5 GB');
  });
});

describe('EVM-044 AC5 SHA-256 of a file', () => {
  it('EVM-044 AC5 the digest is the lowercase hex of the known test vector ("abc")', async () => {
    const bytes = new TextEncoder().encode('abc');
    expect(await sha256Hex(bytes.buffer)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await hashFile(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('EVM-044 AC5 with a Web Worker the digest is computed in the worker, which is stopped afterwards', async () => {
    const terminate = vi.fn();
    class FakeWorker {
      onmessage: ((event: MessageEvent<{ hex: string }>) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage() {
        queueMicrotask(() => this.onmessage?.({ data: { hex: 'f'.repeat(64) } } as MessageEvent<{ hex: string }>));
      }
      terminate = terminate;
    }
    vi.stubGlobal('Worker', FakeWorker);
    expect(await hashFile(new Blob(['abc']))).toBe('f'.repeat(64));
    expect(terminate).toHaveBeenCalledTimes(1);
    class BrokenWorker extends FakeWorker {
      override postMessage() {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Worker', BrokenWorker);
    await expect(hashFile(new Blob(['abc']))).rejects.toThrow('hash_failed');
    class FailingWorker extends FakeWorker {
      override postMessage() {
        queueMicrotask(() => this.onmessage?.({ data: { failed: true } } as unknown as MessageEvent<{ hex: string }>));
      }
    }
    vi.stubGlobal('Worker', FailingWorker);
    await expect(hashFile(new Blob(['abc']))).rejects.toThrow('hash_failed');
    expect(terminate).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it('EVM-044 AC5 the worker answers a message with the digest of the file', async () => {
    const post = vi.spyOn(globalThis, 'postMessage').mockImplementation(() => undefined);
    await import('../src/work-orders/sha256.worker.ts');
    globalThis.dispatchEvent(new MessageEvent('message', { data: { file: new Blob(['abc']) } }));
    await vi.waitFor(() => {
      expect(post).toHaveBeenCalledWith({ hex: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' });
    });
    post.mockClear();
    const unreadable = new Blob(['abc']);
    vi.spyOn(unreadable, 'arrayBuffer').mockRejectedValue(new Error('NotReadableError'));
    globalThis.dispatchEvent(new MessageEvent('message', { data: { file: unreadable } }));
    await vi.waitFor(() => {
      expect(post).toHaveBeenCalledWith({ failed: true });
    });
    post.mockRestore();
  });
});

describe('EVM-044 AC6 the PUT of a part goes to the bucket without credentials', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  class Xhr {
    static last: Xhr | null = null;
    withCredentials = true;
    upload: { onprogress: ((event: { loaded: number }) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    timeout = 0;
    /** Like the real one: 1 = OPENED, 4 = DONE; `abort()` fires `onabort` only when the request was SENT. */
    readyState = 0;
    status = 200;
    url = '';
    method = '';
    sent: Blob | null = null;
    constructor() {
      Xhr.last = this;
    }
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
      this.readyState = 1;
    }
    send(body: Blob) {
      this.sent = body;
    }
    abort() {
      // An abort() of a request that is OPENED but was never sent fires nothing (XHR spec): the promise would hang.
      if (this.sent !== null) this.onabort?.();
      this.readyState = 0;
    }
  }

  it('EVM-044 AC6 PUT with withCredentials=false, progress reported, status read', async () => {
    vi.stubGlobal('XMLHttpRequest', Xhr);
    const loaded: number[] = [];
    const pending = putPart('https://bucket.example.test/k?sig', new Blob(['abc']), new AbortController().signal, (value) =>
      loaded.push(value),
    );
    const xhr = Xhr.last as Xhr;
    expect(xhr.method).toBe('PUT');
    expect(xhr.withCredentials).toBe(false);
    xhr.upload.onprogress?.({ loaded: 2 });
    xhr.status = 200;
    xhr.onload?.();
    expect(await pending).toEqual({ ok: true, status: 200 });
    expect(loaded).toEqual([2]);
  });

  it('EVM-044 AC6 a refused PUT is not ok; a network error rejects; an abort rejects with AbortError', async () => {
    vi.stubGlobal('XMLHttpRequest', Xhr);
    const refused = putPart('https://bucket.example.test/k', new Blob(['a']), new AbortController().signal, () => undefined);
    (Xhr.last as Xhr).status = 403;
    (Xhr.last as Xhr).onload?.();
    expect(await refused).toEqual({ ok: false, status: 403 });

    const broken = putPart('https://bucket.example.test/k', new Blob(['a']), new AbortController().signal, () => undefined);
    (Xhr.last as Xhr).onerror?.();
    await expect(broken).rejects.toThrow('put_failed');

    const controller = new AbortController();
    const stopped = putPart('https://bucket.example.test/k', new Blob(['a']), controller.signal, () => undefined);
    controller.abort();
    await expect(stopped).rejects.toMatchObject({ name: 'AbortError' });

    const already = new AbortController();
    already.abort();
    const before = Xhr.last;
    await expect(putPart('https://bucket.example.test/k', new Blob(['a']), already.signal, () => undefined)).rejects.toMatchObject({
      name: 'AbortError',
    });
    // a signal aborted between the address and the PUT: nothing is opened, nothing is sent, nothing hangs
    expect(Xhr.last).toBe(before);
  });

  it('EVM-044 AC8 a PUT that gets no answer for too long times out as a network failure', async () => {
    vi.stubGlobal('XMLHttpRequest', Xhr);
    const pending = putPart('https://bucket.example.test/k', new Blob(['a']), new AbortController().signal, () => undefined);
    const xhr = Xhr.last as Xhr;
    expect(xhr.timeout).toBeGreaterThan(0);
    xhr.ontimeout?.();
    await expect(pending).rejects.toThrow('put_failed');
  });
});

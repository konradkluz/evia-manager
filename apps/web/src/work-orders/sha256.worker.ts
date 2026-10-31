import { hashAny } from './sha256.ts';

/**
 * The worker of `hashFile`: receives the file, answers with the lowercase hex digest — or with `failed` when the file cannot be read
 * (a photo deleted or moved after it was chosen), so the file does not hang in "Przygotowanie pliku". No state, nothing stored.
 */
globalThis.addEventListener('message', (event: MessageEvent<{ readonly file: Blob }>) => {
  void hashAny(event.data.file)
    .then((hex) => {
      globalThis.postMessage({ hex });
    })
    .catch(() => {
      globalThis.postMessage({ failed: true });
    });
});

import { sha256Hex } from './sha256.ts';

/** The worker of `hashFile`: receives the file, answers with the lowercase hex digest. No state, nothing stored. */
globalThis.addEventListener('message', (event: MessageEvent<{ readonly file: Blob }>) => {
  void event.data.file
    .arrayBuffer()
    .then(sha256Hex)
    .then((hex) => {
      globalThis.postMessage({ hex });
    });
});

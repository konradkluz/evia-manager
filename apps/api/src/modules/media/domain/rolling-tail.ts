/**
 * A bounded view of the END of a stream (EVM-047): the scan reads the object ONCE, and the central directory of a ZIP lies at the end of the file, so the
 * last bytes are kept while the stream passes. Memory stays bounded whatever the size of the file.
 */
import { TAIL_BYTES } from './ooxml-inspect.ts';

/**
 * The last bytes of a stream, kept for the central directory of an OOXML document (EVM-047): the chunks that can still be part of the last
 * {@link TAIL_BYTES} are held, older ones are dropped, so memory stays bounded whatever the size of the file.
 */
export class RollingTail {
  #chunks: Uint8Array[] = [];
  #held = 0;

  push(chunk: Uint8Array): void {
    this.#chunks.push(chunk);
    this.#held += chunk.length;
    while (this.#chunks.length > 1 && this.#held - (this.#chunks[0] as Uint8Array).length >= TAIL_BYTES) {
      this.#held -= (this.#chunks.shift() as Uint8Array).length;
    }
  }

  bytes(): Buffer {
    const all = Buffer.concat(this.#chunks);
    return all.subarray(Math.max(0, all.length - TAIL_BYTES));
  }
}

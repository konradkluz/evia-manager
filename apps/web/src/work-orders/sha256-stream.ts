/**
 * Incremental SHA-256 for a film (EVM-046 AC1; SR-CRYPTO-05). `crypto.subtle.digest` needs the whole file in one buffer, which a film of up
 * to 4 GiB cannot have, and the Web Crypto API has no streaming mode — so the digest is computed over chunks of the file by this small,
 * dependency-free implementation of FIPS 180-4. It runs in the hash worker. The result is checked against the native digest in the tests
 * and the server compares it with the object after the upload anyway (`checksum_mismatch`).
 */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
  0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
  0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
  0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
  0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** The size of a slice read from the file at a time. */
export const STREAM_CHUNK_BYTES = 8 * 1024 * 1024;

const rotr = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits));
const word = (array: Uint32Array, index: number): number => array[index] ?? 0;

export class Sha256 {
  readonly #state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  readonly #block = new Uint8Array(64);
  readonly #schedule = new Uint32Array(64);
  #used = 0;
  #bytes = 0;

  update(data: Uint8Array): void {
    this.#bytes += data.length;
    let at = 0;
    if (this.#used > 0) {
      const take = Math.min(64 - this.#used, data.length);
      this.#block.set(data.subarray(0, take), this.#used);
      this.#used += take;
      at = take;
      if (this.#used < 64) return;
      this.#compress(this.#block, 0);
      this.#used = 0;
    }
    for (; at + 64 <= data.length; at += 64) this.#compress(data, at);
    if (at < data.length) {
      this.#block.set(data.subarray(at), 0);
      this.#used = data.length - at;
    }
  }

  digestHex(): string {
    const total = this.#bytes;
    const padding = new Uint8Array((this.#used < 56 ? 56 : 120) - this.#used + 8);
    padding[0] = 0x80;
    const view = new DataView(padding.buffer);
    view.setUint32(padding.length - 8, Math.floor(total / 0x20000000), false);
    view.setUint32(padding.length - 4, (total * 8) >>> 0, false);
    this.update(padding);
    return Array.from(this.#state, (value) => value.toString(16).padStart(8, '0')).join('');
  }

  #compress(source: Uint8Array, offset: number): void {
    const w = this.#schedule;
    for (let index = 0; index < 16; index += 1) {
      const at = offset + index * 4;
      w[index] = ((source[at] ?? 0) << 24) | ((source[at + 1] ?? 0) << 16) | ((source[at + 2] ?? 0) << 8) | (source[at + 3] ?? 0);
    }
    for (let index = 16; index < 64; index += 1) {
      const w15 = word(w, index - 15);
      const w2 = word(w, index - 2);
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[index] = word(w, index - 16) + s0 + word(w, index - 7) + s1;
    }
    const s = this.#state;
    let a = word(s, 0);
    let b = word(s, 1);
    let c = word(s, 2);
    let d = word(s, 3);
    let e = word(s, 4);
    let f = word(s, 5);
    let g = word(s, 6);
    let h = word(s, 7);
    for (let index = 0; index < 64; index += 1) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + word(K, index) + word(w, index)) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    s[0] = word(s, 0) + a;
    s[1] = word(s, 1) + b;
    s[2] = word(s, 2) + c;
    s[3] = word(s, 3) + d;
    s[4] = word(s, 4) + e;
    s[5] = word(s, 5) + f;
    s[6] = word(s, 6) + g;
    s[7] = word(s, 7) + h;
  }
}

/** The SHA-256 of a blob read slice by slice: the memory use is one slice, whatever the size of the file. */
export async function hashBlob(blob: Blob): Promise<string> {
  const hash = new Sha256();
  for (let at = 0; at < blob.size; at += STREAM_CHUNK_BYTES) {
    hash.update(new Uint8Array(await blob.slice(at, at + STREAM_CHUNK_BYTES).arrayBuffer()));
  }
  return hash.digestHex();
}

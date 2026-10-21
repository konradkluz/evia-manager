// Deterministic pseudo-random SYNTHETIC files (not camera recordings): AES-CTR keystream seeded from a string.
// The same seed and size always give the same bytes, so the SHA-256 can be recomputed anywhere.
import { createCipheriv, createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';

export async function makeSyntheticFile(path: string, bytes: number, seed: string): Promise<string> {
  const key = createHash('sha256').update(`evm011-synthetic:${seed}`).digest().subarray(0, 16);
  const cipher = createCipheriv('aes-128-ctr', key, Buffer.alloc(16));
  const out = createWriteStream(path);
  const hash = createHash('sha256');
  const chunk = Buffer.alloc(1024 * 1024);
  for (let written = 0; written < bytes;) {
    const n = Math.min(chunk.length, bytes - written);
    const enc = cipher.update(chunk.subarray(0, n));
    hash.update(enc);
    if (!out.write(enc)) await once(out, 'drain');
    written += n;
  }
  out.end();
  await once(out, 'finish');
  return hash.digest('hex');
}

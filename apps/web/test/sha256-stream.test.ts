import { describe, expect, it, vi } from 'vitest';
import { hashBlob, Sha256, STREAM_CHUNK_BYTES } from '../src/work-orders/sha256-stream.ts';
import { sha256Hex } from '../src/work-orders/sha256.ts';

// EVM-046 AC1: a film (up to 4 GiB) cannot be read into one buffer, so the checksum is computed over chunks.
const hex = (text: string) => {
  const hash = new Sha256();
  hash.update(new TextEncoder().encode(text));
  return hash.digestHex();
};

describe('EVM-046 AC1 the incremental SHA-256 of a film', () => {
  it('EVM-046 AC1 the known test vectors (empty, "abc", the two-block message, one million "a")', () => {
    expect(hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    expect(hex('a'.repeat(1_000_000))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('EVM-046 AC1 the digest does not depend on how the bytes are cut into chunks and equals the native digest', async () => {
    const bytes = new Uint8Array(300_011);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 31 + 7) % 251;
    const native = await sha256Hex(bytes.buffer);
    for (const cut of [1, 63, 64, 65, 4096, 100_003]) {
      const hash = new Sha256();
      for (let at = 0; at < bytes.length; at += cut) hash.update(bytes.subarray(at, at + cut));
      expect(hash.digestHex(), `cut ${String(cut)}`).toBe(native);
    }
  });

  it('EVM-046 AC1 hashBlob reads a blob in chunks (never the whole file at once) and gives the same digest', async () => {
    const bytes = new Uint8Array(STREAM_CHUNK_BYTES * 2 + 123);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 13) % 256;
    const blob = new Blob([bytes]);
    const sizes: number[] = [];
    const slice = blob.slice.bind(blob);
    blob.slice = (start, end) => {
      const part = slice(start, end);
      sizes.push(part.size);
      return part;
    };
    expect(await hashBlob(blob)).toBe(await sha256Hex(bytes.buffer));
    expect(Math.max(...sizes)).toBeLessThanOrEqual(STREAM_CHUNK_BYTES);
    expect(sizes.length).toBeGreaterThanOrEqual(3);
  });
});

describe('EVM-046 AC1 which digest is used for which size', () => {
  it('EVM-046 AC1 a film above the native limit is never read as one buffer; a photo is', async () => {
    const { hashAny } = await import('../src/work-orders/sha256.ts');
    const blob = new Blob(['abc']);
    const whole = vi.spyOn(blob, 'arrayBuffer');
    expect(await hashAny(blob, 0)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(whole).not.toHaveBeenCalled();
    expect(await hashAny(blob)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(whole).toHaveBeenCalledTimes(1);
  });
});

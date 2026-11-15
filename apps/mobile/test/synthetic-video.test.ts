import { createHash } from 'node:crypto';
import { CHUNK_BYTES, saveSyntheticVideo, syntheticMp4Chunks, syntheticMp4Header } from '../src/e2e-hooks/synthetic-video';

const mockOpened: { path: string; mode: string; written: number; chunks: number; closed: boolean }[] = [];
const mockCreated: string[] = [];
let mockFailAfter: number | null = null;
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///data/user/0/synthetic/cache' },
  FileMode: { WriteOnly: 'w' },
  Directory: class {
    readonly uri: string;
    constructor(base: string, name: string) {
      this.uri = `${base}/${name}`;
    }
    create(options: { idempotent?: boolean }): void {
      mockCreated.push(`${this.uri}|${String(options.idempotent)}`);
    }
  },
  File: class {
    readonly uri: string;
    constructor(directory: { uri: string }, name: string) {
      this.uri = `${directory.uri}/${name}`;
    }
    create(): void {
      mockCreated.push(this.uri);
    }
    open(mode: string) {
      const record = { path: this.uri, mode, written: 0, chunks: 0, closed: false };
      mockOpened.push(record);
      return {
        writeBytes: (bytes: Uint8Array): Promise<void> => {
          if (mockFailAfter !== null && record.chunks >= mockFailAfter) return Promise.reject(new Error('disk full (synthetic)'));
          record.written += bytes.length;
          record.chunks += 1;
          return Promise.resolve();
        },
        close: () => {
          record.closed = true;
        },
      };
    }
  },
}));

const MIB = 1024 * 1024;
const whole = (seed: number, size: number): Uint8Array => {
  const parts = [...syntheticMp4Chunks(seed, size)];
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
};
const text = (bytes: Uint8Array, from: number, to: number): string => String.fromCharCode(...bytes.slice(from, to));
const u32 = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] ?? 0) * 2 ** 24 + ((bytes[at + 1] ?? 0) << 16) + ((bytes[at + 2] ?? 0) << 8) + (bytes[at + 3] ?? 0)) >>> 0;

beforeEach(() => {
  mockOpened.length = 0;
  mockCreated.length = 0;
  mockFailAfter = null;
});

describe('the synthetic film of the e2e hook (EVM-110 AC8; SEC-110-18)', () => {
  it('EVM-110 AC8: it is an MP4 box structure of exactly the asked size - `ftyp` at offset 4 (the check of the native import), then one `mdat` that covers the rest; no `moov`, so no sound track and no location atom', () => {
    for (const size of [1000, 5 * MIB, 64 * MIB + 17]) {
      const bytes = whole(1, size);
      expect(bytes.length).toBe(size);
      expect(u32(bytes, 0)).toBe(24);
      expect(text(bytes, 4, 8)).toBe('ftyp');
      expect(text(bytes, 8, 12)).toBe('isom');
      expect(text(bytes, 28, 32)).toBe('mdat');
      // the `mdat` box starts after `ftyp` and runs to the end of the file
      expect(u32(bytes, 24)).toBe(size - 24);
      // top level: `ftyp` (24 bytes) + `mdat` (the rest) = the whole file, so there is no `moov` box (no track of any kind, no `udta` with a location)
      expect(24 + u32(bytes, 24)).toBe(size);
    }
  });

  it('EVM-110 AC8: the header alone is `ftyp` + the header of the `mdat`; a size that is too small is raised to a valid file', () => {
    const header = syntheticMp4Header(10_000);
    expect(header.length).toBe(32);
    expect(text(header, 4, 8)).toBe('ftyp');
    expect(u32(header, 24)).toBe(10_000 - 24);
    expect(syntheticMp4Header(5).length).toBe(32);
    expect(whole(1, 5).length).toBe(33);
  });

  it('EVM-110 AC8: the content depends on the seed only - the same seed gives the same SHA-256, another seed another one (the server can tell 3 films from one)', () => {
    const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
    const a = sha(whole(7, 3 * MIB));
    expect(sha(whole(7, 3 * MIB))).toBe(a);
    expect(new Set([1, 2, 3, 4].map((seed) => sha(whole(seed, 3 * MIB)))).size).toBe(4);
  });

  it('EVM-110 AC8: it is produced in chunks of at most 1 MiB - a film of 128 MiB never sits in memory whole', () => {
    let count = 0;
    let largest = 0;
    let total = 0;
    for (const chunk of syntheticMp4Chunks(3, 128 * MIB)) {
      count += 1;
      largest = Math.max(largest, chunk.length);
      total += chunk.length;
    }
    expect(largest).toBeLessThanOrEqual(CHUNK_BYTES);
    expect(total).toBe(128 * MIB);
    expect(count).toBeGreaterThanOrEqual(128);
  });

  it('EVM-110 AC8: it is written as `cacheDir/Camera/<id>.mp4` through a handle that is always closed - the place and the name the native import accepts', async () => {
    const id = '0194c2a0-0000-7000-8000-0000000000b1';
    const saved = await saveSyntheticVideo(id, 5, 3 * MIB);
    expect(saved.uri).toBe(`file:///data/user/0/synthetic/cache/Camera/${id}.mp4`);
    expect(mockCreated).toEqual(['file:///data/user/0/synthetic/cache/Camera|true', saved.uri]);
    expect(mockOpened).toEqual([{ path: saved.uri, mode: 'w', written: 3 * MIB, chunks: 4, closed: true }]);
  });

  it('EVM-110 AC8: a write that fails closes the handle and the failure reaches the caller (the pipeline then answers a failed save)', async () => {
    mockFailAfter = 1;
    await expect(saveSyntheticVideo('0194c2a0-0000-7000-8000-0000000000b2', 5, 8 * MIB)).rejects.toThrow('disk full (synthetic)');
    expect(mockOpened[0]?.closed).toBe(true);
  });
});

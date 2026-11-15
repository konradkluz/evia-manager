import { createHash } from 'node:crypto';
import { SYNTHETIC_PICTURE_BYTES, saveSyntheticPicture, syntheticJpeg } from '../src/e2e-hooks/synthetic-picture';

const written: { path: string; bytes: Uint8Array }[] = [];
const created: string[] = [];
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///data/user/0/synthetic/cache' },
  Directory: class {
    readonly uri: string;
    constructor(base: string, name: string) {
      this.uri = `${base}/${name}`;
    }
    create(options: { idempotent?: boolean }): void {
      created.push(`${this.uri}|${String(options.idempotent)}`);
    }
  },
  File: class {
    readonly uri: string;
    constructor(directory: { uri: string }, name: string) {
      this.uri = `${directory.uri}/${name}`;
    }
    create(): void {
      created.push(this.uri);
    }
    write(bytes: Uint8Array): Promise<void> {
      written.push({ path: this.uri, bytes });
      return Promise.resolve();
    }
  },
}));

/** Walks the marker segments of a JPEG like a reader does; returns the marker bytes in order (`null` = the structure is broken). */
function markers(bytes: Uint8Array): number[] | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const found: number[] = [0xd8];
  let at = 2;
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] ?? 0;
    found.push(marker);
    if (marker === 0xd9) return at + 2 === bytes.length ? found : null;
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    if (length < 2) return null;
    at += 2 + length;
  }
  return null;
}

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

describe('the synthetic picture of the e2e hook (EVM-108 AC7; security requirement 20)', () => {
  it('EVM-108 AC7: it is a JPEG marker structure of the requested size — SOI, JFIF, comments, EOI — with no EXIF (APP1) segment, hence no GPS', () => {
    for (const size of [SYNTHETIC_PICTURE_BYTES, 70_000, 65_600, 65_545, 65_546, 65_547, 65_548, 65_549, 1000, 26, 10]) {
      const bytes = syntheticJpeg(7, size);
      expect(bytes.length).toBe(Math.max(size, 26));
      const found = markers(bytes);
      expect(found).not.toBeNull();
      expect(found?.[0]).toBe(0xd8);
      expect(found?.at(-1)).toBe(0xd9);
      expect(found).not.toContain(0xe1);
    }
    const first = syntheticJpeg(1);
    expect([first[0], first[1], first[2]]).toEqual([0xff, 0xd8, 0xff]);
    expect(new TextDecoder('latin1').decode(first)).not.toMatch(/Exif|GPS|http:\/\/ns\.adobe\.com\/xap/);
  });

  it('EVM-108 AC7: the content depends on the seed only — the same seed gives the same bytes, a different seed a different SHA-256 (30 shots, 30 digests)', () => {
    expect(sha(syntheticJpeg(5))).toBe(sha(syntheticJpeg(5)));
    const digests = new Set(Array.from({ length: 30 }, (_, seed) => sha(syntheticJpeg(1_700_000_000_000 + seed))));
    expect(digests.size).toBe(30);
    expect(sha(syntheticJpeg(0))).not.toBe(sha(syntheticJpeg(1)));
  });

  it('EVM-108 AC7: it is written to the cache folder of the camera under the name <uuid>.jpg and the file:// address is returned — the place the native import accepts', async () => {
    const id = '0194c2a0-0000-7000-8000-0000000000b1';
    const picture = await saveSyntheticPicture(id, 3);
    expect(picture.uri).toBe(`file:///data/user/0/synthetic/cache/Camera/${id}.jpg`);
    expect(created).toEqual(['file:///data/user/0/synthetic/cache/Camera|true', picture.uri]);
    expect(written).toHaveLength(1);
    expect(written[0]?.path).toBe(picture.uri);
    expect(written[0]?.bytes.length).toBe(SYNTHETIC_PICTURE_BYTES);
    expect(markers(written[0]?.bytes ?? new Uint8Array())).not.toBeNull();
  });
});

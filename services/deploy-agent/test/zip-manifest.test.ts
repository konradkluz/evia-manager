/**
 * The artifact ZIP and the manifest are untrusted (EVM-007 AC3; ADR-0018 m2; architect 7, 8; security-engineer B "ZIP").
 */
import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { Rejection } from '../src/errors.ts';
import { parseManifest, sha256 } from '../src/manifest.ts';
import { readSingleEntry } from '../src/zip.ts';
import { API_REPO, COMPOSE_PATH, WEB_REPO, fakeSha, manifestText } from './support/github-stub.ts';
import { makeZip } from './support/zip.ts';

const LIMIT = 1024 * 1024;
const NAME = 'release-manifest.json';
const DATA = Buffer.from('{"a":1}', 'utf8');

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof Rejection) return error.code;
    throw error;
  }
  return 'accepted';
};

describe('EVM-007 AC3: the release-manifest ZIP', () => {
  it('EVM-007 AC3: one deflated or stored entry with the expected name is read in memory', () => {
    expect(Buffer.from(readSingleEntry(makeZip([{ name: NAME, data: DATA }]), NAME, LIMIT)).toString()).toBe('{"a":1}');
    expect(Buffer.from(readSingleEntry(makeZip([{ name: NAME, data: DATA, method: 0 }]), NAME, LIMIT)).toString()).toBe('{"a":1}');
    expect(Buffer.from(readSingleEntry(makeZip([{ name: NAME, data: DATA }], 'a comment'), NAME, LIMIT)).toString()).toBe('{"a":1}');
  });

  const cases: Array<[string, Uint8Array, string]> = [
    [
      'a deflate bomb (small archive, large output)',
      makeZip([{ name: NAME, data: Buffer.alloc(4 * LIMIT, 0), declaredSize: 10 }]),
      'zip-too-large',
    ],
    ['a declared size over the limit', makeZip([{ name: NAME, data: DATA, declaredSize: LIMIT + 1 }]), 'zip-too-large'],
    ['an understated size in the header', makeZip([{ name: NAME, data: DATA, declaredSize: 3 }]), 'zip-size-mismatch'],
    ['a stored entry with an overstated size', makeZip([{ name: NAME, data: DATA, method: 0, declaredSize: 99 }]), 'zip-size-mismatch'],
    [
      'two entries',
      makeZip([
        { name: NAME, data: DATA },
        { name: 'x.json', data: DATA },
      ]),
      'zip-entries',
    ],
    [
      'the same name twice',
      makeZip([
        { name: NAME, data: DATA },
        { name: NAME, data: DATA },
      ]),
      'zip-entries',
    ],
    ['no entry', makeZip([]), 'zip-entries'],
    ['a path ../', makeZip([{ name: `../${NAME}`, data: DATA }]), 'zip-name'],
    ['a directory prefix', makeZip([{ name: `a/${NAME}`, data: DATA }]), 'zip-name'],
    ['another file name', makeZip([{ name: 'manifest.json', data: DATA }]), 'zip-name'],
    ['an encrypted entry', makeZip([{ name: NAME, data: DATA, flags: 1 }]), 'zip-encrypted'],
    ['a strong-encryption flag', makeZip([{ name: NAME, data: DATA, flags: 0x40 }]), 'zip-encrypted'],
    ['another compression method', makeZip([{ name: NAME, data: DATA, method: 12, payload: DATA }]), 'zip-method'],
    ['a wrong CRC-32', makeZip([{ name: NAME, data: DATA, crc: 1 }]), 'zip-crc'],
    ['broken deflate data', makeZip([{ name: NAME, data: DATA, payload: Buffer.from([0xff, 0xff, 0xff]) }]), 'zip-format'],
    ['an archive over the limit', new Uint8Array(LIMIT + 1), 'zip-size'],
    ['too short to be an archive', new Uint8Array(4), 'zip-size'],
    ['no end of central directory', new Uint8Array(100), 'zip-format'],
  ];
  for (const [name, archive, expected] of cases)
    it(`EVM-007 AC3: ${name} is rejected`, () => {
      expect(code(() => readSingleEntry(archive, NAME, LIMIT))).toBe(expected);
    });

  it('EVM-007 AC3: ZIP64 markers, multiple disks, a broken central directory or local header are rejected', () => {
    const zip = (patch: (view: DataView, end: number, central: number) => void): Uint8Array => {
      const archive = makeZip([{ name: NAME, data: DATA }]);
      const view = new DataView(archive.buffer);
      const end = archive.byteLength - 22;
      patch(view, end, view.getUint32(end + 16, true));
      return archive;
    };
    expect(
      code(() =>
        readSingleEntry(
          zip((view, _end, central) => {
            view.setUint32(central + 24, 0xffffffff, true);
          }),
          NAME,
          LIMIT,
        ),
      ),
    ).toBe('zip-format');
    expect(
      code(() =>
        readSingleEntry(
          zip((view, end) => {
            view.setUint16(end + 4, 1, true);
          }),
          NAME,
          LIMIT,
        ),
      ),
    ).toBe('zip-format');
    expect(
      code(() =>
        readSingleEntry(
          zip((view, end) => {
            view.setUint32(end + 16, 10_000, true);
          }),
          NAME,
          LIMIT,
        ),
      ),
    ).toBe('zip-format');
    expect(
      code(() =>
        readSingleEntry(
          zip((view, _end, central) => {
            view.setUint32(central, 0, true);
          }),
          NAME,
          LIMIT,
        ),
      ),
    ).toBe('zip-format');
    expect(
      code(() =>
        readSingleEntry(
          zip((view) => {
            view.setUint32(0, 0, true);
          }),
          NAME,
          LIMIT,
        ),
      ),
    ).toBe('zip-format');
    expect(
      code(() =>
        readSingleEntry(
          zip((view) => {
            view.setUint16(8, 0, true);
          }),
          NAME,
          LIMIT,
        ),
      ),
    ).toBe('zip-format');
    expect(
      code(() =>
        readSingleEntry(
          zip((view, _end, central) => {
            view.setUint16(central + 30, 4, true);
          }),
          NAME,
          LIMIT,
        ),
      ),
    ).toBe('zip-format');
    expect(
      code(() =>
        readSingleEntry(
          zip((view, _end, central) => {
            view.setUint32(central + 20, 10_000, true);
          }),
          NAME,
          LIMIT,
        ),
      ),
    ).toBe('zip-format');
    const renamed = makeZip([{ name: NAME, data: DATA }]);
    renamed[30] = 'X'.charCodeAt(0);
    expect(code(() => readSingleEntry(renamed, NAME, LIMIT))).toBe('zip-name');
    expect(deflateRawSync(DATA).byteLength).toBeGreaterThan(0);
  });
});

describe('EVM-007 AC2, AC3: the release manifest', () => {
  const commit = fakeSha('m');
  const expected = { commit, composePath: COMPOSE_PATH, repositories: { api: API_REPO, web: WEB_REPO } };

  it('EVM-007 AC3: a valid manifest; manifestSha256 is the SHA-256 of its exact bytes', () => {
    const text = manifestText(commit);
    const manifest = parseManifest(Buffer.from(text), expected);
    expect(manifest.images.api.startsWith(`${API_REPO}@sha256:`)).toBe(true);
    expect(sha256(Buffer.from(text))).toBe(sha256(text));
    expect(sha256(`${text} `)).not.toBe(sha256(text));
  });

  it('EVM-007 AC3: an image with two @, no images map, an images map with extra keys, not UTF-8 are rejected', () => {
    const bad = (value: string): string => code(() => parseManifest(Buffer.from(value), expected));
    expect(
      bad(manifestText(commit, { images: { api: `${API_REPO}@sha256:${'a'.repeat(64)}@x`, web: `${WEB_REPO}@sha256:${'b'.repeat(64)}` } })),
    ).toBe('v3-manifest-image');
    expect(bad(manifestText(commit, { images: null }))).toBe('v3-manifest-schema');
    expect(bad(manifestText(commit, { images: { api: 'a', web: 'b', x: 'c' } }))).toBe('v3-manifest-schema');
    expect(bad(manifestText(commit, { images: { api: 1, web: 'b' } }))).toBe('v3-manifest-schema');
    expect(code(() => parseManifest(new Uint8Array([0xff, 0xfe]), expected))).toBe('v3-manifest-schema');
    expect(bad('[]')).toBe('v3-manifest-schema');
  });
});

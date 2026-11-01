import { describe, expect, it } from 'vitest';
import {
  EXPORT_MAX_BYTES,
  archiveFileName,
  decideRate,
  exportObjectKey,
  isExportable,
  planEntries,
  planSizes,
  type ExportCandidate,
} from '../../src/modules/media/domain/export-plan.ts';
import { isSafeEntryName } from '../../src/modules/media/domain/zip-writer.ts';

const photo = (over: Partial<ExportCandidate> = {}): ExportCandidate => ({
  mediaAssetId: '0198a7a0-1234-7000-8000-000000000001',
  mediaType: 'photo',
  state: 'ready',
  erased: false,
  deleted: false,
  purged: false,
  versionId: 'v1',
  etag: '"e1"',
  sizeBytes: 1000,
  contentType: 'image/jpeg',
  originalFilename: 'IMG_0001.JPG',
  objectKey: 'media/2026/11/x/original',
  ...over,
});
const NOW = new Date('2026-11-01T12:00:00Z');
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

describe('EVM-052 AC1 which files enter the archive and how the entries are named', () => {
  it('EVM-052 AC1 only the original of a ready photo that is not deleted, erased or purged and is pinned to a version', () => {
    expect(isExportable(photo())).toBe(true);
    for (const state of ['quarantined', 'scanning', 'uploaded', 'pending_upload', 'processing', 'clean', 'failed'])
      expect(isExportable(photo({ state })), state).toBe(false);
    expect(isExportable(photo({ mediaType: 'video', contentType: 'video/mp4' }))).toBe(false);
    const broken: Array<Partial<ExportCandidate>> = [
      { erased: true },
      { deleted: true },
      { purged: true },
      { versionId: null },
      { etag: null },
      { sizeBytes: null },
      { sizeBytes: 0 },
      { contentType: null },
      { contentType: 'application/pdf' },
    ];
    for (const over of broken) expect(isExportable(photo(over)), JSON.stringify(over)).toBe(false);
  });

  it('EVM-052 AC1 48 ready photos give 48 numbered entries; the files in quarantine and the unready are left out', () => {
    const candidates = [
      ...Array.from({ length: 48 }, (_, index) => photo({ mediaAssetId: `id-${index}`, originalFilename: `IMG_${index}.jpg` })),
      photo({ state: 'quarantined' }),
      photo({ state: 'scanning' }),
    ];
    const entries = planEntries(candidates);
    expect(entries).toHaveLength(48);
    expect(entries[0]?.name).toBe('001-IMG_0.jpg');
    expect(entries[47]?.name).toBe('048-IMG_47.jpg');
    expect(new Set(entries.map((entry) => entry.name)).size).toBe(48);
  });

  it('EVM-052 AC1 the names are flat, cleaned, carry the extension of the detected type and are safe for the receiver (CWE-22)', () => {
    const hostile = [
      '../../etc/passwd',
      '..\\..\\x.jpg',
      'a/b/c.jpg',
      'C:\\x\\y.jpg',
      '\u202egpj.exe',
      'we<ird>:na|me?*.jpg',
      '.hidden',
      '....',
      '',
      'a\u0000b.jpg',
      `${'x'.repeat(400)}.jpg`,
    ];
    const entries = planEntries(hostile.map((originalFilename, index) => photo({ mediaAssetId: `id-${index}`, originalFilename })));
    expect(entries).toHaveLength(hostile.length);
    for (const entry of entries) {
      expect(isSafeEntryName(entry.name), entry.name).toBe(true);
      expect(entry.name).toMatch(/^\d{3}-.+\.jpg$/);
    }
    expect(planEntries([photo({ originalFilename: null, contentType: 'image/heif' })])[0]?.name).toBe('001-photo.heic');
    expect(planEntries([photo({ originalFilename: 'zdjęcie.png', contentType: 'image/png' })])[0]?.name).toBe('001-zdjęcie.png');
  });

  it('EVM-052 AC2 the sizes: the originals and the archive; the limit is 10 GiB', () => {
    const entries = planEntries([photo({ sizeBytes: 100 }), photo({ mediaAssetId: 'b', sizeBytes: 200 })]);
    const sizes = planSizes(entries);
    expect(sizes.contentBytes).toBe(300);
    expect(sizes.archiveBytes).toBeGreaterThan(300);
    expect(EXPORT_MAX_BYTES).toBe(10_737_418_240);
  });

  it('EVM-052 AC7 the name of the downloaded file comes from the number of the order and carries no customer or address', () => {
    expect(archiveFileName('ZL-2026-0042')).toBe('ZL-2026-0042-zdjecia.zip');
    expect(archiveFileName('Kowalski ul. Długa 5/3')).toBe('Kowalskiul.Duga53-zdjecia.zip');
    expect(archiveFileName('żółć')).toBe('zlecenie-zdjecia.zip');
  });

  it('EVM-052 AC4 the key of the object is chosen by the server from the id and the month', () => {
    expect(exportObjectKey('0198a7a0-1234-7000-8000-000000000001', new Date('2026-10-05T10:00:00Z'))).toBe(
      'exports/2026/10/0198a7a0-1234-7000-8000-000000000001.zip',
    );
  });
});

describe('EVM-052 AC2 the limits of a user: one per 10 minutes and five per rolling 24 hours', () => {
  it('EVM-052 AC2 no export yet: allowed', () => {
    expect(decideRate([], NOW)).toEqual({ allowed: true });
  });

  it('EVM-052 AC2 an export 5 minutes ago: refused for the 5 minutes that are left', () => {
    expect(decideRate([ago(5)], NOW)).toEqual({ allowed: false, retryAfterSeconds: 300 });
  });

  it('EVM-052 AC2 an export exactly 10 minutes ago: allowed', () => {
    expect(decideRate([ago(10)], NOW)).toEqual({ allowed: true });
  });

  it('EVM-052 AC2 five exports in 24 hours: refused until the oldest leaves the window', () => {
    const five = [ago(30), ago(60), ago(120), ago(180), ago(23 * 60)];
    expect(decideRate(five, NOW)).toEqual({ allowed: false, retryAfterSeconds: 3600 });
    expect(decideRate(five.slice(1), NOW)).toEqual({ allowed: true });
  });

  it('EVM-052 AC2 an export older than 24 hours does not count; the later of the two waits wins', () => {
    const old = [24 * 60 + 1, 24 * 60 + 2, 24 * 60 + 3, 24 * 60 + 4, 24 * 60 + 5].map(ago);
    expect(decideRate(old, NOW)).toEqual({ allowed: true });
    expect(decideRate([ago(2), ago(100), ago(200), ago(300), ago(1430)], NOW)).toEqual({ allowed: false, retryAfterSeconds: 600 });
  });
});

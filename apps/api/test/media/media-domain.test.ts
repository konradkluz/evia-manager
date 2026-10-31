import { describe, expect, it } from 'vitest';
import {
  checkDeclaration,
  extensionMatches,
  MAX_FILE_BYTES,
  normalizeContentType,
  sanitizeFileName,
  typeAgrees,
} from '../../src/modules/media/domain/file-rules.ts';
import { decideOutcome, isDownloadable } from '../../src/modules/media/domain/scan-outcome.ts';
import { checkStoredParts, objectKeyFor, partLength, PART_SIZE_BYTES, planUpload } from '../../src/modules/media/domain/upload-plan.ts';

describe('EVM-044 AC2 type and size of a file are checked before the upload (SR-FILE-01, SR-FILE-03)', () => {
  const ok = { fileName: 'IMG_0001.JPG', contentType: 'image/jpeg', declaredSize: 2_000_000 };

  it('EVM-044 AC2 accepts JPEG, PNG, WebP and HEIC with a matching extension', () => {
    for (const [fileName, contentType] of [
      ['a.jpg', 'image/jpeg'],
      ['a.jpeg', 'image/jpg'],
      ['a.png', 'image/png'],
      ['a.webp', 'image/webp'],
      ['a.heic', 'image/heic'],
      ['a.heif', 'image/heif'],
    ] as const) {
      expect(checkDeclaration({ ...ok, fileName, contentType }).ok).toBe(true);
    }
    expect(checkDeclaration(ok)).toEqual({
      ok: true,
      value: { contentType: 'image/jpeg', mediaType: 'photo', originalFilename: 'IMG_0001.JPG' },
    });
  });

  it('EVM-044 AC2 refuses SVG, HTML, archives and unknown types with stable codes', () => {
    for (const [fileName, contentType] of [
      ['x.svg', 'image/svg+xml'],
      ['x.html', 'text/html'],
      ['x.zip', 'application/zip'],
      ['x.jpg', 'application/octet-stream'],
      ['x.exe', ''],
    ] as const) {
      const result = checkDeclaration({ ...ok, fileName, contentType });
      expect(result.ok).toBe(false);
    }
    expect(checkDeclaration({ ...ok, fileName: 'x.svg', contentType: 'image/jpeg' })).toEqual({
      ok: false,
      issues: [{ field: 'fileName', code: 'unsupported_type' }],
    });
  });

  it('EVM-044 AC2 refuses a size above 50 MB or below 1 byte', () => {
    expect(checkDeclaration({ ...ok, declaredSize: MAX_FILE_BYTES }).ok).toBe(true);
    expect(checkDeclaration({ ...ok, declaredSize: MAX_FILE_BYTES + 1 })).toEqual({
      ok: false,
      issues: [{ field: 'declaredSize', code: 'file_too_large' }],
    });
    expect(checkDeclaration({ ...ok, declaredSize: 0 })).toEqual({
      ok: false,
      issues: [{ field: 'declaredSize', code: 'size_out_of_range' }],
    });
  });

  it('EVM-044 AC2 a .jpg whose content is a PNG does not agree with the declaration (quarantine type_mismatch)', () => {
    expect(typeAgrees('image/jpeg', 'image/jpeg', 'a.jpg')).toBe(true);
    expect(typeAgrees('image/heif', 'image/heic', 'a.heic')).toBe(true);
    expect(typeAgrees('image/png', 'image/jpeg', 'a.jpg')).toBe(false);
    expect(typeAgrees(undefined, 'image/jpeg', 'a.jpg')).toBe(false);
    expect(typeAgrees('application/zip', 'image/jpeg', 'a.jpg')).toBe(false);
    expect(typeAgrees('image/jpeg', 'image/jpeg', 'a.png')).toBe(false);
    expect(typeAgrees('image/jpeg', 'image/jpeg', null)).toBe(true);
    expect(normalizeContentType(' IMAGE/JPEG ')).toBe('image/jpeg');
    expect(extensionMatches('image/png', 'noextension')).toBe(false);
  });
});

describe('EVM-044 AC1 the file name is cleaned and stays metadata (SR-DATA-01, SR-WEB-03)', () => {
  it('EVM-044 AC1 keeps the last segment, NFC, without control and bidi characters, at most 255 code points', () => {
    expect(sanitizeFileName('C:\\Users\\x\\foto.jpg')).toBe('foto.jpg');
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('a\u202Eb\u0000c\u2066d.jpg')).toBe('abcd.jpg');
    expect(sanitizeFileName('e\u0301.jpg')).toBe('\u00e9.jpg');
    expect(sanitizeFileName('  spaced.jpg  ')).toBe('spaced.jpg');
    expect(Array.from(sanitizeFileName(`${'ż'.repeat(300)}.jpg`) ?? '')).toHaveLength(255);
    for (const empty of ['', '   ', '..', '.', 'dir/', '\u202E\u0000']) expect(sanitizeFileName(empty)).toBeUndefined();
  });

  it('EVM-044 AC1 a file name that cleans to nothing is refused', () => {
    expect(checkDeclaration({ fileName: '\u202E', contentType: 'image/jpeg', declaredSize: 5 })).toEqual({
      ok: false,
      issues: [{ field: 'fileName', code: 'invalid_file_name' }],
    });
  });
});

describe('EVM-044 AC6 the plan of the upload is decided by the server', () => {
  it('EVM-044 AC6 splits the file into parts of 16 MiB, the last one shorter; the lengths add up', () => {
    const size = 40 * 1024 * 1024 + 123;
    const plan = planUpload(size);
    expect(plan).toEqual({ partSize: PART_SIZE_BYTES, partCount: 3 });
    expect([1, 2, 3].map((n) => partLength(size, plan, n))).toEqual([PART_SIZE_BYTES, PART_SIZE_BYTES, 8 * 1024 * 1024 + 123]);
    expect(planUpload(1)).toEqual({ partSize: PART_SIZE_BYTES, partCount: 1 });
    expect(planUpload(PART_SIZE_BYTES)).toEqual({ partSize: PART_SIZE_BYTES, partCount: 1 });
    expect(partLength(size, plan, 0)).toBeUndefined();
    expect(partLength(size, plan, 4)).toBeUndefined();
    expect(partLength(size, plan, 1.5)).toBeUndefined();
    expect(() => planUpload(0)).toThrow(RangeError);
    expect(() => planUpload(PART_SIZE_BYTES * 1001)).toThrow(RangeError);
  });

  it('EVM-044 AC6 complete accepts exactly the planned parts and names what is wrong otherwise', () => {
    const size = PART_SIZE_BYTES + 10;
    const plan = planUpload(size);
    const good = [
      { partNumber: 1, size: PART_SIZE_BYTES },
      { partNumber: 2, size: 10 },
    ];
    expect(checkStoredParts(size, plan, good)).toEqual({ ok: true });
    expect(checkStoredParts(size, plan, good.slice(0, 1))).toEqual({ ok: false, code: 'parts_missing' });
    expect(checkStoredParts(size, plan, [good[0] as never, { partNumber: 2, size: 11 }])).toEqual({ ok: false, code: 'size_mismatch' });
    expect(checkStoredParts(size, plan, [{ partNumber: 1, size: 5 }, good[1] as never])).toEqual({ ok: false, code: 'size_mismatch' });
    expect(checkStoredParts(size, plan, [...good, { partNumber: 3, size: 1 }])).toEqual({ ok: false, code: 'size_mismatch' });
  });

  it('EVM-044 AC6 the object key carries the id of the file and the month only — no name, no order, no person', () => {
    const key = objectKeyFor('01928f3e-aaaa-7000-8000-000000000001', new Date('2026-10-27T23:59:59Z'));
    expect(key).toBe('media/2026/10/01928f3e-aaaa-7000-8000-000000000001/original');
    expect(key).toMatch(/^media\/\d{4}\/\d{2}\/[0-9a-f-]{36}\/original$/);
  });
});

describe('EVM-044 AC2 AC3 AC5 the order of the verdicts', () => {
  const all = { infected: false, checksumMatches: true, typeMatches: true };

  it('EVM-044 AC3 clean only when the scanner, the checksum and the type all agree', () => {
    expect(decideOutcome(all)).toEqual({ state: 'clean', reason: null });
  });

  it('EVM-044 AC3 malware beats a damaged transfer, which beats a wrong type', () => {
    expect(decideOutcome({ infected: true, checksumMatches: false, typeMatches: false })).toEqual({
      state: 'quarantined',
      reason: 'malware_detected',
    });
    expect(decideOutcome({ infected: false, checksumMatches: false, typeMatches: false })).toEqual({
      state: 'failed',
      reason: 'checksum_mismatch',
    });
    expect(decideOutcome({ ...all, typeMatches: false })).toEqual({ state: 'quarantined', reason: 'type_mismatch' });
  });

  it('EVM-044 AC3 only clean and ready files can be opened', () => {
    expect(['clean', 'ready'].every((state) => isDownloadable(state as never))).toBe(true);
    for (const state of ['pending_upload', 'uploaded', 'scanning', 'processing', 'quarantined', 'failed']) {
      expect(isDownloadable(state as never)).toBe(false);
    }
  });
});

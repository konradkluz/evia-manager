import { describe, expect, it } from 'vitest';
import {
  DOWNLOAD_VARIANTS,
  URL_LIMITS,
  downloadFileName,
  isOriginalDownloadable,
  mayRequest,
  variantClass,
} from '../../src/modules/media/domain/downloads.ts';
import type { FileState, ReasonCode } from '../../src/modules/media/domain/scan-outcome.ts';
import { attachmentHeader, dispositionHeader } from '../../src/platform/object-storage/content-disposition.ts';

const ID = '0198a7a0-1234-7000-8000-000000000001';

describe('EVM-045 AC4 AC6 who may request which variant and which files are downloadable', () => {
  it('EVM-045 AC4 Read-only never gets the original; Administrator and Editor get every variant; Read-only gets both derivatives', () => {
    for (const variant of DOWNLOAD_VARIANTS) {
      expect(mayRequest('administrator', variant)).toBe(true);
      expect(mayRequest('editor', variant)).toBe(true);
      expect(mayRequest('read_only', variant)).toBe(variant !== 'original');
    }
  });

  it('EVM-045 AC5 the thumbnail and the preview are one class, the original another', () => {
    expect(variantClass('thumbnail')).toBe('derivative');
    expect(variantClass('preview')).toBe('derivative');
    expect(variantClass('original')).toBe('original');
    expect(URL_LIMITS).toEqual({ derivative: { alertAt: 600, blockAt: 1000 }, original: { alertAt: 50, blockAt: 100 } });
  });

  it('EVM-045 AC6 the original is downloadable in clean, ready and failed with processing_error - and in no other state or reason', () => {
    const states: FileState[] = ['pending_upload', 'uploaded', 'scanning', 'clean', 'processing', 'ready', 'quarantined', 'failed'];
    const reasons: Array<ReasonCode | null> = [
      null,
      'checksum_mismatch',
      'processing_error',
      'type_mismatch',
      'malware_detected',
      'abandoned',
    ];
    const allowed: string[] = [];
    for (const state of states)
      for (const reason of reasons) if (isOriginalDownloadable(state, reason)) allowed.push(`${state}/${reason ?? '-'}`);
    // `clean` and `ready` carry no reason in practice; the rule is on the state, `failed` needs the reason of the processor
    expect(allowed.filter((entry) => entry.startsWith('failed'))).toEqual(['failed/processing_error']);
    expect(allowed.filter((entry) => !entry.startsWith('clean') && !entry.startsWith('ready') && !entry.startsWith('failed'))).toEqual([]);
    expect(isOriginalDownloadable('clean', null)).toBe(true);
    expect(isOriginalDownloadable('ready', null)).toBe(true);
  });
});

describe('EVM-045 AC2 the name under which the original is saved (CWE-113, CWE-22)', () => {
  it('EVM-045 AC2 keeps a Polish name, strips quotes, backslashes, slashes, semicolons, percent signs and control characters, and collapses ".."', () => {
    expect(downloadFileName('Przyłącze – widok.jpg', ID, 'image/jpeg')).toBe('Przyłącze – widok.jpg');
    expect(downloadFileName('a"b\\c/d;e%f\r\ng.jpg', ID, 'image/jpeg')).toBe('abcdefg.jpg');
    expect(downloadFileName('../../etc/passwd..jpg', ID, 'image/jpeg')).toBe('etcpasswd.jpg');
    expect(downloadFileName(`${String.fromCodePoint(0x202e)}gpj.exe`, ID, 'image/jpeg')).toBe('gpj.exe');
  });

  it('EVM-045 AC2 an empty or missing name falls back to media-<id>.<extension of the type the server detected>', () => {
    expect(downloadFileName(null, ID, 'image/jpeg')).toBe('media-0198a7a0.jpg');
    expect(downloadFileName('"/\\', ID, 'image/png')).toBe('media-0198a7a0.png');
    expect(downloadFileName('...', ID, 'image/webp')).toBe('media-0198a7a0.webp');
    expect(downloadFileName('', ID, 'image/heif')).toBe('media-0198a7a0.heic');
    expect(downloadFileName(null, ID, null)).toBe('media-0198a7a0.bin');
    expect(downloadFileName(null, ID, 'text/html')).toBe('media-0198a7a0.bin');
  });

  it('EVM-045 AC2 a long name is cut to 120 code points and keeps its extension', () => {
    const cut = downloadFileName(`${'ł'.repeat(300)}.jpeg`, ID, 'image/jpeg');
    expect(Array.from(cut)).toHaveLength(120);
    expect(cut.endsWith('.jpeg')).toBe(true);
    const noExtension = downloadFileName('x'.repeat(300), ID, 'image/jpeg');
    expect(Array.from(noExtension)).toHaveLength(120);
    const longExtension = downloadFileName(`${'x'.repeat(200)}.${'y'.repeat(30)}`, ID, 'image/jpeg');
    expect(Array.from(longExtension)).toHaveLength(120);
  });
});

describe('EVM-045 AC2 the Content-Disposition is built by the server (SR-FILE-07; ASVS V5.4.2)', () => {
  it("EVM-045 AC2 attachment with an ASCII fallback and filename*=UTF-8'' percent-encoded (RFC 8187)", () => {
    expect(attachmentHeader('Zdjęcie przyłącza (1).jpg')).toBe(
      'attachment; filename="Zdjecie przy_acza (1).jpg"; filename*=UTF-8\'\'Zdj%C4%99cie%20przy%C5%82%C4%85cza%20%281%29.jpg',
    );
    expect(attachmentHeader("it's*.jpg")).toBe("attachment; filename=\"it's*.jpg\"; filename*=UTF-8''it%27s%2A.jpg");
  });

  it('EVM-045 AC2 a percent sign and a lone surrogate never reach the fallback raw; a long fallback is cut', () => {
    expect(attachmentHeader('100%.jpg')).toContain('filename="100_.jpg"');
    expect(attachmentHeader('a\uD800b.jpg')).toContain("filename*=UTF-8''a%EF%BF%BDb.jpg");
    const fallback = /filename="([^"]*)"/.exec(attachmentHeader('x'.repeat(300)))?.[1] ?? '';
    expect(fallback).toHaveLength(100);
  });

  it('EVM-045 AC2 a name with a control character, a quote, a backslash or a slash - or an empty one - is refused, never repaired', () => {
    for (const name of ['a\r\nb.jpg', 'a\u0000b.jpg', 'a"b.jpg', 'a\\b.jpg', 'a/b.jpg', '']) {
      expect(() => attachmentHeader(name), JSON.stringify(name)).toThrow(RangeError);
    }
  });

  it('EVM-045 AC2 a derivative is inline', () => {
    expect(dispositionHeader({ kind: 'inline' })).toBe('inline');
    expect(dispositionHeader({ kind: 'attachment', filename: 'a.jpg' })).toBe('attachment; filename="a.jpg"; filename*=UTF-8\'\'a.jpg');
  });
});

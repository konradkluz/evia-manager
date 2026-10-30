import { describe, expect, it } from 'vitest';
import { downloadFileName, isOriginalDownloadable } from '../../src/modules/media/domain/downloads.ts';
import { checkDeclaration, MAX_FILE_BYTES, MAX_VIDEO_BYTES, mediaKindOf, typeAgrees } from '../../src/modules/media/domain/file-rules.ts';
import type { FileState, ReasonCode } from '../../src/modules/media/domain/scan-outcome.ts';
import { planUpload } from '../../src/modules/media/domain/upload-plan.ts';
import {
  isAcceptableDuration,
  isVideoOriginalReleasable,
  MAX_VIDEO_SECONDS,
  SCAN_LIMIT_BYTES,
  skipsAntivirus,
  wholeSeconds,
} from '../../src/modules/media/domain/video-rules.ts';

const ok = { fileName: 'pomiar.mp4', contentType: 'video/mp4', declaredSize: 600_000_000 };

describe('EVM-046 AC1 a video is declared as MP4 or MOV up to 4 GiB (SR-FILE-01, SR-FILE-02)', () => {
  it('EVM-046 AC1 accepts MP4 and MOV with a matching extension and derives the kind from the type, not from a field of the client', () => {
    expect(checkDeclaration(ok)).toEqual({
      ok: true,
      value: { contentType: 'video/mp4', mediaType: 'video', originalFilename: 'pomiar.mp4' },
    });
    expect(checkDeclaration({ ...ok, fileName: 'IMG_1.MOV', contentType: 'video/quicktime' }).ok).toBe(true);
    expect(mediaKindOf('image/jpeg')).toBe('photo');
    expect(mediaKindOf('video/quicktime')).toBe('video');
  });

  it('EVM-046 AC1 refuses another format (avi, mkv, webm) and an extension that does not belong to the type', () => {
    for (const [fileName, contentType] of [
      ['a.avi', 'video/x-msvideo'],
      ['a.mkv', 'video/x-matroska'],
      ['a.webm', 'video/webm'],
      ['a.mov', 'video/mp4'],
      ['a.mp4', 'image/jpeg'],
      ['a.jpg', 'video/mp4'],
    ] as const) {
      expect(checkDeclaration({ ...ok, fileName, contentType }).ok, `${fileName} ${contentType}`).toBe(false);
    }
  });

  it('EVM-046 AC1 the boundary is 4 GiB for a video and stays 50 MB for a photo', () => {
    expect(checkDeclaration({ ...ok, declaredSize: MAX_VIDEO_BYTES }).ok).toBe(true);
    expect(checkDeclaration({ ...ok, declaredSize: MAX_VIDEO_BYTES + 1 })).toEqual({
      ok: false,
      issues: [{ field: 'declaredSize', code: 'file_too_large' }],
    });
    expect(checkDeclaration({ fileName: 'a.jpg', contentType: 'image/jpeg', declaredSize: MAX_FILE_BYTES + 1 }).ok).toBe(false);
  });

  it('EVM-046 AC1 4 GiB is 256 parts of 16 MiB and 4 GiB + 1 byte is one part more', () => {
    expect(planUpload(MAX_VIDEO_BYTES).partCount).toBe(256);
    expect(planUpload(MAX_VIDEO_BYTES + 1).partCount).toBe(257);
  });
});

describe('EVM-046 AC2 the content decides the type (SR-FILE-03)', () => {
  it('EVM-046 AC2 an MP4 and a MOV are one family; a photo under a video declaration, and the reverse, never agree', () => {
    expect(typeAgrees('video/mp4', 'video/mp4', 'a.mp4')).toBe(true);
    expect(typeAgrees('video/quicktime', 'video/mp4', 'a.mp4')).toBe(true);
    expect(typeAgrees('video/mp4', 'video/quicktime', 'a.mov')).toBe(true);
    expect(typeAgrees('image/jpeg', 'video/mp4', 'a.mp4')).toBe(false);
    expect(typeAgrees('video/mp4', 'image/jpeg', 'a.jpg')).toBe(false);
    expect(typeAgrees('video/webm', 'video/mp4', 'a.mp4')).toBe(false);
    expect(typeAgrees(undefined, 'video/mp4', 'a.mp4')).toBe(false);
    expect(typeAgrees('video/mp4', 'video/mp4', 'a.exe')).toBe(false);
  });

  it('EVM-046 AC2 the duration: up to 1800 s is acceptable; 0, NaN, infinity and 1800.1 are not; whole seconds are rounded up, at least 1', () => {
    expect(MAX_VIDEO_SECONDS).toBe(1800);
    expect(isAcceptableDuration(1800)).toBe(true);
    expect(isAcceptableDuration(0.2)).toBe(true);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1800.1]) expect(isAcceptableDuration(bad), String(bad)).toBe(false);
    expect(isAcceptableDuration(3, 2)).toBe(false);
    expect(wholeSeconds(0.2)).toBe(1);
    expect(wholeSeconds(241.2)).toBe(242);
    expect(wholeSeconds(1800)).toBe(1800);
  });
});

describe('EVM-046 AC3 the scan limit is 2 000 000 000 B (SR-FILE-12, P5)', () => {
  it('EVM-046 AC3 2 000 000 000 B is scanned and 2 000 000 001 B is not; the limit is injectable', () => {
    expect(SCAN_LIMIT_BYTES).toBe(2_000_000_000);
    expect(skipsAntivirus(2_000_000_000)).toBe(false);
    expect(skipsAntivirus(2_000_000_001)).toBe(true);
    expect(skipsAntivirus(11, 10)).toBe(true);
    expect(skipsAntivirus(10, 10)).toBe(false);
  });

  const states: FileState[] = ['pending_upload', 'uploaded', 'scanning', 'clean', 'processing', 'ready', 'quarantined', 'failed'];
  const reasons: Array<ReasonCode | null> = [
    null,
    'checksum_mismatch',
    'processing_error',
    'type_mismatch',
    'malware_detected',
    'abandoned',
  ];
  const releasable = (durationSeconds: number | null, avScanned: boolean | null): string[] => {
    const allowed: string[] = [];
    for (const state of states)
      for (const reason of reasons)
        if (isVideoOriginalReleasable({ state, reason, durationSeconds, avScanned })) allowed.push(`${state}/${reason ?? '-'}`);
    return allowed;
  };

  it('EVM-046 AC3 the original of a video needs the probe: without a duration it is never released, whatever the state (also clean and a new scan)', () => {
    expect(releasable(null, true)).toEqual([]);
    expect(releasable(null, false)).toEqual([]);
    expect(releasable(null, null)).toEqual([]);
  });

  it('EVM-046 AC3 after the probe a scanned video is released in ready and in failed/processing_error only; an unscanned one in ready only', () => {
    const scanned = releasable(240, true);
    expect(scanned.filter((entry) => entry.startsWith('failed'))).toEqual(['failed/processing_error']);
    expect(scanned.filter((entry) => !entry.startsWith('failed')).every((entry) => entry.startsWith('ready'))).toBe(true);
    expect(releasable(240, false).every((entry) => entry.startsWith('ready'))).toBe(true);
    expect(releasable(240, null).every((entry) => entry.startsWith('ready'))).toBe(true);
  });

  it('EVM-046 AC6 isOriginalDownloadable follows the kind: a clean photo yes, a clean video without a probe no', () => {
    const base = { state: 'clean', reason: null, durationSeconds: null, avScanned: true } as const;
    expect(isOriginalDownloadable({ ...base, mediaType: 'photo' })).toBe(true);
    expect(isOriginalDownloadable({ ...base, mediaType: 'video' })).toBe(false);
    expect(isOriginalDownloadable({ ...base, mediaType: 'video', state: 'ready', durationSeconds: 5 })).toBe(true);
  });

  it('EVM-046 AC6 the saved name falls back to an extension of the detected video type', () => {
    expect(downloadFileName(null, '0198abcd-ef01-7000-8000-000000000000', 'video/mp4')).toMatch(/\.mp4$/);
    expect(downloadFileName(null, '0198abcd-ef01-7000-8000-000000000000', 'video/quicktime')).toMatch(/\.mov$/);
  });
});

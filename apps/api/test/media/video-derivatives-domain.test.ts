import { describe, expect, it } from 'vitest';
import {
  derivativeContentType,
  derivativeKey,
  isPermanentVideo,
  MAX_VIDEO_PROCESSING_ATTEMPTS,
  STALE_VIDEO_PROCESSING_MS,
  VIDEO_CLIENT_TIMEOUT_MS,
  VIDEO_PROBE_TIMEOUT_MS,
  VIDEO_TRANSCODE_TIMEOUT_MS,
} from '../../src/modules/media/domain/derivatives.ts';
import type { VideoProcessingErrorCode } from '../../src/platform/media-processing/video-processor.ts';

const KEY = 'media/2026/10/0198abcd-ef01-7000-8000-000000000000/original';

describe('EVM-046 AC4 the derivatives of a video (SR-FILE-08)', () => {
  it('EVM-046 AC4 a video has thumbnail.webp (a frame) and preview.mp4 (720p); a photo keeps two WebP', () => {
    expect(derivativeKey(KEY, 'thumbnail', 'video')).toBe('media/2026/10/0198abcd-ef01-7000-8000-000000000000/thumbnail.webp');
    expect(derivativeKey(KEY, 'preview', 'video')).toBe('media/2026/10/0198abcd-ef01-7000-8000-000000000000/preview.mp4');
    expect(derivativeKey(KEY, 'preview')).toBe('media/2026/10/0198abcd-ef01-7000-8000-000000000000/preview.webp');
    expect(derivativeKey('media/x/original', 'preview', 'video')).toBeUndefined();
    expect(derivativeContentType('preview', 'video')).toBe('video/mp4');
    expect(derivativeContentType('thumbnail', 'video')).toBe('image/webp');
    expect(derivativeContentType('preview', 'photo')).toBe('image/webp');
  });
});

describe('EVM-046 AC5 the limits of time of a video (SR-INFRA-11, SR-FILE-04)', () => {
  it('EVM-046 AC5 the kill of the processor (15 min) comes before the timeout of the client, which comes before the stale period', () => {
    expect(VIDEO_PROBE_TIMEOUT_MS).toBe(30_000);
    expect(VIDEO_TRANSCODE_TIMEOUT_MS).toBe(15 * 60_000);
    expect(VIDEO_TRANSCODE_TIMEOUT_MS).toBeLessThan(VIDEO_CLIENT_TIMEOUT_MS);
    expect(VIDEO_CLIENT_TIMEOUT_MS).toBeLessThan(STALE_VIDEO_PROCESSING_MS);
  });

  it('EVM-046 AC5 a timeout and every judgment of the file are permanent; a crash and a lost answer are retried; an unreachable processor gives the take back', () => {
    const permanent: VideoProcessingErrorCode[] = ['timeout', 'unsupported', 'too_long', 'invalid_output'];
    const transient: VideoProcessingErrorCode[] = ['internal', 'unavailable', 'unreachable'];
    for (const code of permanent) expect(isPermanentVideo(code), code).toBe(true);
    for (const code of transient) expect(isPermanentVideo(code), code).toBe(false);
    expect(MAX_VIDEO_PROCESSING_ATTEMPTS).toBe(2);
  });
});

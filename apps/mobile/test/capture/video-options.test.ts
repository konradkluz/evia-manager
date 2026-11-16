// EVM-110 AC1, AC2, AC7: the constants of the film and the counting of the limits (pure).
import {
  PICTURE_OPTIONS,
  VIDEO_MAX_SECONDS,
  VIDEO_OPTIONS_BASE,
  VIDEO_VIEW_PROPS,
  VIDEO_WARN_AT_SECONDS,
  videoRecordOptions,
} from '../../src/capture/camera-options';
import {
  INT_MAX,
  VIDEO_BLOCK_BELOW_BYTES,
  VIDEO_RESERVE_BYTES,
  VIDEO_SAFETY_BYTES,
  VIDEO_STOP_BELOW_BYTES,
  videoDiskLevel,
  videoSizeLimit,
} from '../../src/capture/disk-space';
import { formatDuration, formatFileSize } from '../../src/i18n/format';

const MB = 1024 * 1024;

describe('the frozen constants of the film (EVM-110 AC1, AC7; SEC-110-02)', () => {
  it('EVM-110 AC7: the props of the view are one frozen object - mute is true, 720p, 5 Mb/s, and nothing else', () => {
    expect(VIDEO_VIEW_PROPS).toEqual({ mute: true, videoQuality: '720p', videoBitrate: 5_000_000 });
    expect(Object.keys(VIDEO_VIEW_PROPS).sort()).toEqual(['mute', 'videoBitrate', 'videoQuality']);
    expect(Object.isFrozen(VIDEO_VIEW_PROPS)).toBe(true);
    expect(Object.isFrozen(PICTURE_OPTIONS)).toBe(true);
    // a write to a frozen object is refused (it throws in strict mode, is ignored otherwise): `mute` stays true either way
    try {
      (VIDEO_VIEW_PROPS as { mute: boolean }).mute = false;
    } catch {
      // strict mode
    }
    expect(VIDEO_VIEW_PROPS.mute).toBe(true);
  });

  it('EVM-110 AC1 AC2: the options of the recording are the 5 minutes and the computed size - exactly two keys, frozen, the size never 0', () => {
    expect(VIDEO_MAX_SECONDS).toBe(300);
    expect(VIDEO_WARN_AT_SECONDS).toBe(240);
    expect(VIDEO_OPTIONS_BASE).toEqual({ maxDuration: 300 });
    expect(Object.isFrozen(VIDEO_OPTIONS_BASE)).toBe(true);
    const options = videoRecordOptions(123_456);
    expect(options).toEqual({ maxDuration: 300, maxFileSize: 123_456 });
    expect(Object.keys(options).sort()).toEqual(['maxDuration', 'maxFileSize']);
    expect(Object.isFrozen(options)).toBe(true);
    // 5 minutes at 5 Mb/s is about 190 MB: the safety limit of the size is far above it
    expect((5_000_000 / 8) * 300).toBeLessThan(VIDEO_SAFETY_BYTES / 2);
  });
});

describe('the size limit counted at the start (EVM-110 AC2)', () => {
  it.each([
    [10 * 1024 * MB, VIDEO_SAFETY_BYTES],
    [VIDEO_SAFETY_BYTES + VIDEO_RESERVE_BYTES, VIDEO_SAFETY_BYTES],
    [VIDEO_SAFETY_BYTES + VIDEO_RESERVE_BYTES - 1, VIDEO_SAFETY_BYTES - 1],
    [400 * MB, 400 * MB - VIDEO_RESERVE_BYTES],
    [VIDEO_BLOCK_BELOW_BYTES, VIDEO_BLOCK_BELOW_BYTES - VIDEO_RESERVE_BYTES],
  ])('EVM-110 AC2: %i bytes free give a limit of %i bytes (the smaller of 500 000 000 and free minus 150 MB)', (free, limit) => {
    expect(videoSizeLimit(free)).toBe(limit);
  });

  it('EVM-110 AC2: the limit is an integer of at least 1 and at most 2^31-1 - never 0 (the library reads 0 as "no limit"), whatever the reading', () => {
    for (const free of [0, 1, 100, 150 * MB, 150 * MB + 1, -1, Number.NEGATIVE_INFINITY]) {
      const limit = videoSizeLimit(free);
      expect(Number.isInteger(limit)).toBe(true);
      expect(limit).toBeGreaterThanOrEqual(1);
      expect(limit).toBeLessThanOrEqual(INT_MAX);
    }
    for (const free of [null, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(videoSizeLimit(free)).toBeLessThanOrEqual(INT_MAX);
      expect(videoSizeLimit(free)).toBeLessThanOrEqual(VIDEO_SAFETY_BYTES);
    }
    expect(INT_MAX).toBe(2_147_483_647);
    expect(VIDEO_SAFETY_BYTES).toBeLessThan(2_000_000_000);
  });

  it('EVM-110 AC2: the thresholds are 200 MB before the start and 100 MB during the recording', () => {
    expect(VIDEO_BLOCK_BELOW_BYTES).toBe(200 * MB);
    expect(VIDEO_STOP_BELOW_BYTES).toBe(100 * MB);
    expect(videoDiskLevel(VIDEO_BLOCK_BELOW_BYTES - 1)).toBe('blocked');
    expect(videoDiskLevel(VIDEO_BLOCK_BELOW_BYTES)).toBe('ok');
    for (const unknown of [null, Number.NaN, -1, Number.POSITIVE_INFINITY]) expect(videoDiskLevel(unknown)).toBe('ok');
  });
});

describe('the length and size shown in the list (EVM-110 AC1)', () => {
  it.each([
    [0, '0:00'],
    [999, '0:00'],
    [42_000, '0:42'],
    [133_400, '2:13'],
    [300_000, '5:00'],
    [Number.NaN, '0:00'],
    [-5, '0:00'],
  ])('EVM-110 AC1: %p ms read "%s"', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });

  it.each([
    [78 * MB, '78 MB'],
    [1, '1 MB'],
    [190 * MB, '190 MB'],
    [1.2 * 1024 * MB, '1,2 GB'],
    [-1, '0 MB'],
    [Number.NaN, '0 MB'],
  ])('EVM-110 AC1: %p bytes read "%s"', (bytes, text) => {
    expect(formatFileSize(bytes)).toBe(text);
  });
});

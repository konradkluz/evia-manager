import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkFile,
  isVideoType,
  LARGE_VIDEO_BYTES,
  MAX_FILE_BYTES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  readVideoDuration,
} from '../src/work-orders/media-files.ts';
import { formatDuration, mediaText, videosCount } from '../src/work-orders/media-labels.ts';

const file = (name: string, type: string, size = 1000) => ({ name, type, size });

describe('EVM-046 AC1 the check of a chosen film before anything is sent (SR-FILE-01)', () => {
  it('EVM-046 AC1 MP4 and MOV are accepted with the content type of the API; a phone that gives no type is judged by the extension', () => {
    expect(checkFile(file('VID_0415.mp4', 'video/mp4'))).toEqual({ ok: true, contentType: 'video/mp4' });
    expect(checkFile(file('IMG_0001.MOV', 'video/quicktime'))).toEqual({ ok: true, contentType: 'video/quicktime' });
    expect(checkFile(file('IMG_0001.mov', ''))).toEqual({ ok: true, contentType: 'video/quicktime' });
    expect(isVideoType('video/mp4')).toBe(true);
    expect(isVideoType('video/quicktime')).toBe(true);
    expect(isVideoType('image/jpeg')).toBe(false);
  });

  it('EVM-046 AC1 other formats of films (AVI, MKV, WebM) and a type that does not agree with the extension are refused as "format"', () => {
    for (const [name, type] of [
      ['a.avi', 'video/x-msvideo'],
      ['a.mkv', 'video/x-matroska'],
      ['a.webm', 'video/webm'],
      ['a.mp4', 'image/jpeg'],
      ['a.jpg', 'video/mp4'],
      ['a.mp4', 'text/html'],
    ] as const)
      expect(checkFile(file(name, type)), name).toEqual({ ok: false, reason: 'format' });
  });

  it('EVM-046 AC1 the boundary: exactly 4 GiB is accepted, one byte more is refused as "size"; a photo keeps its 50 MB', () => {
    expect(MAX_VIDEO_BYTES).toBe(4_294_967_296);
    expect(checkFile(file('a.mp4', 'video/mp4', MAX_VIDEO_BYTES))).toEqual({ ok: true, contentType: 'video/mp4' });
    expect(checkFile(file('a.mp4', 'video/mp4', MAX_VIDEO_BYTES + 1))).toEqual({ ok: false, reason: 'size' });
    expect(checkFile(file('a.mp4', 'video/mp4', 0))).toEqual({ ok: false, reason: 'empty' });
    expect(checkFile(file('a.jpg', 'image/jpeg', MAX_FILE_BYTES + 1))).toEqual({ ok: false, reason: 'size' });
    expect(checkFile(file('a.jpg', 'image/jpeg', MAX_VIDEO_BYTES))).toEqual({ ok: false, reason: 'size' });
  });

  it('EVM-046 AC8 the warning threshold of a large film is 100 MB (decimal)', () => {
    expect(LARGE_VIDEO_BYTES).toBe(100_000_000);
  });
});

describe('EVM-046 AC1 the duration of a film from its metadata (a convenience; the server checks with ffprobe)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** jsdom plays nothing: a fake element answers the way a browser does once it has read the metadata (or failed). */
  function fakeVideo(behaviour: { duration?: number; fail?: boolean; silent?: boolean }) {
    const created: string[] = [];
    const revoked: string[] = [];
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:fake', revokeObjectURL: (url: string) => revoked.push(url) }));
    const element = {
      preload: '',
      muted: false,
      duration: behaviour.duration ?? Number.NaN,
      onloadedmetadata: null as (() => void) | null,
      onerror: null as (() => void) | null,
      removeAttribute: () => undefined,
      set src(value: string) {
        created.push(value);
        if (behaviour.silent === true) return;
        queueMicrotask(() => (behaviour.fail === true ? element.onerror?.() : element.onloadedmetadata?.()));
      },
    };
    vi.spyOn(document, 'createElement').mockReturnValue(element as unknown as HTMLElement);
    return { created, revoked };
  }

  it('EVM-046 AC1 the duration is read from the metadata and the temporary address is released', async () => {
    const seen = fakeVideo({ duration: 242.4 });
    expect(await readVideoDuration(new Blob(['x']))).toBe(242.4);
    expect(seen.created).toEqual(['blob:fake']);
    expect(seen.revoked).toEqual(['blob:fake']);
  });

  it('EVM-046 AC1 a film the browser cannot read (HEVC without a decoder) or one with an unknown duration gives null, so the server decides', async () => {
    fakeVideo({ fail: true });
    expect(await readVideoDuration(new Blob(['x']))).toBeNull();
    vi.restoreAllMocks();
    fakeVideo({ duration: Number.POSITIVE_INFINITY });
    expect(await readVideoDuration(new Blob(['x']))).toBeNull();
  });

  it('EVM-046 AC1 a browser that never answers does not block the choice: the read gives up with null', async () => {
    vi.useFakeTimers();
    fakeVideo({ silent: true });
    const pending = readVideoDuration(new Blob(['x']), 5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBeNull();
  });

  it('EVM-046 AC1 the limit is 30 minutes', () => {
    expect(MAX_VIDEO_SECONDS).toBe(1800);
  });
});

describe('EVM-046 AC4 the texts of a film', () => {
  it('EVM-046 AC4 the duration of the tile "4:02", the Polish plural of films and the message about 30 minutes', () => {
    expect(formatDuration(242)).toBe('4:02');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(1800)).toBe('30:00');
    expect(formatDuration(3723)).toBe('1:02:03');
    expect(videosCount(1)).toBe('1 film');
    expect(videosCount(3)).toBe('3 filmy');
    expect(videosCount(5)).toBe('5 filmów');
    expect(mediaText.tooLong('VID.mp4')).toContain('Film jest dłuższy niż 30 min.');
  });
});

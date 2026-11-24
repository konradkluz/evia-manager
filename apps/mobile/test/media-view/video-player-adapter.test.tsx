// EVM-143 AC2, AC5, AC6: the adapter of `expo-video` on a stand-in of the library - the source is the address and `useCaching: false` only (no token, no headers, no metadata),
// the player is configured not to stay in the background nor to show a notification, release is idempotent, and the surface has no controls, no fullscreen, no picture in picture.
import { render, screen } from '@testing-library/react-native';
import { createExpoVideoPlayer, VideoSurface } from '../../src/media-view/video-player-adapter';
import type { PlayerEvent, VideoPlayerPort } from '../../src/media-view/video-session';

type Handler = (payload?: unknown) => void;
interface FakeNative {
  staysActiveInBackground: boolean;
  showNowPlayingNotification: boolean;
  timeUpdateEventInterval: number;
  currentTime: number;
  handlers: Record<string, Handler>;
  sources: unknown[];
  calls: string[];
  removed: number;
  replaceFails: boolean;
}
const mockNative: { current: FakeNative | null; created: unknown[] } = { current: null, created: [] };
const mockViewProps: Record<string, unknown>[] = [];

jest.mock('expo-video', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    createVideoPlayer: (source: unknown) => {
      mockNative.created.push(source);
      const native: FakeNative = {
        staysActiveInBackground: true,
        showNowPlayingNotification: true,
        timeUpdateEventInterval: 0,
        currentTime: 0,
        handlers: {},
        sources: [],
        calls: [],
        removed: 0,
        replaceFails: false,
      };
      mockNative.current = native;
      return {
        get staysActiveInBackground() {
          return native.staysActiveInBackground;
        },
        set staysActiveInBackground(value: boolean) {
          native.staysActiveInBackground = value;
        },
        get showNowPlayingNotification() {
          return native.showNowPlayingNotification;
        },
        set showNowPlayingNotification(value: boolean) {
          native.showNowPlayingNotification = value;
        },
        set timeUpdateEventInterval(value: number) {
          native.timeUpdateEventInterval = value;
        },
        get currentTime() {
          return native.currentTime;
        },
        set currentTime(value: number) {
          native.currentTime = value;
          native.calls.push(`seek:${String(value)}`);
        },
        addListener: (name: string, handler: Handler) => {
          native.handlers[name] = handler;
          return {
            remove: () => {
              native.removed += 1;
            },
          };
        },
        replaceAsync: (source: unknown) => {
          native.sources.push(source);
          return native.replaceFails
            ? Promise.reject(new Error('https://bucket.example.test/x?X-Amz-Signature=SECRET'))
            : Promise.resolve();
        },
        play: () => native.calls.push('play'),
        pause: () => native.calls.push('pause'),
        release: () => native.calls.push('release'),
      };
    },
    VideoView: (props: Record<string, unknown>) => {
      mockViewProps.push(props);
      return <View testID={props['testID'] as string} />;
    },
  };
});

const native = (): FakeNative => {
  if (mockNative.current === null) throw new Error('no player');
  return mockNative.current;
};

beforeEach(() => {
  mockNative.current = null;
  mockNative.created = [];
  mockViewProps.length = 0;
});

describe('expo-video adapter (EVM-143 AC2, AC5; SR-MOB-14, MASVS-STORAGE-2)', () => {
  it('EVM-143 AC5: the player is created empty and configured: nothing in the background, no media notification', () => {
    createExpoVideoPlayer();
    expect(mockNative.created).toEqual([null]);
    expect(native().staysActiveInBackground).toBe(false);
    expect(native().showNowPlayingNotification).toBe(false);
    expect(native().timeUpdateEventInterval).toBe(1);
  });

  it('EVM-143 AC5: the source is EXACTLY the address and useCaching false - no headers, no token, no metadata', () => {
    const port = createExpoVideoPlayer();
    port.load('https://bucket.example.test/preview.mp4?sig=SYNTHETIC', 0);
    expect(native().sources).toEqual([{ uri: 'https://bucket.example.test/preview.mp4?sig=SYNTHETIC', useCaching: false }]);
    expect(Object.keys(native().sources[0] as object).sort()).toEqual(['uri', 'useCaching']);
  });

  it('EVM-143 AC3: the position is set after the player is ready (no seek for 0); the events of the player become events of the port', () => {
    const port = createExpoVideoPlayer();
    const events: PlayerEvent[] = [];
    port.subscribe((event) => events.push(event));
    port.load('https://bucket.example.test/a.mp4', 42);
    native().currentTime = 0;
    native().calls.length = 0;
    native().handlers['statusChange']?.({ status: 'loading' });
    expect(native().calls).toEqual([]);
    native().handlers['statusChange']?.({ status: 'readyToPlay' });
    expect(native().calls).toEqual(['seek:42']);
    native().handlers['statusChange']?.({ status: 'readyToPlay' });
    expect(native().calls).toEqual(['seek:42']);
    native().handlers['playingChange']?.({ isPlaying: true });
    native().handlers['timeUpdate']?.({ currentTime: 43 });
    native().handlers['playToEnd']?.();
    native().handlers['statusChange']?.({
      status: 'error',
      error: { message: 'https://bucket.example.test/a.mp4?X-Amz-Signature=SECRET' },
    });
    expect(events).toEqual([
      { kind: 'ready' },
      { kind: 'ready' },
      { kind: 'playing', playing: true },
      { kind: 'time', seconds: 43 },
      { kind: 'ended' },
      { kind: 'error' },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/Amz|SECRET/);
    port.load('https://bucket.example.test/b.mp4', 0);
    native().calls.length = 0;
    native().handlers['statusChange']?.({ status: 'readyToPlay' });
    expect(native().calls).toEqual([]);
  });

  it('EVM-143 AC3: a source that cannot be replaced is an error event without detail', async () => {
    const port = createExpoVideoPlayer();
    const events: PlayerEvent[] = [];
    port.subscribe((event) => events.push(event));
    native().replaceFails = true;
    port.load('https://bucket.example.test/a.mp4', 0);
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual([{ kind: 'error' }]);
  });

  it('EVM-143 AC2: play, pause and position go to the player', () => {
    const port = createExpoVideoPlayer();
    native().currentTime = 7.5;
    port.play();
    port.pause();
    expect(port.position()).toBe(7.5);
    expect(native().calls).toEqual(['play', 'pause']);
  });

  it('EVM-143 AC5: release pauses, removes the listeners and releases ONCE (after the view is unmounted); everything after is a no-op and no event is delivered', () => {
    jest.useFakeTimers();
    const port = createExpoVideoPlayer();
    const events: PlayerEvent[] = [];
    const stop = port.subscribe((event) => events.push(event));
    port.release();
    port.release();
    expect(native().calls).toEqual(['pause']);
    jest.advanceTimersByTime(300);
    jest.useRealTimers();
    expect(native().calls).toEqual(['pause', 'release']);
    expect(native().removed).toBe(4);
    native().calls.length = 0;
    port.play();
    port.pause();
    port.load('https://bucket.example.test/a.mp4', 5);
    expect(port.position()).toBe(0);
    native().handlers['playingChange']?.({ isPlaying: true });
    expect(native().calls).toEqual([]);
    expect(native().sources).toEqual([]);
    expect(events).toEqual([]);
    stop();
  });

  it('EVM-143 AC2, AC5: the surface has no native controls, no fullscreen, no picture in picture (also not automatically), is a textureView and is hidden from the reader', async () => {
    const port = createExpoVideoPlayer();
    await render(<VideoSurface port={port} />);
    expect(screen.getByTestId('video-surface')).toBeOnTheScreen();
    expect(mockViewProps.at(-1)).toMatchObject({
      nativeControls: false,
      fullscreenOptions: { enable: false },
      allowsPictureInPicture: false,
      startsPictureInPictureAutomatically: false,
      surfaceType: 'textureView',
      accessible: false,
      importantForAccessibility: 'no-hide-descendants',
    });
  });

  it('EVM-143 AC2: a port that is not the native one draws nothing', async () => {
    const other: VideoPlayerPort = {
      load: () => undefined,
      play: () => undefined,
      pause: () => undefined,
      position: () => 0,
      subscribe: () => () => undefined,
      release: () => undefined,
    };
    await render(<VideoSurface port={other} />);
    expect(screen.queryByTestId('video-surface')).toBeNull();
  });
});

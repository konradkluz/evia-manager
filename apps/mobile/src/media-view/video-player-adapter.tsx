/**
 * The ONLY file that imports `expo-video` (EVM-143; the rule `no-restricted-imports` of `eslint.config.js` forbids it everywhere else). It turns the native player into the
 * port of `video-session.ts` and draws its surface. Facts checked in the source of `expo-video` 58.0.12 and the reason for every setting (SR-MOB-14, MASVS-STORAGE-2, MASVS-PLATFORM-3):
 * - the source is `{ uri, useCaching: false }` and nothing else: no headers (the signed address is enough: no token and no `Authorization` goes to the bucket), no `metadata`
 *   (title, artist or artwork would reach the media session). With `useCaching: false` the library builds a plain `OkHttpClient` without a disk cache and no `CacheDataSource`;
 * - the player is created by `createVideoPlayer` and released by the session with an explicit `release()` (the hook would release it on its own: a second `release()` is avoided by the `released` flag);
 * - `staysActiveInBackground = false`, `showNowPlayingNotification = false`: nothing plays in the background and there is no media notification;
 * - the surface is a `textureView` (the video is drawn in the surface of the window, so `FLAG_SECURE` of the main window covers it), native controls, fullscreen and picture in picture are OFF
 *   (`FullscreenPlayerActivity` is removed from the manifest by `plugins/with-video.ts`);
 * - the error of the player (its message may carry the address) is dropped: only the fact of an error is passed on.
 */
import { createVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import type { PlayerEvent, VideoPlayerPort } from './video-session';

/** Seconds between two `time` events (the position that a refresh resumes from). */
const TIME_UPDATE_SECONDS = 1;

/** The port plus the native player the surface draws (the session never sees it). */
export interface ExpoVideoPlayerPort extends VideoPlayerPort {
  readonly native: VideoPlayer;
}

export function createExpoVideoPlayer(): ExpoVideoPlayerPort {
  const player = createVideoPlayer(null);
  player.staysActiveInBackground = false;
  player.showNowPlayingNotification = false;
  player.timeUpdateEventInterval = TIME_UPDATE_SECONDS;
  const listeners = new Set<(event: PlayerEvent) => void>();
  let released = false;
  let seekTo: number | null = null;
  const emit = (event: PlayerEvent): void => {
    if (released) return;
    for (const listener of [...listeners]) listener(event);
  };
  const subscriptions = [
    player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') {
        if (seekTo !== null) {
          player.currentTime = seekTo;
          seekTo = null;
        }
        emit({ kind: 'ready' });
      } else if (status === 'error') emit({ kind: 'error' });
    }),
    player.addListener('playingChange', ({ isPlaying }) => {
      emit({ kind: 'playing', playing: isPlaying });
    }),
    player.addListener('playToEnd', () => {
      emit({ kind: 'ended' });
    }),
    player.addListener('timeUpdate', ({ currentTime }) => {
      emit({ kind: 'time', seconds: currentTime });
    }),
  ];
  return {
    native: player,
    load(url, startAt) {
      if (released) return;
      seekTo = startAt > 0 ? startAt : null;
      player.replaceAsync({ uri: url, useCaching: false }).catch(() => {
        emit({ kind: 'error' });
      });
    },
    play() {
      if (!released) player.play();
    },
    pause() {
      if (!released) player.pause();
    },
    position() {
      return released ? 0 : player.currentTime;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    release() {
      if (released) return;
      released = true;
      listeners.clear();
      try {
        player.pause();
      } catch {
        // already gone
      }
      for (const subscription of subscriptions) subscription.remove();
      player.release();
    },
  };
}

/** The picture of the film: no native controls, no fullscreen, no picture in picture, drawn in the window (`textureView`) - hidden from the screen reader. */
export function VideoSurface({ port }: { port: VideoPlayerPort }) {
  const native = (port as Partial<ExpoVideoPlayerPort>).native;
  if (native === undefined) return null;
  return (
    <VideoView
      player={native}
      nativeControls={false}
      fullscreenOptions={{ enable: false }}
      allowsPictureInPicture={false}
      startsPictureInPictureAutomatically={false}
      surfaceType="textureView"
      contentFit="contain"
      style={{ width: '100%', height: '100%' }}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      testID="video-surface"
    />
  );
}

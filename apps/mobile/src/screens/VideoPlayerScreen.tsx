import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Image, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createExpoVideoPlayer, VideoSurface } from '../media-view/video-player-adapter';
import { VideoSession, type VideoPhase, type VideoSnapshot } from '../media-view/video-session';
import type { OrderMedia } from '../orders/order-photos-model';
import { Ban, Button, CloudAlert, Icon, Video, WifiOff, X } from '../ui';
import { useFontScaleTier } from '../ui/fontScale';
import { color, size, space, text } from '../ui/theme';
import { photoCaption } from './PhotoTile';
import { useSession } from './session-context';

/** At a large font the film area keeps at least a third of the window (M-08c: 35%); the whole screen scrolls so that the button is always reachable. */
const VIDEO_MIN_HEIGHT = 0.35;
const VIDEO_ASPECT = 16 / 9;
const IDLE: VideoSnapshot = { phase: 'idle', port: null };
const NO_SUBSCRIBE = (): (() => void) => () => undefined;

function Notice({ icon, message }: { icon: LucideIcon; message: string }) {
  return (
    <View
      style={{ alignItems: 'center', rowGap: space.stack.md, padding: space.inset.md }}
      accessibilityRole="alert"
      testID="video-player-notice"
    >
      <Icon icon={icon} color={color.icon.inverse} iconSize="2xl" />
      <Text style={{ ...text.body, color: color.text.inverse, textAlign: 'center' }}>{message}</Text>
    </View>
  );
}

const ACTION_LABEL: Readonly<Record<VideoPhase, string | null>> = {
  idle: 'orderPhotos.video.play',
  loading: 'orderPhotos.video.play',
  playing: 'orderPhotos.video.pause',
  paused: 'orderPhotos.video.play',
  ended: 'orderPhotos.video.replay',
  failed: 'orderPhotos.video.retry',
  offline: 'orderPhotos.video.retry',
  unavailable: null,
};

/**
 * M-08c "Odtwarzacz filmu" (EVM-143 AC2-AC6): a view in the MAIN window (not a `Modal`, not another activity) - the child of the root of `LockGate`, so the cover of the lock covers it
 * and the window of the release build keeps `FLAG_SECURE`. Until "Odtwórz" it shows the thumbnail of the grid (already in memory) and asks for NOTHING; the address of the 720p preview is
 * requested by the touch, streamed by the player (no file, no cache, no background playback, no notification, no fullscreen, no picture in picture) and held by the session only. One
 * button: "Odtwórz" / "Pauza" / "Odtwórz ponownie". An expired address is renewed once, silently, from the same second; after a second failure "Nie udało się odtworzyć filmu" with "Spróbuj
 * ponownie"; 403/404 is final; without the network "Film wymaga internetu" and a manual retry (nothing starts when the network returns). The session frees the player on the lock,
 * the hidden-data mode, the background, the end of the session and the closing of this screen. No `liveRegion`, no announcement of the progress; the category and the time come from the
 * replica (no name of a file, no id, no address - not in a `testID` either).
 */
export function VideoPlayerScreen({
  video,
  orderId,
  online,
  onClose,
}: {
  video: OrderMedia;
  orderId: string;
  online: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { mediaView } = useSession();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const tier = useFontScaleTier();
  const header = useRef<ComponentRef<typeof View>>(null);
  const onlineNow = useRef(online);
  onlineNow.current = online;
  const [session, setSession] = useState<VideoSession | null>(null);
  const snapshot = useSyncExternalStore(session?.subscribe ?? NO_SUBSCRIBE, session?.getSnapshot ?? (() => IDLE));
  const { category, time } = photoCaption(video, t);

  useEffect(() => {
    const created = new VideoSession({
      viewer: mediaView,
      createPort: createExpoVideoPlayer,
      isOnline: () => onlineNow.current,
      workOrderId: orderId,
      mediaAssetId: video.id,
    });
    setSession(created);
    return () => {
      created.dispose();
      setSession(null);
    };
  }, [mediaView, orderId, video.id]);
  useEffect(() => {
    if (header.current !== null) AccessibilityInfo.sendAccessibilityEvent(header.current, 'focus');
  }, []);

  const { phase, port } = snapshot;
  const placeholder = mediaView.peek('thumbnail', video.id);
  const landscape = width > height;
  const large = tier === 'large';
  const actionKey = ACTION_LABEL[phase];
  const final = phase === 'failed' || phase === 'offline' || phase === 'unavailable';
  const showFrame = !final && (port === null || phase === 'loading');

  const area = (
    <View
      style={{
        width: landscape ? '55%' : '100%',
        aspectRatio: VIDEO_ASPECT,
        minHeight: large ? height * VIDEO_MIN_HEIGHT : undefined,
        backgroundColor: color.bg.inverse,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      testID="video-player-area"
    >
      {port !== null && !final ? <VideoSurface port={port} /> : null}
      {phase === 'unavailable' ? <Notice icon={Ban} message={t('orderPhotos.video.unavailable')} /> : null}
      {phase === 'failed' ? <Notice icon={CloudAlert} message={t('orderPhotos.video.failed')} /> : null}
      {phase === 'offline' ? <Notice icon={WifiOff} message={t('orderPhotos.video.offline')} /> : null}
      {showFrame ? (
        <View
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: color.bg.skeleton }}
          pointerEvents="none"
        >
          {placeholder === undefined ? null : (
            <Image
              source={{ uri: placeholder }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="contain"
              fadeDuration={0}
              accessible={false}
              importantForAccessibility="no"
              testID="video-player-frame"
            />
          )}
        </View>
      ) : null}
    </View>
  );

  const controls = (
    <View style={{ padding: space.inset.md, rowGap: space.stack.md, flex: landscape ? 1 : undefined }}>
      {actionKey === null || session === null ? null : (
        <Button
          label={t(actionKey)}
          variant="primary"
          inverse
          fullWidth
          busy={phase === 'loading'}
          accessibilityLabel={phase === 'loading' ? t('orderPhotos.video.loading') : t(actionKey)}
          onPress={() => {
            if (phase === 'playing') session.toggle();
            else session.start();
          }}
          testID="video-player-action"
        />
      )}
    </View>
  );

  return (
    <View
      style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: color.bg.inverse, paddingTop: insets.top }}
      accessibilityViewIsModal
      testID="video-player"
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: space.inline.sm, paddingHorizontal: space.inset.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('orderPhotos.video.close')}
          onPress={onClose}
          testID="video-player-close"
          style={{ width: size.touchTarget.min, height: size.touchTarget.min, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon icon={X} color={color.icon.inverse} iconSize="md" />
        </Pressable>
        <View
          ref={header}
          accessible
          accessibilityRole="header"
          accessibilityLabel={t(time === null ? 'orderPhotos.video.announceNoTime' : 'orderPhotos.video.announce', { category, time })}
          style={{ flex: 1 }}
          testID="video-player-header"
        >
          <Text style={{ ...text.heading4, color: color.text.inverse }}>{category}</Text>
          {time === null ? null : <Text style={{ ...text.bodySm, color: color.text.inverse }}>{time}</Text>}
          <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: space.inline.xs }}>
            <Icon icon={Video} color={color.icon.inverse} iconSize="sm" />
            <Text style={{ ...text.label, color: color.text.inverse }}>{t('orderPhotos.videoLabel')}</Text>
          </View>
        </View>
      </View>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          flexDirection: landscape ? 'row' : 'column',
          justifyContent: landscape ? undefined : 'center',
        }}
        testID="video-player-scroll"
      >
        {area}
        {controls}
      </ScrollView>
    </View>
  );
}

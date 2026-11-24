import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Image, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { OrderMedia } from '../orders/order-photos-model';
import { Ban, Button, CloudAlert, Icon, WifiOff, X } from '../ui';
import { borderWidth, color, size, space, text } from '../ui/theme';
import { photoCaption } from './PhotoTile';
import { usePhotoImage } from './order-photos-hooks';
import { useSession } from './session-context';

/** The panel of the description takes at most this part of the window; the bar at most a quarter; the photo keeps at least a third (M-08b, 200% of the font). */
const PANEL_MAX = 0.4;
const BAR_MAX = 0.25;
const PHOTO_MIN = 0.35;

function Notice({
  icon,
  message,
  action,
}: {
  icon: LucideIcon;
  message: string;
  action?: { label: string; busy: boolean; onPress: () => void };
}) {
  return (
    <View
      style={{ alignItems: 'center', rowGap: space.stack.md, padding: space.inset.md }}
      accessibilityLiveRegion="assertive"
      accessibilityRole="alert"
    >
      <Icon icon={icon} color={color.icon.inverse} iconSize="xl" />
      <Text style={{ ...text.body, color: color.text.inverse, textAlign: 'center' }}>{message}</Text>
      {action === undefined ? null : (
        <Button
          label={action.label}
          variant="primary"
          inverse
          fullWidth
          busy={action.busy}
          onPress={action.onPress}
          testID="photo-preview-retry"
        />
      )}
    </View>
  );
}

/**
 * M-08b "Podgląd zdjęcia" (EVM-142 AC3, AC5): a view in the MAIN window (not a `Modal`, not another activity) - the child of the root of `LockGate`, so the cover of the lock covers it
 * and the window of the release build keeps `FLAG_SECURE`. The 1600 px variant is fetched into the memory of the viewer; while it loads the thumbnail of the grid (already in
 * memory) or a skeleton stays in its place - no spinner. The expired address is renewed ONCE by the viewer, silently; a second failure (or a network error) gives "Nie udało się wczytać
 * zdjęcia" and "Spróbuj ponownie", which asks for a NEW address; offline says so, and the first return of the network tries once, silently. A `403` / `404` is final. Closing is by "Zamknij" or the system
 * Back only (the shell handles it) - no gesture and no touch of the background, so gloves cannot close it by accident. No zoom, no sharing, no saving: the description cannot be selected or copied.
 * The category, the time and the description come from the replica; the name of a file, an id and an address are nowhere.
 */
export function PhotoPreview({
  photo,
  orderId,
  online,
  onClose,
}: {
  photo: OrderMedia;
  orderId: string;
  online: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { mediaView } = useSession();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { state, uri, reload } = usePhotoImage({ workOrderId: orderId, mediaAssetId: photo.id, variant: 'preview', active: true });
  const [retrying, setRetrying] = useState(false);
  const header = useRef<ComponentRef<typeof View>>(null);
  const { category, time } = photoCaption(photo, t);

  useEffect(() => {
    if (header.current !== null) AccessibilityInfo.sendAccessibilityEvent(header.current, 'focus');
  }, []);
  useEffect(() => {
    if (state !== 'loading') setRetrying(false);
  }, [state]);
  // the first return of the network after a failure tries once more, without a word
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current && state === 'retry') reload();
    wasOnline.current = online;
  }, [online, state, reload]);

  const placeholder = mediaView.peek('thumbnail', photo.id);
  const shown = uri ?? (state === 'loading' ? placeholder : undefined);
  const failed = state === 'retry' || (state === 'loading' && retrying);
  const description = photo.description;

  return (
    <View
      style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: color.bg.inverse, paddingTop: insets.top }}
      accessibilityViewIsModal
      testID="photo-preview"
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          columnGap: space.inline.sm,
          maxHeight: height * BAR_MAX,
          paddingHorizontal: space.inset.sm,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('orderPhotos.preview.close')}
          onPress={onClose}
          testID="photo-preview-close"
          style={{ width: size.touchTarget.min, height: size.touchTarget.min, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon icon={X} color={color.icon.inverse} iconSize="md" />
        </Pressable>
        <View
          ref={header}
          accessible
          accessibilityRole="header"
          accessibilityLabel={t(time === null ? 'orderPhotos.preview.announceNoTime' : 'orderPhotos.preview.announce', { category, time })}
          style={{ flex: 1 }}
          testID="photo-preview-header"
        >
          <Text style={{ ...text.heading4, color: color.text.inverse }}>{category}</Text>
          {time === null ? null : <Text style={{ ...text.bodySm, color: color.text.inverse }}>{time}</Text>}
        </View>
      </View>
      <View style={{ flex: 1, minHeight: height * PHOTO_MIN, alignItems: 'center', justifyContent: 'center' }} testID="photo-preview-area">
        {state === 'forbidden' || state === 'not_found' ? (
          <Notice icon={Ban} message={t('orderPhotos.preview.unavailable')} />
        ) : failed ? (
          <Notice
            icon={online ? CloudAlert : WifiOff}
            message={online ? t('orderPhotos.preview.loadFailed') : t('orderPhotos.preview.offline')}
            action={{
              label: t('orderPhotos.preview.retry'),
              busy: retrying && state === 'loading',
              onPress: () => {
                setRetrying(true);
                reload();
              },
            }}
          />
        ) : shown === undefined ? (
          <View
            accessible
            accessibilityLabel={t('orderPhotos.preview.loading')}
            accessibilityState={{ busy: true }}
            style={{ width: '100%', aspectRatio: 1, backgroundColor: color.bg.skeleton }}
            testID="photo-preview-skeleton"
          />
        ) : (
          <Image
            source={{ uri: shown }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="contain"
            fadeDuration={0}
            accessible={false}
            importantForAccessibility="no"
            testID="photo-preview-image"
          />
        )}
      </View>
      {description === null ? null : (
        <View
          style={{
            maxHeight: height * PANEL_MAX,
            borderTopWidth: borderWidth.indicator,
            borderTopColor: color.border.inverse,
            paddingBottom: insets.bottom,
          }}
          testID="photo-preview-description"
        >
          <ScrollView contentContainerStyle={{ padding: space.inset.md, rowGap: space.stack.xs }} persistentScrollbar>
            <Text style={{ ...text.labelLg, color: color.text.inverse }}>{t('orderPhotos.preview.description')}</Text>
            <Text selectable={false} style={{ ...text.body, color: color.text.inverse }}>
              {description}
            </Text>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

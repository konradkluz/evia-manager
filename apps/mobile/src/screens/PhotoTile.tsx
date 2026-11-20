import type { LucideIcon } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, Text, View } from 'react-native';
import { formatDateTime } from '../i18n/format';
import type { OrderPhoto, PhotoState } from '../orders/order-photos-model';
import { Ban, Clock, Icon, Image as ImageIcon, ScanSearch, StatusBadge, TriangleAlert } from '../ui';
import type { BadgeTone } from '../ui';
import { borderWidth, color, radius, size, space, text } from '../ui/theme';
import { usePhotoImage } from './order-photos-hooks';

type Translate = (key: string) => string;

/** The category and the time of a photo, the same words for the caption under a tile, its accessible name and the bar of the preview (never a name of a file or an id). */
export function photoCaption(photo: OrderPhoto, t: Translate): { readonly category: string; readonly time: string | null } {
  return {
    category: photo.category === null ? t('upload.noCategory') : t(`camera.categories.${photo.category}`),
    time: photo.capturedAt === null ? null : formatDateTime(photo.capturedAt),
  };
}

interface Marker {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly tone: BadgeTone;
}

/** The mark of a state of the file or of the load (styleguide § 4.14: an icon and the full label, never an icon alone). */
function markerOf(kind: Exclude<PhotoState, 'ready'> | 'loadFailed' | 'unavailable', t: Translate): Marker {
  switch (kind) {
    case 'preparing':
      return { icon: ScanSearch, label: t('orderPhotos.states.preparing'), tone: color.sync.queued };
    case 'quarantined':
      return { icon: TriangleAlert, label: t('orderPhotos.states.quarantined'), tone: color.sync.error };
    case 'failed':
      return { icon: ImageIcon, label: t('orderPhotos.states.failed'), tone: color.status.unknown };
    case 'awaiting_file':
      return { icon: Clock, label: t('orderPhotos.states.awaiting'), tone: color.sync.queued };
    case 'loadFailed':
      return { icon: ImageIcon, label: t('orderPhotos.states.loadFailed'), tone: color.status.unknown };
    case 'unavailable':
      return { icon: Ban, label: t('orderPhotos.states.unavailable'), tone: color.status.unknown };
  }
}

const boxStyle = (width: number) =>
  ({
    width,
    height: width,
    borderRadius: radius.thumbnail,
    borderWidth: borderWidth.default,
    borderColor: color.border.subtle,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  }) as const;

/** The text under the tile: the category, the time and the mark of the state; it wraps and is never cut (200% of the font). */
function Caption({ category, time, marker }: { category: string; time: string | null; marker: Marker | null }) {
  return (
    <View style={{ rowGap: space.stack.xs }}>
      <Text style={{ ...text.label, color: color.text.primary }}>{category}</Text>
      {time === null ? null : <Text style={{ ...text.bodySm, color: color.text.secondary }}>{time}</Text>}
      {marker === null ? null : <StatusBadge icon={marker.icon} label={marker.label} tone={marker.tone} />}
    </View>
  );
}

function EmptyBox({ width, icon, tone }: { width: number; icon: LucideIcon; tone: 'neutral' | 'error' }) {
  return (
    <View style={{ ...boxStyle(width), backgroundColor: color.bg.surfaceSubtle }}>
      <Icon icon={icon} color={tone === 'error' ? color.feedback.error.icon : color.icon.secondary} iconSize="xl" />
    </View>
  );
}

/** A tile whose file is not ready (or has not arrived): a text group, not a button - a reader is not promised an action that is not there; no request at all. */
function StaticTile({ photo, width, testID }: { photo: OrderPhoto; width: number; testID: string }) {
  const { t } = useTranslation();
  const { category, time } = photoCaption(photo, t);
  const kind = photo.state === 'ready' ? 'preparing' : photo.state;
  const marker = markerOf(kind, t);
  const icon = kind === 'quarantined' ? TriangleAlert : kind === 'awaiting_file' ? Clock : kind === 'failed' ? ImageIcon : ScanSearch;
  return (
    <View
      accessible
      accessibilityLabel={[category, time, marker.label].filter((part): part is string => part !== null).join(', ')}
      style={{ width, rowGap: space.stack.xs }}
      testID={testID}
    >
      <EmptyBox width={width} icon={icon} tone={kind === 'quarantined' ? 'error' : 'neutral'} />
      <Caption category={category} time={time} marker={marker} />
    </View>
  );
}

/**
 * A tile of a `ready` photo (EVM-142 AC2, AC3, AC6): a square thumbnail (`cover`) with the category and the time UNDER it - nothing lies on the photo. The whole tile is ONE button
 * named "[category], [time]" (the thumbnail is decoration; no file name, no id); while the thumbnail loads it is a skeleton and a touch already opens the preview. A failed load
 * says so under the tile and a touch loads it again (no automatic loop); a `404` is final ("Zdjęcie niedostępne"); the first `403` is reported up (the whole grid then says it).
 */
function ReadyTile({
  photo,
  orderId,
  width,
  active,
  retryKey,
  onOpen,
  onFailure,
  onForbidden,
  testID,
}: {
  photo: OrderPhoto;
  orderId: string;
  width: number;
  active: boolean;
  retryKey: number;
  onOpen: () => void;
  onFailure: (photoId: string, failed: boolean) => void;
  onForbidden: () => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const { state, uri, reload } = usePhotoImage({ workOrderId: orderId, mediaAssetId: photo.id, variant: 'thumbnail', active, retryKey });
  const { category, time } = photoCaption(photo, t);
  useEffect(() => {
    if (state === 'forbidden') onForbidden();
    onFailure(photo.id, state === 'retry');
    return () => {
      onFailure(photo.id, false);
    };
  }, [state, photo.id, onFailure, onForbidden]);
  if (state === 'not_found' || state === 'forbidden') {
    const marker = markerOf('unavailable', t);
    return (
      <View
        accessible
        accessibilityLabel={[category, time, marker.label].filter((p): p is string => p !== null).join(', ')}
        style={{ width, rowGap: space.stack.xs }}
        testID={testID}
      >
        <EmptyBox width={width} icon={Ban} tone="neutral" />
        <Caption category={category} time={time} marker={marker} />
      </View>
    );
  }
  const failed = state === 'retry';
  const marker = failed ? markerOf('loadFailed', t) : null;
  const name = [category, time, marker?.label ?? null].filter((part): part is string => part !== null).join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityHint={failed ? t('orderPhotos.tileRetryHint') : t('orderPhotos.tileHint')}
      onPress={failed ? reload : onOpen}
      testID={testID}
      style={{ width, minHeight: size.touchTarget.min, rowGap: space.stack.xs }}
    >
      {failed ? (
        <EmptyBox width={width} icon={ImageIcon} tone="neutral" />
      ) : (
        <View style={{ ...boxStyle(width), backgroundColor: color.bg.skeleton }}>
          {uri === undefined ? null : (
            <Image
              source={{ uri }}
              style={{ width, height: width }}
              resizeMode="cover"
              fadeDuration={0}
              accessible={false}
              importantForAccessibility="no"
              testID={`${testID}-image`}
            />
          )}
        </View>
      )}
      <Caption category={category} time={time} marker={marker} />
    </Pressable>
  );
}

/**
 * One tile of the grid "Zdjęcia zlecenia" (M-08a). `testID` and every accessible name are made from the category, the time and the state only - never an id of the photo or of the
 * order (the caller passes the position as the testID suffix).
 */
export function PhotoTile(props: {
  photo: OrderPhoto;
  orderId: string;
  width: number;
  active: boolean;
  retryKey: number;
  testID: string;
  onOpen: () => void;
  onFailure: (photoId: string, failed: boolean) => void;
  onForbidden: () => void;
}) {
  if (props.photo.state !== 'ready') return <StaticTile photo={props.photo} width={props.width} testID={props.testID} />;
  return <ReadyTile {...props} />;
}

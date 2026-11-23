import type { LucideIcon } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, Text, View } from 'react-native';
import { formatDateTime } from '../i18n/format';
import type { OrderMedia, PhotoState } from '../orders/order-photos-model';
import { Ban, Clock, Icon, ImageIcon, ScanSearch, TriangleAlert } from '../ui';
import { borderWidth, color, radius, size, space, text } from '../ui/theme';
import { usePhotoImage } from './order-photos-hooks';

type Translate = (key: string) => string;

/** The category and the time of a photo, the same words for the caption under a tile, its accessible name and the bar of the preview (never a name of a file or an id). */
export function photoCaption(photo: OrderMedia, t: Translate): { readonly category: string; readonly time: string | null } {
  return {
    category: photo.category === null ? t('upload.noCategory') : t(`camera.categories.${photo.category}`),
    time: photo.capturedAt === null ? null : formatDateTime(photo.capturedAt),
  };
}

/** How the state field and its text look: the tones of styleguide § 4.14 and the table of the "pole stanu" of M-08a (EVM-142). */
interface Look {
  readonly bg: string;
  readonly border: string;
  readonly icon: string;
  readonly text: string;
}

const QUEUED_LOOK: Look = {
  bg: color.bg.surfaceSubtle,
  border: color.border.default,
  icon: color.sync.queued.icon,
  text: color.sync.queued.text,
};
const ERROR_LOOK: Look = {
  bg: color.sync.error.bg,
  border: color.feedback.error.border,
  icon: color.sync.error.icon,
  text: color.sync.error.text,
};
const NEUTRAL_LOOK: Look = {
  bg: color.bg.surfaceSubtle,
  border: color.border.default,
  icon: color.icon.secondary,
  text: color.text.secondary,
};

interface Marker {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly look: Look;
}

/** The mark of a state of the file or of the load (styleguide § 4.14: an icon and the full label, never an icon alone). */
function markerOf(kind: Exclude<PhotoState, 'ready'> | 'loadFailed' | 'unavailable', t: Translate): Marker {
  switch (kind) {
    case 'preparing':
      return { icon: ScanSearch, label: t('orderPhotos.states.preparing'), look: QUEUED_LOOK };
    case 'quarantined':
      return { icon: TriangleAlert, label: t('orderPhotos.states.quarantined'), look: ERROR_LOOK };
    case 'failed':
      return { icon: ImageIcon, label: t('orderPhotos.states.failed'), look: NEUTRAL_LOOK };
    case 'awaiting_file':
      return { icon: Clock, label: t('orderPhotos.states.awaiting'), look: QUEUED_LOOK };
    case 'loadFailed':
      return { icon: ImageIcon, label: t('orderPhotos.states.loadFailed'), look: NEUTRAL_LOOK };
    case 'unavailable':
      return { icon: Ban, label: t('orderPhotos.states.unavailable'), look: NEUTRAL_LOOK };
  }
}

/** `grid`: a square tile with the text under it; `row`: one column, the box 96 x 96 on the left and the text beside it (a font above 130%). */
export type TileLayout = 'grid' | 'row';

const boxStyle = (box: number) =>
  ({
    width: box,
    height: box,
    borderRadius: radius.thumbnail,
    borderWidth: borderWidth.default,
    borderColor: color.border.subtle,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  }) as const;

/** The text under/beside the tile: the category, the time and the text of the state (no pill, no background); it wraps on word boundaries and is never cut (200% of the font). */
function Caption({ category, time, marker, row }: { category: string; time: string | null; marker: Marker | null; row: boolean }) {
  return (
    <View style={{ rowGap: space.stack.xs, ...(row ? { flex: 1 } : {}) }}>
      <Text style={{ ...text.label, color: color.text.primary }}>{category}</Text>
      {time === null ? null : <Text style={{ ...text.bodySm, color: color.text.secondary }}>{time}</Text>}
      {marker === null ? null : <Text style={{ ...text.bodySm, color: marker.look.text }}>{marker.label}</Text>}
    </View>
  );
}

/** The "pole stanu": the empty square of the tile carries the icon of the state; its outline is always visible (also when the fill is almost the colour of the screen). */
function StateBox({ box, marker, testID }: { box: number; marker: Marker; testID: string }) {
  return (
    <View style={{ ...boxStyle(box), backgroundColor: marker.look.bg, borderColor: marker.look.border }} testID={testID}>
      <Icon icon={marker.icon} color={marker.look.icon} iconSize="xl" />
    </View>
  );
}

/** The frame of a tile: the box and the caption one under the other (grid) or side by side (row); rows are aligned to the top, never stretched (tiles with a state may be taller). */
const frameStyle = (width: number, layout: TileLayout) =>
  layout === 'row'
    ? ({ width, minHeight: size.thumbnail.md, flexDirection: 'row', alignItems: 'flex-start', columnGap: space.inline.sm } as const)
    : ({ width, rowGap: space.stack.xs } as const);

const boxSizeOf = (width: number, layout: TileLayout): number => (layout === 'row' ? size.thumbnail.md : width);

/** A tile whose file is not ready (or has not arrived): a text group, not a button - a reader is not promised an action that is not there; no request at all. */
function StaticTile({
  photo,
  marker,
  width,
  layout,
  testID,
}: {
  photo: OrderMedia;
  marker: Marker;
  width: number;
  layout: TileLayout;
  testID: string;
}) {
  const { t } = useTranslation();
  const { category, time } = photoCaption(photo, t);
  return (
    <View
      accessible
      accessibilityLabel={[category, time, marker.label].filter((part): part is string => part !== null).join(', ')}
      style={frameStyle(width, layout)}
      testID={testID}
    >
      <StateBox box={boxSizeOf(width, layout)} marker={marker} testID={`${testID}-box`} />
      <Caption category={category} time={time} marker={marker} row={layout === 'row'} />
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
  layout,
  active,
  retryKey,
  onOpen,
  onFailure,
  onForbidden,
  testID,
}: {
  photo: OrderMedia;
  orderId: string;
  width: number;
  layout: TileLayout;
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
    return <StaticTile photo={photo} marker={markerOf('unavailable', t)} width={width} layout={layout} testID={testID} />;
  }
  const marker = state === 'retry' ? markerOf('loadFailed', t) : null;
  const name = [category, time, marker?.label ?? null].filter((part): part is string => part !== null).join(', ');
  const box = boxSizeOf(width, layout);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityHint={marker !== null ? t('orderPhotos.tileRetryHint') : t('orderPhotos.tileHint')}
      onPress={marker !== null ? reload : onOpen}
      testID={testID}
      style={{ ...frameStyle(width, layout), minHeight: layout === 'row' ? size.thumbnail.md : size.touchTarget.min }}
    >
      {marker !== null ? (
        <StateBox box={box} marker={marker} testID={`${testID}-box`} />
      ) : (
        <View style={{ ...boxStyle(box), backgroundColor: color.bg.skeleton }}>
          {uri === undefined ? null : (
            <Image
              source={{ uri }}
              style={{ width: box, height: box }}
              resizeMode="cover"
              fadeDuration={0}
              accessible={false}
              importantForAccessibility="no"
              testID={`${testID}-image`}
            />
          )}
        </View>
      )}
      <Caption category={category} time={time} marker={marker} row={layout === 'row'} />
    </Pressable>
  );
}

/**
 * One tile of the grid "Zdjęcia zlecenia" (M-08a). `testID` and every accessible name are made from the category, the time and the state only - never an id of the photo or of the
 * order (the caller passes the position as the testID suffix). `width` is the width of the tile (grid) or of the whole row (`layout="row"`).
 */
export function PhotoTile(props: {
  photo: OrderMedia;
  orderId: string;
  width: number;
  layout?: TileLayout;
  active: boolean;
  retryKey: number;
  testID: string;
  onOpen: () => void;
  onFailure: (photoId: string, failed: boolean) => void;
  onForbidden: () => void;
}) {
  const { t } = useTranslation();
  const { state } = props.photo;
  const layout = props.layout ?? 'grid';
  if (state !== 'ready')
    return <StaticTile photo={props.photo} marker={markerOf(state, t)} width={props.width} layout={layout} testID={props.testID} />;
  return <ReadyTile {...props} layout={layout} />;
}

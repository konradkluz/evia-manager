import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Text, View, useWindowDimensions } from 'react-native';
import type { OrderPhoto } from '../orders/order-photos-model';
import { useStartup } from '../startup';
import { AppBar, Button, EmptyState, EyeOff, ImageIcon, Inbox, InlineAlert, Lock, Skeleton, WifiOff } from '../ui';
import { color, size, space, text } from '../ui/theme';
import { PhotoPreview } from './PhotoPreview';
import { PhotoTile, photoCaption } from './PhotoTile';
import { SyncCapsule } from './SyncCapsule';
import { useOrderPhotos } from './order-photos-hooks';
import { useGuard, useSession } from './session-context';

/** Key of the label of the action of the hidden-data notice for the reasons that have one (the same words as M-08). */
const HIDDEN_ACTION = {
  screen_lock_off: 'hidden.screenLockOff.action',
  contact_expired: 'hidden.contactExpired.action',
  clock_anomaly: 'hidden.clockAnomaly.action',
} as const;

/** Three columns only at a font of at most 100% and when a tile keeps at least 104 dp; two up to 130%; above that one column - a row (M-08a, measured on the emulator). */
const MAX_FONT_SCALE_FOR_THREE = 1;
const MAX_FONT_SCALE_FOR_TWO = 1.3;
const MIN_TILE_FOR_THREE = 104;
/** The tiles that load are the visible ones plus one row before and after; before the first report of the list the first three rows. */
const INITIAL_ROWS = 3;
/** A module constant: a new object at every render would make the list reset its viewability tracking. */
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 1 } as const;

export function columnsFor(windowWidth: number, fontScale: number): 1 | 2 | 3 {
  if (fontScale > MAX_FONT_SCALE_FOR_TWO) return 1;
  const three = (windowWidth - 2 * space.inset.md - 2 * space.inline.xs) / 3;
  return fontScale <= MAX_FONT_SCALE_FOR_THREE && three >= MIN_TILE_FOR_THREE ? 3 : 2;
}

/**
 * M-08a "Zdjęcia zlecenia" (EVM-142 AC2, AC4, AC5, AC6): the photos of the open order from the replica, newest first, as a grid of tiles; the thumbnails come from the server, online,
 * into the memory of the process (see `media-view/`), and only for the tiles that are visible and one row around them. Offline (and ONLY then) the grid is a plain list of the rows
 * of the replica with "Podgląd zdjęć wymaga internetu", no request and no empty squares; when the network returns the list turns into the grid by itself.
 * - Hidden data (any reason), the lock of the app: nothing of the order is drawn - one sentence; the requests are aborted by the cleanups of the tiles (and the viewer is closed by its own wiring).
 * - A `403` on a thumbnail: "Zdjęcia niedostępne..." instead of the grid, without a code or a reason. A `404` is one tile ("Zdjęcie niedostępne"); a failed tile says so and a touch loads it again; any
 *   failure of the network or the server adds "Nie udało się wczytać części zdjęć." with "Spróbuj ponownie" (all failed tiles).
 * - The preview is a layer over the grid in the same window; the shell holds which photo is open (`previewId`: an id is the only datum, like the order).
 */
export function OrderPhotosScreen({
  orderId,
  previewId,
  onOpenPreview,
  onClosePreview,
  onBack,
  onOpenQueue,
}: {
  orderId: string;
  previewId: string | null;
  onOpenPreview: (photoId: string) => void;
  onClosePreview: () => void;
  onBack: () => void;
  onOpenQueue: () => void;
}) {
  const { t } = useTranslation();
  const session = useSession();
  const guard = useGuard();
  const online = useStartup().state.kind !== 'offline';
  const { concealed, photos, failed: readFailed, reload } = useOrderPhotos(orderId);
  const { width, fontScale } = useWindowDimensions();
  const columns = columnsFor(width, fontScale);
  const tileWidth = Math.floor((width - 2 * space.inset.md - (columns - 1) * space.inline.xs) / columns);
  const [forbidden, setForbidden] = useState(false);
  const [failedTiles, setFailedTiles] = useState<ReadonlySet<string>>(new Set());
  const [retryKey, setRetryKey] = useState(0);
  const [range, setRange] = useState<{ first: number; last: number } | null>(null);

  const noteFailure = useCallback((photoId: string, failed: boolean) => {
    setFailedTiles((current) => {
      if (current.has(photoId) === failed) return current;
      const next = new Set(current);
      if (failed) next.add(photoId);
      else next.delete(photoId);
      return next;
    });
  }, []);
  const noteForbidden = useCallback(() => {
    setForbidden(true);
  }, []);
  // concealed: what the screen knew of the order goes with it (the grid comes back after the unlock, from the start)
  useEffect(() => {
    if (!concealed) return;
    setForbidden(false);
    setRange(null);
  }, [concealed]);

  const viewable = useRef((info: { viewableItems: readonly { index?: number | null | undefined }[] }) => {
    const at = info.viewableItems.map((token) => token.index).filter((index): index is number => typeof index === 'number');
    if (at.length === 0) return;
    setRange({ first: Math.min(...at), last: Math.max(...at) });
  });
  const open = photos !== null && previewId !== null ? photos.find((photo) => photo.id === previewId) : undefined;
  // the photo of an open preview left the replica or is no longer `ready` (e.g. quarantined by a later scan): the preview is closed, not left as an empty layer
  useEffect(() => {
    if (previewId !== null && photos !== null && (open === undefined || open.state !== 'ready')) onClosePreview();
  }, [previewId, photos, open, onClosePreview]);

  const hiddenAction =
    guard.hidden !== null && guard.hidden in HIDDEN_ACTION ? t(HIDDEN_ACTION[guard.hidden as keyof typeof HIDDEN_ACTION]) : null;

  const active = (index: number): boolean =>
    range === null ? index < columns * INITIAL_ROWS : index >= range.first - columns && index <= range.last + columns;

  const content = () => {
    if (concealed) {
      return (
        <EmptyState
          icon={EyeOff}
          title={t('orderFiles.hidden')}
          testID="order-photos-hidden"
          action={
            hiddenAction === null ? undefined : (
              <Button
                label={hiddenAction}
                onPress={() => {
                  if (guard.hidden === 'screen_lock_off') void session.recheckDevice();
                  else void session.reSignIn();
                }}
                testID="order-photos-hidden-action"
              />
            )
          }
        />
      );
    }
    if (readFailed) {
      return (
        <EmptyState
          icon={Inbox}
          title={t('orderPhotos.loadFailed')}
          testID="order-photos-error"
          action={<Button label={t('orderPhotos.retry')} onPress={reload} testID="order-photos-error-retry" />}
        />
      );
    }
    if (photos === null) return <Skeleton accessibilityLabel={t('orderPhotos.loading')} testID="order-photos-skeleton" />;
    if (photos.length === 0) return <EmptyState icon={ImageIcon} title={t('orderPhotos.empty')} testID="order-photos-empty" />;
    if (forbidden) return <EmptyState icon={Lock} title={t('orderPhotos.forbidden')} testID="order-photos-forbidden" />;
    if (!online) return <OfflineList photos={photos} />;
    return (
      <FlatList<OrderPhoto>
        key={columns}
        data={photos}
        numColumns={columns}
        keyExtractor={(photo) => photo.id}
        columnWrapperStyle={columns === 1 ? undefined : { columnGap: space.inline.xs }}
        contentContainerStyle={{ padding: space.inset.md, rowGap: space.stack.sm }}
        onViewableItemsChanged={viewable.current}
        viewabilityConfig={VIEWABILITY_CONFIG}
        ListHeaderComponent={
          failedTiles.size === 0 ? undefined : (
            <View style={{ paddingBottom: space.stack.sm }}>
              <InlineAlert
                tone="warning"
                body={t('orderPhotos.partFailed')}
                testID="order-photos-part-failed"
                action={
                  <Button
                    label={t('orderPhotos.retry')}
                    variant="tertiary"
                    onPress={() => {
                      setRetryKey((n) => n + 1);
                    }}
                    testID="order-photos-retry"
                  />
                }
              />
            </View>
          )
        }
        renderItem={({ item, index }) => (
          <PhotoTile
            photo={item}
            orderId={orderId}
            width={tileWidth}
            layout={columns === 1 ? 'row' : 'grid'}
            active={active(index)}
            retryKey={retryKey}
            testID={`photo-tile-${String(index)}`}
            onOpen={() => {
              onOpenPreview(item.id);
            }}
            onFailure={noteFailure}
            onForbidden={noteForbidden}
          />
        )}
        testID="order-photos-grid"
      />
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.bg.canvas }} testID="order-photos">
      <View
        style={{ flex: 1 }}
        accessibilityElementsHidden={open !== undefined}
        importantForAccessibility={open === undefined ? 'auto' : 'no-hide-descendants'}
      >
        <AppBar
          title={t('orderPhotos.title')}
          left={
            // the button brings its own horizontal padding: it is taken back, so that the text of "Wstecz" stands on the margin of the bar and the title keeps its line (M-08a)
            <View style={{ marginHorizontal: -space.inset.md }} testID="order-photos-back-wrap">
              <Button
                label={t('orderPhotos.back')}
                accessibilityLabel={t('orderPhotos.backA11y')}
                variant="tertiary"
                inverse
                onPress={onBack}
                testID="order-photos-back"
              />
            </View>
          }
          right={<SyncCapsule onPress={onOpenQueue} />}
        />
        <View style={{ flex: 1 }}>{content()}</View>
      </View>
      {open === undefined || open.state !== 'ready' || concealed ? null : (
        <PhotoPreview photo={open} orderId={orderId} online={online} onClose={onClosePreview} />
      )}
    </View>
  );
}

/** Offline: the rows of the replica as a one-column list (category, time, the mark of the state), no thumbnails, no empty squares, no button - there is nowhere to go (M-08a). */
function OfflineList({ photos }: { photos: readonly OrderPhoto[] }) {
  const { t } = useTranslation();
  return (
    <FlatList<OrderPhoto>
      data={photos}
      keyExtractor={(photo) => photo.id}
      contentContainerStyle={{ padding: space.inset.md, rowGap: space.stack.sm }}
      ListHeaderComponent={
        <View style={{ paddingBottom: space.stack.sm }}>
          <InlineAlert tone="info" icon={WifiOff} body={t('orderPhotos.offline')} testID="order-photos-offline" />
        </View>
      }
      renderItem={({ item, index }) => {
        const { category, time } = photoCaption(item, t);
        const state = STATE_LABEL[item.state];
        const label = state === null ? null : t(state);
        return (
          <View
            accessible
            accessibilityLabel={[category, time, label].filter((part): part is string => part !== null).join(', ')}
            style={{ minHeight: size.touchTarget.min, justifyContent: 'center', rowGap: space.stack.xs }}
            testID={`photo-row-${String(index)}`}
          >
            <Text style={{ ...text.label, color: color.text.primary }}>{category}</Text>
            {time === null ? null : <Text style={{ ...text.bodySm, color: color.text.secondary }}>{time}</Text>}
            {label === null ? null : <Text style={{ ...text.bodySm, color: color.text.secondary }}>{label}</Text>}
          </View>
        );
      }}
      testID="order-photos-list"
    />
  );
}

const STATE_LABEL: Readonly<Record<OrderPhoto['state'], string | null>> = {
  ready: null,
  preparing: 'orderPhotos.states.preparing',
  quarantined: 'orderPhotos.states.quarantined',
  failed: 'orderPhotos.states.failed',
  awaiting_file: 'orderPhotos.states.awaiting',
};

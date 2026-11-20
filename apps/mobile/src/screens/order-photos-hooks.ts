import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import type { OrderPhoto } from '../orders/order-photos-model';
import type { ImageVariant } from '../media-view/types';
import { useGuard, useSession, useSyncSnapshot } from './session-context';

/**
 * The photos of an order from the REPLICA (EVM-142 AC2, AC5): `null` while they are read, `failed` when the read failed. In the hidden-data mode and under the lock of the
 * app nothing is read at all and `photos` is `null` (the screens draw their own "hidden" state); the read is repeated whenever a synchronization cycle ends (a photo of a
 * colleague that became `ready`) and on `reload`. No request to the server and no image here.
 */
export function useOrderPhotos(orderId: string): {
  readonly concealed: boolean;
  readonly photos: readonly OrderPhoto[] | null;
  readonly failed: boolean;
  readonly reload: () => void;
} {
  const { sync } = useSession();
  const guard = useGuard();
  const snapshot = useSyncSnapshot();
  const concealed = guard.hidden !== null || guard.locked;
  const [photos, setPhotos] = useState<readonly OrderPhoto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (concealed) {
      setPhotos(null);
      setFailed(false);
      return undefined;
    }
    let active = true;
    sync.orderPhotos(orderId).then(
      (loaded) => {
        if (!active) return;
        setPhotos(loaded);
        setFailed(false);
      },
      () => {
        if (!active) return;
        setPhotos([]);
        setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [sync, orderId, concealed, snapshot.lastSuccessAt, snapshot.syncing, tick]);
  const reload = useCallback(() => {
    setFailed(false);
    setPhotos(null);
    setTick((n) => n + 1);
  }, []);
  return { concealed, photos: concealed ? null : photos, failed, reload };
}

export type PhotoImageState = 'loading' | 'ready' | 'retry' | 'forbidden' | 'not_found';

/**
 * One image of the viewer for a screen (EVM-142 AC2, AC3, AC5). `retry` = the load failed (network, server, `429`) and a touch may try again; the other states are final
 * for this photo. The image itself is read from the memory of the viewer at every render - never kept in a state, so a screen that sits in a hidden `Activity` under the lock holds no
 * image: the cleanup of the LAYOUT effect frees it (and the effect cleanup aborts the request), and the effects that run again at the unlock load it anew.
 * `active = false` (a tile far outside the window) neither loads nor holds an image.
 */
export function usePhotoImage({
  workOrderId,
  mediaAssetId,
  variant,
  active,
  retryKey = 0,
}: {
  readonly workOrderId: string;
  readonly mediaAssetId: string;
  readonly variant: ImageVariant;
  readonly active: boolean;
  /** A change of this value tries again (the "Spróbuj ponownie" of the whole grid). */
  readonly retryKey?: number;
}): { readonly state: PhotoImageState; readonly uri: string | undefined; readonly reload: () => void } {
  const { mediaView } = useSession();
  const epoch = useSyncExternalStore(mediaView.subscribe, mediaView.getEpoch);
  const [loaded, setLoaded] = useState<PhotoImageState>('loading');
  const [attempt, setAttempt] = useState(0);
  useLayoutEffect(() => {
    if (!active) return undefined;
    return () => {
      mediaView.release(variant, mediaAssetId);
    };
  }, [mediaView, active, variant, mediaAssetId]);
  useEffect(() => {
    if (!active) return undefined;
    if (mediaView.peek(variant, mediaAssetId) !== undefined) {
      setLoaded('ready');
      return undefined;
    }
    setLoaded('loading');
    const controller = new AbortController();
    void mediaView.load({ workOrderId, mediaAssetId, variant, signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      switch (result.kind) {
        case 'ok':
          setLoaded('ready');
          break;
        case 'forbidden':
        case 'not_found':
          setLoaded(result.kind);
          break;
        case 'rate_limited':
        case 'failed':
          setLoaded('retry');
          break;
        case 'aborted':
          break;
      }
    });
    return () => {
      controller.abort();
    };
  }, [mediaView, active, workOrderId, mediaAssetId, variant, epoch, attempt, retryKey]);
  const uri = active ? mediaView.peek(variant, mediaAssetId) : undefined;
  const reload = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);
  return { state: loaded === 'ready' && uri === undefined ? 'loading' : loaded, uri, reload };
}

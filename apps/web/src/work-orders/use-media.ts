import { listMediaAssets, rescanMediaAsset, type MediaAsset, type MediaAssetList } from '@evia/contracts';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { StepUpCancelled, useGuardedCall } from '../administration/use-guarded-call.ts';
import { uuidv7 } from '../customers/uuid.ts';
import { mediaText } from './media-labels.ts';
import { hashFile } from './sha256.ts';
import { putPart } from './media-put.ts';
import { WORK_ORDER_MEDIA_KEY } from './query-keys.ts';
import { UploadEngine, type QueueItem, type UnfinishedSession } from './media-upload-engine.ts';

// The media of an order and of the person's unfinished uploads. Names of files are personal data: the entries live in the memory of
// the tab only — `gcTime: 0`, no persistence (SR-WEB-05, TM-10); a gone order removes them (WORK_ORDER_KEYS).

/** The page of the list (the API's default is 25; at most 100). */
export const MEDIA_PAGE_SIZE = 50;
/** While a file waits for the scan the list is read again (the verdict "Sprawdzanie pliku" → "Wysłano" arrives without a click). */
export const MEDIA_POLL_MS = 3000;

/** After this long a wait for the derivatives is read less often (the server tries again after minutes, not seconds). */
export const MEDIA_SLOW_AFTER_MS = 2 * 60_000;
export const MEDIA_SLOW_POLL_MS = 15_000;
/** The wait for the derivatives is given up after this long (PROCESSING_WARNING of the server); a reload of the tab starts it again. */
export const MEDIA_GIVE_UP_AFTER_MS = 30 * 60_000;

const UPLOAD_WAITING_STATES = new Set(['pending_upload', 'uploaded', 'scanning']);

type WaitKind = 'upload' | 'derivatives' | 'none';

/**
 * What the list waits for. `clean` and `processing` wait for the thumbnail and the preview (EVM-068) only for a photo: a video stays
 * `clean` until EVM-046, so it must not keep the list polling for ever.
 */
function waitKind(assets: readonly Pick<MediaAsset, 'fileState' | 'mediaType'>[]): WaitKind {
  if (assets.some((asset) => UPLOAD_WAITING_STATES.has(asset.fileState))) return 'upload';
  if (assets.some((asset) => asset.mediaType === 'photo' && (asset.fileState === 'clean' || asset.fileState === 'processing'))) {
    return 'derivatives';
  }
  return 'none';
}

/** The pause before the next read of the list; `false` stops the polling. `waitedMs` is how long the wait for derivatives lasts. */
export function mediaPollInterval(
  assets: readonly Pick<MediaAsset, 'fileState' | 'mediaType'>[],
  waitedMs: number,
  watching = false,
): number | false {
  const kind = waitKind(assets);
  if (kind === 'upload' || (kind === 'none' && watching)) return MEDIA_POLL_MS;
  if (kind === 'none') return false;
  if (waitedMs >= MEDIA_GIVE_UP_AFTER_MS) return watching ? MEDIA_POLL_MS : false;
  return waitedMs >= MEDIA_SLOW_AFTER_MS ? MEDIA_SLOW_POLL_MS : MEDIA_POLL_MS;
}

export function useMediaList(
  workOrderId: string,
  enabled: boolean,
  watching: boolean,
  needsAttention = false,
): UseInfiniteQueryResult<InfiniteData<MediaAssetList, string | null>> {
  const client = useApi();
  const derivativesSince = useRef<number | null>(null);
  return useInfiniteQuery({
    queryKey: [WORK_ORDER_MEDIA_KEY, workOrderId, needsAttention ? 'attention' : 'all'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        listMediaAssets({
          client,
          signal,
          path: { workOrderId },
          query: {
            limit: MEDIA_PAGE_SIZE,
            ...(needsAttention ? { needsAttention: true } : {}),
            ...(pageParam === null ? {} : { cursor: pageParam }),
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: (query) => {
      const assets = query.state.data?.pages.flatMap((page) => page.items) ?? [];
      if (waitKind(assets) === 'derivatives') derivativesSince.current ??= Date.now();
      else derivativesSince.current = null;
      const waited = derivativesSince.current === null ? 0 : Date.now() - derivativesSince.current;
      return mediaPollInterval(assets, waited, watching);
    },
    enabled,
    gcTime: 0,
    retry: false,
  });
}

/**
 * "Skanuj ponownie" (EVM-049 AC3, AC8): the request goes through W-04 when the server asks for it (`403 step_up_required`, the same
 * call once more with the same `Idempotency-Key`). A failure is kept for the alert of the tab; the list is read again after the answer
 * of the server (the file goes to "Sprawdzanie pliku", or the state it has now is shown).
 */
export function useRescan(workOrderId: string) {
  const client = useApi();
  const queryClient = useQueryClient();
  const guarded = useGuardedCall(mediaText.rescanStepUp);
  const [failure, setFailure] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const mutation = useMutation({
    mutationFn: (mediaAssetId: string) => {
      const key = uuidv7();
      return guarded.run(() =>
        unwrap(rescanMediaAsset({ client, path: { workOrderId, mediaAssetId }, headers: { 'Idempotency-Key': key } })),
      );
    },
    onSuccess: () => {
      setFailure(null);
      setStarted(true);
    },
    onError: (error) => {
      if (error instanceof StepUpCancelled) return;
      setFailure(rescanFailure(error));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [WORK_ORDER_MEDIA_KEY, workOrderId] }),
  });
  return {
    pendingId: mutation.isPending ? mutation.variables : undefined,
    failure,
    started,
    run: (mediaAssetId: string) => {
      setFailure(null);
      setStarted(false);
      mutation.mutate(mediaAssetId);
    },
  };
}

function rescanFailure(error: unknown): string {
  if (!(error instanceof ApiError)) return mediaText.rescanServer;
  switch (error.status) {
    case 0:
      return mediaText.rescanNetwork;
    case 403:
      return mediaText.rescanForbidden;
    case 404:
      return mediaText.rescanNotFound;
    case 409:
      return mediaText.rescanStateChanged;
    case 429:
      return mediaText.rateLimited(error.retryAfterSeconds ?? null);
    default:
      return mediaText.rescanServer;
  }
}

/** The person's unfinished uploads (AC4): the media with an active session of the caller, with the names of the files. */
export function useUnfinishedMedia(workOrderId: string, enabled: boolean) {
  const client = useApi();
  return useQuery({
    queryKey: [WORK_ORDER_MEDIA_KEY, workOrderId, 'unfinished'],
    queryFn: ({ signal }) =>
      unwrap(listMediaAssets({ client, signal, path: { workOrderId }, query: { uploadState: 'unfinished', limit: 100 } })),
    enabled,
    gcTime: 0,
    retry: false,
  });
}

/** Resolves when the browser reports the connection back. */
function whenOnline(): Promise<void> {
  return new Promise<void>((resolve) => {
    globalThis.addEventListener(
      'online',
      () => {
        resolve();
      },
      { once: true },
    );
  });
}

export interface MediaUpload {
  readonly engine: UploadEngine;
  readonly items: readonly QueueItem[];
  /** The unfinished uploads this tab is not sending now: the banner "Nie wysłano …" and the sessions a re-chosen file resumes. */
  readonly unfinished: readonly MediaAsset[];
  readonly sessions: readonly UnfinishedSession[];
  readonly dialog: { readonly open: boolean; readonly files: readonly File[] };
  readonly openDialog: (files?: readonly File[]) => void;
  readonly closeDialog: () => void;
}

/**
 * The upload of one order: the engine of the tab (kept while the order is open, whatever tab of W-06 is shown), the unfinished
 * sessions of the person and the state of the dialog "Dodaj zdjęcia lub filmy". Closing the tab with unsent files asks first.
 */
export function useMediaUpload(workOrderId: string, enabled: boolean): MediaUpload {
  const client = useApi();
  const queryClient = useQueryClient();
  const engine = useMemo(
    () => new UploadEngine({ client, workOrderId, hash: hashFile, put: putPart, isOnline: () => navigator.onLine, whenOnline }),
    [client, workOrderId],
  );
  const items = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const unfinishedQuery = useUnfinishedMedia(workOrderId, enabled);
  const [dialog, setDialog] = useState<{ open: boolean; files: readonly File[] }>({ open: false, files: [] });

  // A file that changed its state on the server changes the lists: the reads are repeated.
  const signature = items.map((entry) => `${entry.key}:${entry.status}`).join('|');
  useEffect(() => {
    if (signature !== '') void queryClient.invalidateQueries({ queryKey: [WORK_ORDER_MEDIA_KEY, workOrderId] });
  }, [signature, queryClient, workOrderId]);

  // Closing the tab or leaving the page with files that are not on the server (AC8): the warning of the browser.
  const unsent = items.some((entry) => ['hashing', 'queued', 'uploading', 'paused', 'failed'].includes(entry.status));
  useEffect(() => {
    if (!unsent) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    globalThis.addEventListener('beforeunload', warn);
    return () => {
      globalThis.removeEventListener('beforeunload', warn);
    };
  }, [unsent]);

  const unfinished = useMemo(
    () => (unfinishedQuery.data?.items ?? []).filter((asset) => !items.some((entry) => entry.key === asset.id)),
    [unfinishedQuery.data, items],
  );
  const sessions = useMemo<UnfinishedSession[]>(
    () =>
      unfinished.flatMap((asset) =>
        // An interrupted medium without a session (expired, aborted) is matched too: a re-chosen file opens a new session for it.
        asset.originalFilename === null
          ? []
          : [{ mediaAssetId: asset.id, name: asset.originalFilename, size: asset.declaredSize, session: asset.uploadSession }],
      ),
    [unfinished],
  );
  return {
    engine,
    items,
    unfinished,
    sessions,
    dialog,
    openDialog: (files = []) => {
      setDialog({ open: true, files });
    },
    closeDialog: () => {
      setDialog({ open: false, files: [] });
    },
  };
}

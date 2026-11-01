import type { MediaAsset } from '@evia/contracts';
import { Button, Dialog, ImageIcon, InlineAlert, Lightbox, Skeleton } from '@evia/ui-web';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../api/client.ts';
import { formatClock, formatDate } from './format.ts';
import { categoryLabel, mediaAlt, mediaText } from './media-labels.ts';
import { useVariantRequest, useVariantTicket } from './media-thumbnails.ts';
import { eraseText } from './erase-labels.ts';
import { failureText, type EraseFailure } from './file-erase.ts';
import { MediaEditDialog } from './media-edit-dialog.tsx';
import { UnscannedMark } from './media-unscanned.tsx';
import { VideoPlayer } from './media-video-player.tsx';

// The lightbox of W-09 (EVM-045 AC1, AC2, AC4, AC5, AC8; styleguide § 3.11, § 3.13): the preview 1600 px of a photo, the metadata of the medium
// (the API sends no EXIF / GPS and the panel has no "Kopiuj link"), the download of the original after the warning about metadata. The addresses
// live in the memory of the tab only: the preview in the state of this component, the address of a download is used at once by an anchor
// with `rel="noreferrer"` and forgotten. The button of the original is a convenience of the interface - the server decides (`403`, `404`, `429`).

type View =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly url: string; readonly expiresAt: string }
  | { readonly kind: 'error'; readonly text: string };

const LOADING: View = { kind: 'loading' };

/** The text for a failed request of an address (never the address, the name of the file or the key). */
export function downloadFailureText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return mediaText.fileGone;
    if (error.status === 429) return mediaText.downloadLimited;
    if (error.status === 403) return mediaText.downloadForbidden;
  }
  return mediaText.downloadFailed;
}

/** Starts the download by a navigation that stays on the page (the answer of the bucket is an attachment); the anchor sends no referrer. */
export function startDownload(url: string, inNewTab: boolean): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noreferrer noopener';
  if (inNewTab) anchor.target = '_blank';
  anchor.click();
}

function OriginalDialog({
  workOrderId,
  asset,
  onClose,
}: {
  readonly workOrderId: string;
  readonly asset: MediaAsset | null;
  readonly onClose: () => void;
}) {
  const request = useVariantRequest(workOrderId);
  const [busy, setBusy] = useState<'preview' | 'original' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const run = (variant: 'preview' | 'original') => {
    if (asset === null || busy !== null) return;
    setBusy(variant);
    setFailure(null);
    request(asset.id, variant)
      .then((url) => {
        startDownload(url, variant === 'preview');
        setBusy(null);
        onClose();
      })
      .catch((error: unknown) => {
        setBusy(null);
        setFailure(downloadFailureText(error));
      });
  };

  const dismiss = () => {
    setFailure(null);
    onClose();
  };

  return (
    <Dialog
      open={asset !== null}
      size="sm"
      title={mediaText.originalTitle}
      closeLabel={mediaText.closeDialog}
      onDismiss={dismiss}
      actions={
        <>
          <Button variant="tertiary" onClick={dismiss}>
            {mediaText.cancel}
          </Button>
          <Button
            variant="secondary"
            loading={busy === 'preview'}
            disabled={busy === 'original'}
            onClick={() => {
              run('preview');
            }}
          >
            {mediaText.downloadPreview}
          </Button>
          <Button
            loading={busy === 'original'}
            disabled={busy === 'preview'}
            onClick={() => {
              run('original');
            }}
          >
            {mediaText.downloadOriginal}
          </Button>
        </>
      }
    >
      {asset?.mediaType === 'video' && !asset.avScanned ? <UnscannedMark /> : null}
      <p>{mediaText.originalBody}</p>
      {failure === null ? null : <InlineAlert tone="error">{failure}</InlineAlert>}
    </Dialog>
  );
}

function previewFailureText(error: unknown): string {
  if (error instanceof ApiError && (error.status === 404 || error.status === 429)) return downloadFailureText(error);
  return mediaText.thumbnailUnavailable;
}

/** "Usuń" and "Usuń plik trwale…" of the lightbox (EVM-051; Administrator only - the server decides all the same). */
export interface MediaEraser {
  readonly remove: (asset: MediaAsset) => void;
  readonly purge: (asset: MediaAsset) => void;
  readonly failure: EraseFailure | null;
}

/** The lightbox over the photos of the gallery in the order of the tiles; `index` null = closed. */
export function MediaViewer({
  workOrderId,
  assets,
  index,
  online,
  canDownloadOriginal,
  canEdit = false,
  eraser,
  onIndex,
  onClose,
}: {
  readonly workOrderId: string;
  readonly assets: readonly MediaAsset[];
  readonly index: number | null;
  readonly online: boolean;
  readonly canDownloadOriginal: boolean;
  /** Administrator and Editor (convenience only; the server answers `403` to the others). */
  readonly canEdit?: boolean;
  /** Administrator: delete and erase the file (EVM-051). */
  readonly eraser?: MediaEraser;
  readonly onIndex: (index: number) => void;
  readonly onClose: () => void;
}) {
  const request = useVariantTicket(workOrderId);
  const asset = index === null ? undefined : assets[index];
  const [state, setState] = useState<{ readonly id: string; readonly view: View }>({ id: '', view: LOADING });
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState(false);
  const loadedFor = useRef<string | null>(null);
  const assetId = asset?.id ?? null;

  useEffect(() => {
    if (assetId === null) {
      loadedFor.current = null;
      return;
    }
    // no request while offline, and none for a preview that is already there
    if (!online || loadedFor.current === assetId) return;
    let cancelled = false;
    request(assetId, 'preview')
      .then((ticket) => {
        loadedFor.current = assetId;
        if (!cancelled) setState({ id: assetId, view: { kind: 'ready', url: ticket.url, expiresAt: ticket.expiresAt } });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ id: assetId, view: { kind: 'error', text: previewFailureText(error) } });
      });
    return () => {
      cancelled = true;
    };
  }, [assetId, online, request]);

  const view: View = asset !== undefined && state.id === asset.id ? state.view : LOADING;
  const ready = view.kind === 'ready';
  const offlineWaiting = !online && !ready && view.kind !== 'error';
  const previous =
    index !== null && index > 0
      ? () => {
          onIndex(index - 1);
        }
      : undefined;
  const next =
    index !== null && index < assets.length - 1
      ? () => {
          onIndex(index + 1);
        }
      : undefined;

  const picture = (): ReactNode => {
    if (asset === undefined) return null;
    if (view.kind === 'ready' && asset.mediaType === 'video') {
      return (
        <VideoPlayer
          key={asset.id}
          initial={{ url: view.url, expiresAt: view.expiresAt }}
          label={mediaText.videoPreviewLabel(mediaAlt(asset))}
          renew={() => request(asset.id, 'preview')}
        />
      );
    }
    if (view.kind === 'ready') {
      return (
        <img
          src={view.url}
          alt={mediaAlt(asset)}
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-auto w-full object-contain"
          onError={() => {
            loadedFor.current = null;
            setState({ id: asset.id, view: { kind: 'error', text: mediaText.thumbnailUnavailable } });
          }}
        />
      );
    }
    if (view.kind === 'error') {
      return (
        <div className="flex flex-col items-center justify-center gap-stack-xs p-inset-lg text-center text-body text-text-secondary">
          <ImageIcon aria-hidden="true" className="size-icon-lg text-icon-secondary" />
          <span role="alert">{view.text}</span>
        </div>
      );
    }
    return (
      <div className="relative aspect-square w-full">
        <Skeleton className="size-full" />
        <span
          className={
            offlineWaiting
              ? 'absolute inset-0 flex items-center justify-center p-inset-md text-center text-body text-text-secondary'
              : 'sr-only'
          }
        >
          {offlineWaiting ? mediaText.previewOffline : mediaText.previewLoading}
        </span>
      </div>
    );
  };

  const taken = asset === undefined ? '' : (asset.capturedAt ?? asset.createdAt);

  return (
    <>
      <Lightbox
        open={asset !== undefined}
        title={asset === undefined || index === null ? '' : mediaText.lightboxTitle(index + 1, assets.length, mediaAlt(asset))}
        closeLabel={mediaText.closeDialog}
        previousLabel={mediaText.previous}
        nextLabel={mediaText.next}
        zoomInLabel={mediaText.zoomIn}
        zoomOutLabel={mediaText.zoomOut}
        zoomStatus={mediaText.zoomStatus}
        scrollAreaLabel={mediaText.scrollAreaLabel}
        onPrevious={previous}
        onNext={next}
        onDismiss={onClose}
        itemKey={asset?.id ?? ''}
        zoomable={ready && asset?.mediaType !== 'video'}
        details={
          asset === undefined ? null : (
            <>
              <p className="text-body-sm text-text-secondary">
                {[
                  categoryLabel(asset.category),
                  mediaText.takenAt(formatDate(taken), formatClock(Date.parse(taken))),
                  ...(asset.origin === 'mobile' ? [mediaText.fromPhone] : []),
                ].join(' · ')}
              </p>
              {asset.mediaType === 'video' ? <p className="text-body-sm text-text-secondary">{mediaText.videoKeys}</p> : null}
              {asset.mediaType === 'video' && !asset.avScanned ? (
                <>
                  <UnscannedMark />
                  <p className="text-body-sm text-text-secondary">{mediaText.videoPreviewOnly}</p>
                </>
              ) : null}
              {asset.procedureStageName === null ? null : (
                <p className="text-body-sm text-text-secondary">{mediaText.stageLine(asset.procedureStageName)}</p>
              )}
              {asset.description === null ? null : <p className="text-body-sm">{mediaText.descriptionLine(asset.description)}</p>}
              {canEdit ? (
                <div className="flex flex-wrap items-center gap-inline-md">
                  <Button
                    variant="secondary"
                    disabled={!online}
                    onClick={() => {
                      setEditing(true);
                    }}
                  >
                    {mediaText.editDescription}
                  </Button>
                  {online ? null : <span className="text-body-sm text-text-secondary">{mediaText.editOffline}</span>}
                </div>
              ) : null}
              {eraser === undefined ? null : (
                <div className="flex flex-col gap-stack-xs">
                  <div className="flex flex-wrap items-center gap-inline-md">
                    <Button
                      variant="secondary"
                      disabled={!online}
                      onClick={() => {
                        eraser.remove(asset);
                      }}
                    >
                      {eraseText.remove}
                    </Button>
                    <Button
                      variant="danger"
                      disabled={!online}
                      onClick={() => {
                        eraser.purge(asset);
                      }}
                    >
                      {eraseText.purge}
                    </Button>
                    {online ? null : <span className="text-body-sm text-text-secondary">{eraseText.offline}</span>}
                  </div>
                  {eraser.failure === null ? null : <InlineAlert tone="error">{failureText(eraser.failure)}</InlineAlert>}
                </div>
              )}
              {canDownloadOriginal ? (
                <div className="flex flex-wrap items-center gap-inline-md">
                  <Button
                    variant="secondary"
                    disabled={!online}
                    onClick={() => {
                      setAsking(true);
                    }}
                  >
                    {mediaText.downloadOriginal}
                  </Button>
                  {online ? null : <span className="text-body-sm text-text-secondary">{mediaText.downloadOffline}</span>}
                </div>
              ) : null}
            </>
          )
        }
      >
        {picture()}
      </Lightbox>
      {editing && asset !== undefined ? (
        <MediaEditDialog
          workOrderId={workOrderId}
          asset={asset}
          onClose={() => {
            setEditing(false);
          }}
        />
      ) : null}
      <OriginalDialog
        workOrderId={workOrderId}
        asset={asking && asset !== undefined ? asset : null}
        onClose={() => {
          setAsking(false);
        }}
      />
    </>
  );
}

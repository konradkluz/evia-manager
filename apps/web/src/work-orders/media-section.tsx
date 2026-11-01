import type { MediaAsset, WorkOrderDetails } from '@evia/contracts';
import {
  Button,
  CircleAlert,
  EmptyState,
  FilterChip,
  Images,
  InlineAlert,
  RadioGroup,
  UploadQueueItem,
  Uploader,
  type UploadQueueItemState,
} from '@evia/ui-web';
import { useEffect, useId, useMemo, useState } from 'react';
import { useOnline } from '../shell/use-online.ts';
import { useSession } from '../session/session.ts';
import { formatDate, formatClock } from './format.ts';
import { eraseText } from './erase-labels.ts';
import { useSoftErase, type EraseSubject } from './file-erase.ts';
import { FilePurgeDialog } from './file-purge-dialog.tsx';
import { categoryLabel, mediaText, quarantineReasonLabel } from './media-labels.ts';
import { MediaGallery } from './media-gallery.tsx';
import { MediaQueue } from './media-queue.tsx';
import { SectionLoading } from './section-states.tsx';
import { stageOrder, useStageChoices } from './stage-choice.ts';
import { useMediaList, useRescan, type MediaUpload } from './use-media.ts';

/** The state of a medium that is on the server, as the list shows it (flows/06 → § 4.14 "Stany pliku na serwerze"). */
function serverLook(asset: MediaAsset, administrator: boolean): { state: UploadQueueItemState; label: string; detail?: string } {
  // EVM-051: the file was erased by an administrator; the record stays with the marker (no name, no description, no actions on the file)
  if (asset.fileErasedAt != null) return { state: 'queued', label: eraseText.erasedBy(asset.fileErasedAt) };
  // The quarantine of EVM-049: a file held ("Wymaga uwagi") or removed after 30 days; the reason only when the server sent it (Administrator).
  if (asset.quarantine?.state === 'purged') return { state: 'queued', label: mediaText.purged, detail: mediaText.purgedDetail };
  // A file held and scanned again is being checked, not "Wymaga uwagi" (the reason of the earlier verdict is no longer current).
  if (asset.quarantine?.state === 'held' && (asset.fileState === 'scanning' || asset.fileState === 'uploaded')) {
    return { state: 'checking', label: mediaText.checking, detail: administrator ? mediaText.rescanning : mediaText.checkingDetail };
  }
  if (asset.quarantine?.state === 'held' && administrator) {
    const reason = quarantineReasonLabel(asset.quarantineReasonCode);
    return {
      state: 'attention',
      label: mediaText.attention,
      detail: `${reason}. ${mediaText.removalDay(formatDate(asset.quarantine.expiresAt))}`,
    };
  }
  switch (asset.fileState) {
    case 'pending_upload':
      return {
        state: 'queued',
        label: `${mediaText.waitingForFile} · ${mediaText.waitingSince(formatClock(Date.parse(asset.createdAt)))}`,
      };
    case 'uploaded':
    case 'scanning':
      return { state: 'checking', label: mediaText.checking, detail: mediaText.checkingDetail };
    case 'quarantined':
      return { state: 'attention', label: mediaText.attention, detail: mediaText.attentionPlain };
    case 'clean':
    case 'processing':
      // EVM-068: sent and scanned; the server is making the thumbnail and the preview (the list is read again until the file is `ready`)
      return { state: 'done', label: mediaText.done, detail: mediaText.previewPreparing };
    case 'failed':
      // `checksum_mismatch` is the only reason the list carries as a reason; the file must be chosen again (it is not in the memory of this tab)
      if (asset.stateReasonCode === 'checksum_mismatch') return { state: 'failed', label: mediaText.failedChecksum };
      // EVM-068 AC4: the file passed the scan, the picture could not be made after the tries of the server
      if (asset.processingFailed === true) {
        // a film that ran over the limit of time is not tried again (EVM-046 AC5), so the text does not promise it
        return { state: 'failed', label: asset.mediaType === 'video' ? mediaText.processingFailedVideo : mediaText.processingFailed };
      }
      return { state: 'done', label: mediaText.done };
    default:
      return { state: 'done', label: mediaText.done };
  }
}

/**
 * The tab "Media i dokumenty" of W-06 (W-09; EVM-044 AC1, AC4, AC7, AC8): the Uploader (a drop area from `breakpoint.medium` and
 * the button "Dodaj zdjęcia lub filmy" that opens the dialog), the panel of the upload of this tab and the media of the order with
 * the state of each file. Administrator and Editor upload; Tylko odczyt sees the list without the Uploader (the server answers
 * `403` all the same). Thumbnails, preview and download are EVM-045 — until then a medium is a line with its state. The names of the
 * files are shown only for the person's own unfinished uploads (the API sends them nowhere else) and always as text.
 */
export function MediaSection({ order, media }: { readonly order: WorkOrderDetails; readonly media: MediaUpload }) {
  const headingId = useId();
  const online = useOnline();
  const role = useSession().data?.user.role;
  const canUpload = role === 'administrator' || role === 'editor';
  const checking = media.items.some((item) => item.status === 'checking');
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [grouping, setGrouping] = useState<'category' | 'stage'>('category');
  const stages = useStageChoices(order.id);
  const stageIds = useMemo(() => stageOrder(stages.choices), [stages.choices]);
  const list = useMediaList(order.id, true, checking, onlyAttention);
  const rescan = useRescan(order.id);
  const softErase = useSoftErase(order.id);
  const [purging, setPurging] = useState<EraseSubject | null>(null);
  const administrator = role === 'administrator';
  const attentionCount = list.data?.pages[0]?.needsAttentionCount ?? 0;
  const assets = list.data?.pages.flatMap((page) => page.items) ?? [];

  // The verdicts of the server reach the files of this tab (the panel "Wysyłanie" shows them).
  const { engine, items } = media;
  const data = list.data;
  useEffect(() => {
    if (data !== undefined && !onlyAttention) engine.applyServerStates(data.pages.flatMap((page) => page.items));
  }, [data, engine, items, onlyAttention]);

  const own = new Set(media.items.map((item) => item.key));
  // the photos that are `ready` are the gallery (also the ones this tab sent); the rest keep their line with the state of the file
  const gallery = assets.filter((asset) => asset.fileState === 'ready' && asset.fileErasedAt == null);
  const galleryIds = new Set(gallery.map((asset) => asset.id));
  const rest = assets.filter((asset) => !own.has(asset.id) && !galleryIds.has(asset.id));
  // the heading counts photos and videos separately (everything the tiles and the lines below show)
  const photos = assets.filter((asset) => asset.mediaType === 'photo').length;
  const videos = assets.length - photos;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-stack-md">
      <h2 id={headingId} className="text-heading-3 text-text-primary">
        {mediaText.heading}
      </h2>
      {canUpload ? (
        <>
          <Uploader
            className="hidden medium:flex"
            dropLabel={mediaText.dropLabel}
            buttonLabel={mediaText.chooseFiles}
            inputLabel={mediaText.chosenFilesInput}
            hint={mediaText.limits}
            disabled={!online}
            onFiles={(files) => {
              media.openDialog(files);
            }}
          />
          <div className="flex">
            <Button
              icon={Images}
              disabled={!online}
              onClick={() => {
                media.openDialog();
              }}
            >
              {mediaText.addPhotos}
            </Button>
          </div>
        </>
      ) : null}
      <MediaQueue media={media} />
      {attentionCount > 0 || onlyAttention ? (
        <div role="group" aria-label={mediaText.filterLabel} className="flex flex-wrap items-center gap-inline-sm">
          <span className="text-label text-text-secondary">{mediaText.filterPrefix}</span>
          <FilterChip
            label={mediaText.filterAll}
            variant="choice"
            selected={!onlyAttention}
            onClick={() => {
              setOnlyAttention(false);
            }}
          />
          <FilterChip
            label={mediaText.filterAttention(attentionCount)}
            variant="choice"
            selected={onlyAttention}
            onClick={() => {
              setOnlyAttention(true);
            }}
          />
        </div>
      ) : null}
      {rescan.failure === null ? null : <InlineAlert tone="error">{rescan.failure}</InlineAlert>}
      {rescan.started && rescan.failure === null ? <InlineAlert tone="success">{mediaText.rescanStarted}</InlineAlert> : null}
      {list.isPending ? <SectionLoading /> : null}
      {list.isError ? (
        <EmptyState
          icon={CircleAlert}
          title={mediaText.loadFailed}
          description={mediaText.loadFailedHint}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                void list.refetch();
              }}
            >
              {mediaText.retryLoad}
            </Button>
          }
        />
      ) : null}
      {list.isSuccess && onlyAttention && assets.length === 0 ? (
        <EmptyState
          icon={Images}
          title={mediaText.attentionEmpty}
          description={mediaText.attentionEmptyHint}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setOnlyAttention(false);
              }}
            >
              {mediaText.showAll}
            </Button>
          }
        />
      ) : null}
      {list.isSuccess && !onlyAttention && assets.length === 0 && media.items.length === 0 ? (
        <EmptyState icon={Images} title={mediaText.empty} description={canUpload ? mediaText.emptyHint : mediaText.emptyReadOnly} />
      ) : null}
      {list.isSuccess && (rest.length > 0 || gallery.length > 0) ? (
        <>
          <h3 className="text-heading-4">
            {onlyAttention
              ? mediaText.attentionHeading(assets.length, list.hasNextPage)
              : mediaText.photosHeading(photos, videos, list.hasNextPage)}
          </h3>
          {gallery.length > 0 ? (
            <RadioGroup
              legend={mediaText.groupLegend}
              options={[
                { value: 'category', label: mediaText.groupByCategory },
                { value: 'stage', label: mediaText.groupByStage },
              ]}
              value={grouping}
              onChange={(value) => {
                setGrouping(value === 'stage' ? 'stage' : 'category');
              }}
            />
          ) : null}
          <MediaGallery
            workOrderId={order.id}
            assets={gallery}
            online={online}
            canDownloadOriginal={canUpload}
            canEdit={canUpload}
            {...(administrator
              ? {
                  eraser: {
                    remove: (entry: MediaAsset) => {
                      softErase.remove({ kind: 'media', id: entry.id, version: entry.version });
                    },
                    purge: (entry: MediaAsset) => {
                      setPurging({ kind: 'media', id: entry.id, version: entry.version });
                    },
                    failure: softErase.failure,
                  },
                }
              : canUpload
                ? { eraser: { remove: () => undefined, purge: () => undefined, failure: null, restricted: true } }
                : {})}
            grouping={grouping}
            stageOrder={stageIds}
          />
          {rest.length > 0 ? (
            <ul aria-label={mediaText.heading} className="flex flex-col">
              {rest.map((asset) => {
                const look = serverLook(asset, role === 'administrator');
                const name = `${asset.mediaType === 'video' ? mediaText.video : mediaText.photo} · ${categoryLabel(asset.category)} · ${formatDate(asset.createdAt)} ${formatClock(Date.parse(asset.createdAt))}`;
                // Only an Administrator gets the action; the server decides all the same (`403`, `409`).
                const canRescan = role === 'administrator' && asset.quarantine?.state === 'held' && asset.fileState === 'quarantined';
                return (
                  <UploadQueueItem
                    key={asset.id}
                    name={name}
                    actions={
                      canRescan ? (
                        <Button
                          variant="secondary"
                          aria-label={mediaText.rescanFile(name)}
                          disabled={!online}
                          loading={rescan.pendingId === asset.id}
                          onClick={() => {
                            rescan.run(asset.id);
                          }}
                        >
                          {mediaText.rescan}
                        </Button>
                      ) : undefined
                    }
                    state={look.state}
                    statusLabel={look.label}
                    {...(look.detail === undefined ? {} : { detail: look.detail })}
                  />
                );
              })}
            </ul>
          ) : null}
          {list.hasNextPage ? (
            <Button
              variant="secondary"
              loading={list.isFetchingNextPage}
              onClick={() => {
                void list.fetchNextPage();
              }}
            >
              {mediaText.showMore}
            </Button>
          ) : null}
        </>
      ) : null}
      {purging === null ? null : (
        <FilePurgeDialog
          workOrderId={order.id}
          subject={purging}
          onClose={() => {
            setPurging(null);
          }}
        />
      )}
    </section>
  );
}

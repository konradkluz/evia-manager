import type { MediaAsset, WorkOrderDetails } from '@evia/contracts';
import { Button, CircleAlert, EmptyState, Images, UploadQueueItem, Uploader, type UploadQueueItemState } from '@evia/ui-web';
import { useEffect, useId } from 'react';
import { useOnline } from '../shell/use-online.ts';
import { useSession } from '../session/session.ts';
import { formatDate, formatClock } from './format.ts';
import { categoryLabel, mediaText } from './media-labels.ts';
import { MediaQueue } from './media-queue.tsx';
import { SectionLoading } from './section-states.tsx';
import { useMediaList, type MediaUpload } from './use-media.ts';

/** The state of a medium that is on the server, as the list shows it (flows/06 → § 4.14 "Stany pliku na serwerze"). */
function serverLook(asset: MediaAsset): { state: UploadQueueItemState; label: string; detail?: string } {
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
    case 'failed':
      // Only `checksum_mismatch` carries a reason; the file must be chosen again (it is not in the memory of this tab).
      return asset.stateReasonCode === 'checksum_mismatch'
        ? { state: 'failed', label: mediaText.failedChecksum }
        : { state: 'done', label: mediaText.done };
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
  const list = useMediaList(order.id, true, checking);
  const assets = list.data?.pages.flatMap((page) => page.items) ?? [];

  // The verdicts of the server reach the files of this tab (the panel "Wysyłanie" shows them).
  const { engine, items } = media;
  const data = list.data;
  useEffect(() => {
    if (data !== undefined) engine.applyServerStates(data.pages.flatMap((page) => page.items));
  }, [data, engine, items]);

  const own = new Set(media.items.map((item) => item.key));
  const rest = assets.filter((asset) => !own.has(asset.id));
  const photos = assets.length;

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
      {list.isSuccess && assets.length === 0 && media.items.length === 0 ? (
        <EmptyState icon={Images} title={mediaText.empty} description={canUpload ? mediaText.emptyHint : mediaText.emptyReadOnly} />
      ) : null}
      {list.isSuccess && rest.length > 0 ? (
        <>
          <h3 className="text-heading-4">{mediaText.photosHeading(photos, list.hasNextPage)}</h3>
          <ul aria-label={mediaText.heading} className="flex flex-col">
            {rest.map((asset) => {
              const look = serverLook(asset);
              return (
                <UploadQueueItem
                  key={asset.id}
                  name={`${asset.mediaType === 'video' ? mediaText.video : mediaText.photo} · ${categoryLabel(asset.category)} · ${formatDate(asset.createdAt)} ${formatClock(Date.parse(asset.createdAt))}`}
                  state={look.state}
                  statusLabel={look.label}
                  {...(look.detail === undefined ? {} : { detail: look.detail })}
                />
              );
            })}
          </ul>
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
    </section>
  );
}

import { Button, InlineAlert, UploadQueueItem, type UploadQueueItemState } from '@evia/ui-web';
import type { ReactNode } from 'react';
import { mediaText } from './media-labels.ts';
import type { QueueItem } from './media-upload-engine.ts';
import type { MediaUpload } from './use-media.ts';

interface Look {
  readonly state: UploadQueueItemState;
  readonly label: string;
  readonly detail?: string;
}

const FAILURE_TEXT = {
  checksum: mediaText.failedChecksum,
  network: mediaText.failedNetwork,
  server: mediaText.failedServer,
  storage: mediaText.failedStorage,
  incomplete: mediaText.failedIncomplete,
} as const;

/** The state of a file of the queue as the person reads it (docs/ux/flows/06 → W-09 compact, makieta 5). */
function lookOf(item: QueueItem): Look {
  switch (item.status) {
    case 'hashing':
      return { state: 'queued', label: mediaText.preparing };
    case 'queued':
      return { state: 'queued', label: mediaText.queued };
    case 'uploading':
      return { state: 'uploading', label: mediaText.uploading(item.percent) };
    case 'paused':
      return item.byPerson
        ? { state: 'paused', label: mediaText.paused }
        : { state: 'paused', label: mediaText.paused, detail: mediaText.pausedOffline };
    case 'checking':
      return { state: 'checking', label: mediaText.checking, detail: mediaText.checkingDetail };
    case 'done':
      return { state: 'done', label: mediaText.done };
    case 'attention':
      return { state: 'attention', label: mediaText.attention, detail: mediaText.attentionDetail };
    case 'failed':
      return item.failure === 'rate'
        ? { state: 'failed', label: mediaText.rateLimited(item.retryAfterSeconds) }
        : { state: 'failed', label: FAILURE_TEXT[item.failure ?? 'server'] };
  }
}

/** A file is "sent" for the counter "3 z 5" once the server has all its bytes. */
const SENT = new Set(['checking', 'done', 'attention']);

/**
 * The panel of the upload (W-09, "panel postępu"; EVM-044 AC1, AC4, AC5, AC8): one line "Wysyłanie · 3 z 5" with the warning not to
 * close the tab, a status with a label for every file, "Wstrzymaj" / "Wznów" / "Ponów" as visible buttons, and — when every file is
 * safe on the server — the confirmation that the photos may be removed from the phone (the copies in the gallery are kept until then).
 */
export function MediaQueue({ media }: { readonly media: MediaUpload }) {
  const { items, engine } = media;
  if (items.length === 0) return null;
  const sent = items.filter((item) => SENT.has(item.status)).length;
  const allDone = items.every((item) => item.status === 'done');
  const working = items.some((item) => ['hashing', 'queued', 'uploading', 'paused', 'failed'].includes(item.status));
  return (
    <section aria-label={mediaText.progressRegion} className="flex flex-col gap-stack-sm">
      {allDone ? (
        <InlineAlert tone="success">{mediaText.sentAll(items.length)}</InlineAlert>
      ) : (
        <>
          <h3 className="text-heading-4">{mediaText.progressHeading(sent, items.length)}</h3>
          {working ? <p className="text-body-sm text-text-secondary">{mediaText.progressHint}</p> : null}
        </>
      )}
      <ul className="flex flex-col">
        {items.map((item) => {
          const look = lookOf(item);
          return (
            <UploadQueueItem
              key={item.key}
              name={item.name}
              state={look.state}
              statusLabel={look.label}
              {...(look.detail === undefined ? {} : { detail: look.detail })}
              {...(item.status === 'uploading' ? { percent: item.percent, progressLabel: mediaText.uploadProgress(item.name) } : {})}
              {...actionsOf(item, engine)}
            />
          );
        })}
      </ul>
    </section>
  );
}

function actionsOf(item: QueueItem, engine: MediaUpload['engine']): { actions?: ReactNode } {
  if (item.status === 'uploading' || item.status === 'queued')
    return {
      actions: (
        <Button
          variant="tertiary"
          aria-label={mediaText.pauseFile(item.name)}
          onClick={() => {
            engine.pause(item.key);
          }}
        >
          {mediaText.pause}
        </Button>
      ),
    };
  if (item.status === 'paused' && item.byPerson)
    return {
      actions: (
        <Button
          variant="tertiary"
          aria-label={mediaText.resumeFile(item.name)}
          onClick={() => {
            engine.resume(item.key);
          }}
        >
          {mediaText.resume}
        </Button>
      ),
    };
  if (item.status === 'failed')
    return {
      actions: (
        <Button
          variant="secondary"
          aria-label={mediaText.retryFile(item.name)}
          onClick={() => {
            engine.retry(item.key);
          }}
        >
          {mediaText.retry}
        </Button>
      ),
    };
  return {};
}

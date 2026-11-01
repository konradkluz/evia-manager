import { Button, Dialog, InlineAlert } from '@evia/ui-web';
import { useState } from 'react';
import { exportText } from './export-labels.ts';
import { formatClock, formatDate } from './format.ts';
import { isPreparing, useMediaExports, type useOrderExport } from './media-export.ts';

// W-09 "Eksportuj zdjęcia (ZIP)" (EVM-052 AC1, AC6, AC7): the button (Administrator and Editor only; the server decides all the same), the
// warning about metadata before the order and before the download (P3), W-04 through the guarded call, and the exports of the caller.

type Exporter = ReturnType<typeof useOrderExport>;

/** The button and the dialog "Wyeksportować zdjęcia?"; disabled with a hint when there is nothing to export or the connection is gone. */
export function MediaExportButton({
  workOrderId,
  hasPhotos,
  online,
  exporter,
}: {
  readonly workOrderId: string;
  readonly hasPhotos: boolean;
  readonly online: boolean;
  readonly exporter: Exporter;
}) {
  const [asking, setAsking] = useState(false);
  const hintId = `media-export-hint-${workOrderId}`;
  const hint = !online ? exportText.offlineHint : !hasPhotos ? exportText.noPhotosHint : null;
  return (
    <div className="flex flex-wrap items-center gap-inline-md">
      <Button
        variant="secondary"
        disabled={hint !== null}
        {...(hint === null ? {} : { 'aria-describedby': hintId })}
        onClick={() => {
          exporter.clearFailure();
          setAsking(true);
        }}
      >
        {exportText.button}
      </Button>
      {hint === null ? null : (
        <span id={hintId} className="text-body-sm text-text-secondary">
          {hint}
        </span>
      )}
      <Dialog
        open={asking && !exporter.stepping}
        size="sm"
        title={exportText.confirmTitle}
        closeLabel={exportText.closeDialog}
        onDismiss={() => {
          if (!exporter.ordering) setAsking(false);
        }}
        actions={
          <>
            <Button
              variant="tertiary"
              disabled={exporter.ordering}
              onClick={() => {
                setAsking(false);
              }}
            >
              {exportText.cancel}
            </Button>
            <Button
              loading={exporter.ordering}
              disabled={!online}
              onClick={() => {
                exporter.order(() => {
                  setAsking(false);
                });
              }}
            >
              {exportText.confirm}
            </Button>
          </>
        }
      >
        <p>{exportText.confirmBody}</p>
      </Dialog>
    </div>
  );
}

/** The exports of the caller for this order and the failure of the last action; "Pobierz ZIP" asks once more about the metadata. */
export function MediaExportStatus({
  workOrderId,
  online,
  exporter,
}: {
  readonly workOrderId: string;
  readonly online: boolean;
  readonly exporter: Exporter;
}) {
  const list = useMediaExports(workOrderId, true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const items = list.data?.items ?? [];
  return (
    <>
      {exporter.failure === null ? null : <InlineAlert tone="error">{exporter.failure}</InlineAlert>}
      {items.map((entry) => {
        if (isPreparing(entry)) {
          return (
            <InlineAlert key={entry.id} tone="info">
              {exportText.preparing}
            </InlineAlert>
          );
        }
        if (entry.state === 'failed') {
          return (
            <InlineAlert key={entry.id} tone="error">
              {exportText.failed}
            </InlineAlert>
          );
        }
        if (entry.state === 'downloaded') {
          return (
            <InlineAlert key={entry.id} tone="info">
              {exportText.downloaded}
            </InlineAlert>
          );
        }
        const until = `${formatDate(entry.expiresAt)}, ${formatClock(Date.parse(entry.expiresAt))}`;
        return (
          <InlineAlert
            key={entry.id}
            tone="success"
            action={
              <Button
                variant="secondary"
                disabled={!online}
                onClick={() => {
                  exporter.clearFailure();
                  setDownloading(entry.id);
                }}
              >
                {exportText.download}
              </Button>
            }
          >
            {exportText.ready(entry.fileCount, entry.sizeBytes, until)}
          </InlineAlert>
        );
      })}
      <Dialog
        open={downloading !== null}
        size="sm"
        title={exportText.downloadTitle}
        closeLabel={exportText.closeDialog}
        onDismiss={() => {
          if (!exporter.downloading) setDownloading(null);
        }}
        actions={
          <>
            <Button
              variant="tertiary"
              onClick={() => {
                setDownloading(null);
              }}
            >
              {exportText.cancel}
            </Button>
            <Button
              disabled={!online}
              onClick={() => {
                if (downloading === null) return;
                exporter.download(downloading);
                setDownloading(null);
              }}
            >
              {exportText.download}
            </Button>
          </>
        }
      >
        <p>{exportText.downloadBody}</p>
      </Dialog>
    </>
  );
}

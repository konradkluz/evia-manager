import type { Document as OrderDocument, WorkOrderDetails } from '@evia/contracts';
import {
  ActionMenu,
  Banner,
  Button,
  CircleAlert,
  DataTable,
  EllipsisVertical,
  EmptyState,
  FileText,
  IconButton,
  InlineAlert,
  Lock,
  UploadQueueItem,
  WifiOff,
  type ActionMenuItem,
  type UploadQueueItemState,
} from '@evia/ui-web';
import { useId, useState } from 'react';
import { useOnline } from '../shell/use-online.ts';
import { useSession } from '../session/session.ts';
import { DocumentEditDialog } from './document-edit-dialog.tsx';
import { DocumentRaiseDialog } from './document-raise-dialog.tsx';
import { eraseText } from './erase-labels.ts';
import { failureText, useSoftErase, type EraseSubject } from './file-erase.ts';
import { FilePurgeDialog } from './file-purge-dialog.tsx';
import { DocumentUploadDialog } from './document-upload-dialog.tsx';
import { confidentialityLabel, documentText, higherClasses } from './document-labels.ts';
import type { DocumentItem } from './document-upload-engine.ts';
import { startDownload } from './media-viewer.tsx';
import { SectionLoading } from './section-states.tsx';
import { documentRequestFailure, useDocumentDownload, useDocumentKinds, useDocumentList, type DocumentUpload } from './use-documents.ts';

/** The file of a document as the list shows it (flows/06 → "Stany pliku"); the reason of a quarantine is never shown here. */
export function fileLook(document: OrderDocument): { label: string; detail?: string } {
  // EVM-051: the files were erased by an administrator; the title is the marker, nothing else of the file is shown
  if (document.fileErasedAt != null) return { label: eraseText.erasedBy(document.fileErasedAt) };
  switch (document.fileState) {
    case 'pending_upload':
      return { label: documentText.waiting };
    case 'uploaded':
    case 'scanning':
      return { label: documentText.checking, detail: documentText.checkingDetail };
    case 'quarantined':
      return { label: documentText.attention, detail: documentText.attentionDetail };
    case 'failed':
      return { label: document.stateReasonCode === 'checksum_mismatch' ? documentText.checksumFailed : documentText.failedFile };
    default:
      return { label: documentText.ready };
  }
}

export const downloadable = (document: OrderDocument) =>
  document.canDownload && document.fileErasedAt == null && (document.fileState === 'clean' || document.fileState === 'ready');

function queueLook(item: DocumentItem): { state: UploadQueueItemState; label: string; detail?: string } {
  switch (item.status) {
    case 'hashing':
      return { state: 'queued', label: documentText.hashing };
    case 'creating':
      return { state: 'queued', label: documentText.creating };
    case 'queued':
      return { state: 'queued', label: documentText.waiting };
    case 'uploading':
      return { state: 'uploading', label: documentText.sending(item.percent) };
    case 'paused':
      return { state: 'paused', label: documentText.waiting, detail: documentText.offlineNote };
    case 'done':
      return { state: 'done', label: documentText.sent };
    case 'failed':
      return { state: 'failed', label: documentText.failures[item.failure ?? 'server'] };
  }
}

/**
 * "Dokumenty zlecenia (n)" of the tab "Media i dokumenty" (W-09; EVM-047 AC1, AC2, AC4, AC5, AC7, AC8): the table with the kind, the title, the version and
 * the class (a restricted class has the icon `lock` and the name in words), the state of the file, and the actions. Administrator and Editor add
 * documents and raise the class; Tylko odczyt sees the list and downloads the documents of the class `standard` - for the others the row says who can
 * (the server answers `403` all the same). Titles, descriptions and file names are shown as text only (SR-WEB-03).
 */
export function DocumentsSection({ order, upload }: { readonly order: WorkOrderDetails; readonly upload: DocumentUpload }) {
  const headingId = useId();
  const online = useOnline();
  const role = useSession().data?.user.role;
  const canEdit = role === 'administrator' || role === 'editor';
  const administrator = role === 'administrator';
  const { engine, items } = upload;
  const sending = items.some((item) => item.status !== 'done' && item.status !== 'failed');
  const list = useDocumentList(order.id, sending);
  const kinds = useDocumentKinds(canEdit);
  const request = useDocumentDownload(order.id);
  const [adding, setAdding] = useState(false);
  // only the ids are kept: the dialogs always get the document from the live list (a refresh after `412` brings the new version)
  const [raisingId, setRaisingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const softErase = useSoftErase(order.id);
  const [purging, setPurging] = useState<EraseSubject | null>(null);

  const documents = list.data?.pages.flatMap((page) => page.items) ?? [];
  const raising = documents.find((entry) => entry.id === raisingId) ?? null;
  const editing = documents.find((entry) => entry.id === editingId) ?? null;
  const total = list.data?.pages[0]?.totalCount ?? 0;
  const working = items.some((item) => ['hashing', 'creating', 'queued', 'uploading', 'paused', 'failed'].includes(item.status));

  const download = (document: OrderDocument) => {
    if (busy !== null) return;
    setBusy(document.id);
    setFailure(null);
    request(document.id)
      .then((url) => {
        startDownload(url, false);
      })
      .catch((error: unknown) => {
        setFailure(documentRequestFailure(error, documentText.downloadFailed));
      })
      .finally(() => {
        setBusy(null);
      });
  };

  const actionsOf = (document: OrderDocument) => {
    const erased = document.fileErasedAt != null;
    const subject: EraseSubject = { kind: 'document', id: document.id, version: document.version };
    const eraseItems: ActionMenuItem[] = administrator
      ? [
          {
            id: 'remove',
            label: eraseText.remove,
            tone: 'danger',
            startsGroup: true,
            onSelect: () => {
              softErase.remove(subject);
            },
            ...(online ? {} : { disabledHint: eraseText.offline }),
          },
          ...(erased
            ? []
            : [
                {
                  id: 'purge',
                  label: eraseText.purge,
                  tone: 'danger' as const,
                  onSelect: () => {
                    setPurging(subject);
                  },
                  ...(online ? {} : { disabledHint: eraseText.offline }),
                },
              ]),
        ]
      : [];
    const canGet = downloadable(document);
    if (!canEdit) {
      if (!document.canDownload || erased) return null;
      if (!canGet) return null;
      return (
        <Button
          variant="tertiary"
          aria-label={documentText.downloadFile(document.title)}
          disabled={!online}
          loading={busy === document.id}
          onClick={() => {
            download(document);
          }}
        >
          {documentText.download}
        </Button>
      );
    }
    const menu: ActionMenuItem[] = erased
      ? eraseItems
      : [
          {
            id: 'download',
            label: documentText.downloadMenu,
            onSelect: () => {
              download(document);
            },
            ...(canGet && online ? {} : { disabledHint: online ? documentText.checkingDetail : documentText.offlineNote }),
          },
          {
            id: 'edit',
            label: documentText.editMenu,
            onSelect: () => {
              setEditingId(document.id);
            },
            ...(online ? {} : { disabledHint: documentText.offlineNote }),
          },
          {
            id: 'raise',
            label: documentText.raiseMenu,
            onSelect: () => {
              setRaisingId(document.id);
            },
            ...(higherClasses(document.confidentiality).length > 0 && online
              ? {}
              : { disabledHint: online ? documentText.raiseHighest : documentText.offlineNote }),
          },
          ...eraseItems,
        ];
    if (menu.length === 0) return null;
    const label = documentText.actionsLabel(document.title);
    return (
      <ActionMenu
        label={label}
        align="end"
        items={menu}
        trigger={(props) => <IconButton {...props} icon={EllipsisVertical} label={label} />}
      />
    );
  };

  const rows = documents.map((document) => {
    const look = fileLook(document);
    const restricted = document.confidentiality !== 'standard';
    const className = confidentialityLabel(document.confidentiality);
    return {
      id: document.id,
      label: document.title,
      cells: [
        // the kind, the title and the name of the file are text from the server/catalog: rendered as text, never as markup
        document.kindName,
        <div key="title" className="flex min-w-0 flex-col">
          <span className="break-words">{document.title}</span>
          {document.description === null ? null : <span className="break-words text-text-secondary">{document.description}</span>}
          {document.originalFilename === null ? null : <span className="break-words text-text-secondary">{document.originalFilename}</span>}
        </div>,
        document.procedureStageName ?? documentText.noStage,
        String(document.versionNumber),
        <span key="class" className="inline-flex items-center gap-inline-xs">
          {restricted ? <Lock aria-hidden="true" className="size-icon-md shrink-0" /> : null}
          {className}
        </span>,
        <div key="state" className="flex flex-col">
          <span>{look.label}</span>
          {look.detail === undefined ? null : <span className="text-text-secondary">{look.detail}</span>}
          {!document.canDownload ? <span className="text-text-secondary">{documentText.restricted}</span> : null}
        </div>,
        actionsOf(document),
      ],
    };
  });

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-stack-md">
      <div className="flex flex-wrap items-center justify-between gap-inline-md">
        <h2 id={headingId} className="text-heading-3 text-text-primary">
          {documentText.heading(total)}
        </h2>
        {canEdit && !(list.isSuccess && documents.length === 0) ? (
          <Button
            icon={FileText}
            disabled={!online}
            onClick={() => {
              setAdding(true);
            }}
          >
            {documentText.add}
          </Button>
        ) : null}
      </div>
      {working && !online ? <Banner icon={WifiOff}>{documentText.offlineNote}</Banner> : null}
      {items.length === 0 ? null : (
        <ul aria-label={documentText.panelLabel} className="flex flex-col">
          {items.map((item) => {
            const look = queueLook(item);
            return (
              <UploadQueueItem
                key={item.key}
                name={item.title}
                state={look.state}
                statusLabel={look.label}
                {...(look.detail === undefined ? {} : { detail: look.detail })}
                {...(item.status === 'uploading' ? { percent: item.percent, progressLabel: documentText.sending(item.percent) } : {})}
                actions={
                  item.status === 'failed' || item.status === 'done' ? (
                    <>
                      {item.status === 'failed' && item.failure !== 'conflict' && item.failure !== 'stage' ? (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            engine.retry(item.key);
                          }}
                        >
                          {documentText.retry}
                        </Button>
                      ) : null}
                      <Button
                        variant="tertiary"
                        onClick={() => {
                          engine.dismiss(item.key);
                        }}
                      >
                        {documentText.dismiss}
                      </Button>
                    </>
                  ) : undefined
                }
              />
            );
          })}
        </ul>
      )}
      {failure === null ? null : <InlineAlert tone="error">{failure}</InlineAlert>}
      {softErase.failure === null ? null : <InlineAlert tone="error">{failureText(softErase.failure)}</InlineAlert>}
      {list.isPending ? <SectionLoading /> : null}
      {list.isError ? (
        <EmptyState
          icon={CircleAlert}
          title={documentText.loadFailed}
          description={documentText.loadFailedHint}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                void list.refetch();
              }}
            >
              {documentText.retryLoad}
            </Button>
          }
        />
      ) : null}
      {list.isSuccess && documents.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={documentText.empty}
          description={canEdit ? documentText.emptyHint : documentText.emptyReadOnly}
          {...(canEdit
            ? {
                action: (
                  <Button
                    disabled={!online}
                    onClick={() => {
                      setAdding(true);
                    }}
                  >
                    {documentText.add}
                  </Button>
                ),
              }
            : {})}
        />
      ) : null}
      {documents.length > 0 ? (
        <DataTable
          caption={documentText.tableCaption}
          columns={[
            { id: 'title-kind', header: documentText.columns.kind, card: 'meta' },
            { id: 'title', header: documentText.columns.title, card: 'primary' },
            { id: 'stage', header: documentText.columns.stage, card: 'meta', cardLabel: true },
            { id: 'version', header: documentText.columns.version, card: 'meta', cardLabel: true },
            { id: 'class', header: documentText.columns.confidentiality, card: 'meta', cardLabel: true },
            { id: 'state', header: documentText.columns.state, card: 'detail' },
            { id: 'actions', header: documentText.columns.actions, card: 'action' },
          ]}
          rows={rows}
        />
      ) : null}
      {list.hasNextPage ? (
        <Button
          variant="secondary"
          loading={list.isFetchingNextPage}
          onClick={() => {
            void list.fetchNextPage();
          }}
        >
          {documentText.showMore}
        </Button>
      ) : null}
      <DocumentUploadDialog
        open={adding}
        workOrderId={order.id}
        hasSite={order.site !== null}
        hasCustomer={order.customer !== null}
        kinds={kinds.data ?? []}
        kindsFailed={kinds.isError}
        engine={engine}
        onClose={() => {
          setAdding(false);
        }}
      />
      <DocumentEditDialog
        workOrderId={order.id}
        document={editing}
        onClose={() => {
          setEditingId(null);
        }}
      />
      <DocumentRaiseDialog
        workOrderId={order.id}
        document={raising}
        onClose={() => {
          setRaisingId(null);
        }}
      />
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

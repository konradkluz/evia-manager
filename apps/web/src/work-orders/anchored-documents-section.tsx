import type { Document as OrderDocument } from '@evia/contracts';
import { Button, CircleAlert, DataTable, EmptyState, FileText, InlineAlert, Lock } from '@evia/ui-web';
import { useId, useState } from 'react';
import { useOnline } from '../shell/use-online.ts';
import { confidentialityLabel, documentText } from './document-labels.ts';
import { downloadable, fileLook } from './documents-section.tsx';
import { startDownload } from './media-viewer.tsx';
import { SectionLoading } from './section-states.tsx';
import { documentRequestFailure, useAnchoredDocumentList, useAnchoredDownload, type DocumentOwner } from './use-documents.ts';
import { isNotFound } from './use-work-order.ts';

/**
 * "Dokumenty lokalizacji (n)" / "Dokumenty klienta (n)" (W-09 under the documents of the order, W-14 in the details of a customer; EVM-050 AC1,
 * AC2, AC5, AC7): the documents with that anchor, read from the list of the location or of the customer - the same records in every order of
 * the location or of the customer, never the documents or the media of another order (SR-AUTHZ-08). The rows say the class in words (the icon
 * `lock` for a restricted one); Tylko odczyt gets "Pobierz" for the class `standard` only. A location or a customer that is gone (`404`) shows
 * no documents at all (AC7). Titles and file names are text only (SR-WEB-03).
 */
export function AnchoredDocumentsSection({
  owner,
  queryKey,
  enabled,
  sending = false,
}: {
  readonly owner: DocumentOwner;
  readonly queryKey: readonly unknown[];
  readonly enabled: boolean;
  readonly sending?: boolean;
}) {
  const headingId = useId();
  const online = useOnline();
  const list = useAnchoredDocumentList(owner, queryKey, enabled, sending);
  const request = useAnchoredDownload(owner);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const site = owner.anchor === 'site';

  const gone = list.isError && isNotFound(list.error);
  const documents = gone ? [] : (list.data?.pages.flatMap((page) => page.items) ?? []);
  const total = gone ? 0 : (list.data?.pages[0]?.totalCount ?? 0);
  const heading = site ? documentText.siteHeading(total) : documentText.customerHeading(total);

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

  const rows = documents.map((document) => {
    const look = fileLook(document);
    return {
      id: document.id,
      label: document.title,
      cells: [
        document.kindName,
        <div key="title" className="flex min-w-0 flex-col">
          <span className="break-words">{document.title}</span>
          {document.description === null ? null : <span className="break-words text-text-secondary">{document.description}</span>}
          {document.originalFilename === null ? null : <span className="break-words text-text-secondary">{document.originalFilename}</span>}
        </div>,
        String(document.versionNumber),
        <span key="class" className="inline-flex items-center gap-inline-xs">
          {document.confidentiality === 'standard' ? null : <Lock aria-hidden="true" className="size-icon-md shrink-0" />}
          {confidentialityLabel(document.confidentiality)}
        </span>,
        <div key="state" className="flex flex-col">
          <span>{look.label}</span>
          {look.detail === undefined ? null : <span className="text-text-secondary">{look.detail}</span>}
          {!document.canDownload ? <span className="text-text-secondary">{documentText.restricted}</span> : null}
        </div>,
        downloadable(document) ? (
          <Button
            key="download"
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
        ) : null,
      ],
    };
  });

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-stack-md">
      <h2 id={headingId} className="text-heading-3 text-text-primary">
        {heading}
      </h2>
      {failure === null ? null : <InlineAlert tone="error">{failure}</InlineAlert>}
      {list.isPending && enabled ? <SectionLoading /> : null}
      {list.isError && !gone ? (
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
      {(list.isSuccess && documents.length === 0) || gone ? (
        <EmptyState
          icon={FileText}
          title={site ? documentText.siteEmpty : documentText.customerEmpty}
          description={documentText.anchoredEmptyHint}
        />
      ) : null}
      {documents.length > 0 ? (
        <DataTable
          caption={site ? documentText.siteCaption : documentText.customerCaption}
          columns={[
            { id: 'kind', header: documentText.columns.kind, card: 'meta' },
            { id: 'title', header: documentText.columns.title, card: 'primary' },
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
    </section>
  );
}

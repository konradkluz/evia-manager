import {
  createDocumentDownloadUrl,
  listDocumentKinds,
  listDocuments,
  updateDocument,
  type DocumentList,
  type UpdateDocumentRequest,
  type DocumentKind,
  type Document as OrderDocument,
} from '@evia/contracts';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { documentText } from './document-labels.ts';
import { DocumentUploadEngine, type DocumentItem } from './document-upload-engine.ts';
import { putPart } from './media-put.ts';
import { isStageRejection } from './stage-choice.ts';
import { WORK_ORDER_DOCUMENTS_KEY, WORK_ORDER_PROCEDURES_KEY } from './query-keys.ts';
import { hashFile } from './sha256.ts';

/** The page of the list (the API's default is 25; at most 100). */
export const DOCUMENTS_PAGE_SIZE = 50;
/** While a file waits for the scan the list is read again ("Sprawdzanie pliku" → "Gotowy" arrives without a click). */
export const DOCUMENTS_POLL_MS = 3000;

const WAITING = new Set(['pending_upload', 'uploaded', 'scanning']);

/** The pause before the next read of the list; `false` stops the polling (nothing waits for the server, or the tab is still sending). */
export function documentsPollInterval(documents: readonly Pick<OrderDocument, 'fileState'>[], sending: boolean): number | false {
  return sending || documents.some((entry) => WAITING.has(entry.fileState)) ? DOCUMENTS_POLL_MS : false;
}

export function useDocumentList(workOrderId: string, sending: boolean): UseInfiniteQueryResult<InfiniteData<DocumentList, string | null>> {
  const client = useApi();
  return useInfiniteQuery({
    queryKey: [WORK_ORDER_DOCUMENTS_KEY, workOrderId, 'list'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        listDocuments({
          client,
          signal,
          path: { workOrderId },
          query: { limit: DOCUMENTS_PAGE_SIZE, ...(pageParam === null ? {} : { cursor: pageParam }) },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: (query) => documentsPollInterval(query.state.data?.pages.flatMap((page) => page.items) ?? [], sending),
    gcTime: 0,
    retry: false,
  });
}

/** The kinds of documents with the class of each (the catalog is small and changes rarely, so it is kept for the session of the tab). */
export function useDocumentKinds(enabled: boolean) {
  const client = useApi();
  return useQuery({
    queryKey: ['document-kinds'],
    queryFn: async ({ signal }): Promise<readonly DocumentKind[]> => (await unwrap(listDocumentKinds({ client, signal }))).items,
    enabled,
    staleTime: 5 * 60_000,
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

export interface DocumentUpload {
  readonly engine: DocumentUploadEngine;
  readonly items: readonly DocumentItem[];
}

/**
 * The upload of the documents of one order: the engine of the tab (kept while the order is open, whatever tab of W-06 is shown). Closing the tab
 * with a file that is not on the server yet asks first (the warning of the browser); a change of the queue reads the list again.
 */
export function useDocumentUpload(workOrderId: string): DocumentUpload {
  const client = useApi();
  const queryClient = useQueryClient();
  const engine = useMemo(
    () => new DocumentUploadEngine({ client, workOrderId, hash: hashFile, put: putPart, isOnline: () => navigator.onLine, whenOnline }),
    [client, workOrderId],
  );
  const items = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const signature = items.map((entry) => `${entry.key}:${entry.status}`).join('|');
  useEffect(() => {
    if (signature !== '') void queryClient.invalidateQueries({ queryKey: [WORK_ORDER_DOCUMENTS_KEY, workOrderId] });
  }, [signature, queryClient, workOrderId]);
  // A stage that is gone (EVM-048 AC8): the list of the stages is read again.
  const stageGone = items.some((entry) => entry.failure === 'stage');
  useEffect(() => {
    if (stageGone) void queryClient.invalidateQueries({ queryKey: [WORK_ORDER_PROCEDURES_KEY, workOrderId] });
  }, [stageGone, queryClient, workOrderId]);
  const unsent = items.some((entry) => entry.status !== 'done');
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
  return { engine, items };
}

/** The text for a failed request of an address or of a change (never the address, the name or the title). */
export function documentRequestFailure(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return documentText.downloadGone;
    if (error.status === 429) return documentText.downloadLimited;
    if (error.status === 403) return documentText.downloadForbidden;
  }
  return fallback;
}

/** The address of the file of a document (attachment, at most 5 minutes); returned to the caller, never kept. */
export function useDocumentDownload(workOrderId: string) {
  const client = useApi();
  return (documentId: string): Promise<string> =>
    unwrap(createDocumentDownloadUrl({ client, path: { workOrderId, documentId } })).then((answer) => answer.url);
}

/** "Podnieś klasę" (AC4): `PATCH` with the version of the document in `If-Match`; the list is read again after the answer. */
export function useRaiseClass(workOrderId: string) {
  const client = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { readonly document: OrderDocument; readonly confidentialityOverride: 'building_security' | 'identity_data' }) =>
      unwrap(
        updateDocument({
          client,
          path: { workOrderId, documentId: input.document.id },
          headers: { 'If-Match': `"${String(input.document.version)}"` },
          body: { confidentialityOverride: input.confidentialityOverride },
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: [WORK_ORDER_DOCUMENTS_KEY, workOrderId] }),
  });
}

/** The text of a failed "Podnieś klasę". */
export function raiseFailure(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return documentText.raiseRejected;
    if (error.status === 403) return documentText.raiseForbidden;
    if (error.status === 404 || error.status === 409 || error.status === 412 || error.status === 428) return documentText.raiseConflict;
  }
  return documentText.raiseFailed;
}

export interface DocumentEdit {
  readonly document: OrderDocument;
  /** Only the fields that changed (`description: null` clears it, `procedureStageId: null` = no stage). */
  readonly patch: UpdateDocumentRequest;
}

/** "Edytuj…" of a document (EVM-048 AC3): title, description and stage in one `PATCH` with the version in `If-Match`. */
export function useEditDocument(workOrderId: string) {
  const client = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (edit: DocumentEdit) =>
      unwrap(
        updateDocument({
          client,
          path: { workOrderId, documentId: edit.document.id },
          headers: { 'If-Match': `"${String(edit.document.version)}"` },
          body: edit.patch,
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: [WORK_ORDER_DOCUMENTS_KEY, workOrderId] }),
  });
}

/** The text of a failed edit of a document (never the title, the description or the name of the stage). */
export function editDocumentFailure(error: unknown): string {
  if (!(error instanceof ApiError)) return documentText.editFailed;
  if (isStageRejection(error)) return documentText.editStageGone;
  switch (error.status) {
    case 400:
      return documentText.editRejected;
    case 403:
      return documentText.editForbidden;
    case 404:
      return documentText.editNotFound;
    case 409:
    case 412:
    case 428:
      return documentText.editConflict;
    case 429:
      return documentText.editRate(error.retryAfterSeconds ?? null);
    default:
      return documentText.editFailed;
  }
}

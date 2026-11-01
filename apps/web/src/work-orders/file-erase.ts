import {
  deleteDocument,
  deleteMediaAsset,
  purgeDocumentFile,
  purgeMediaAssetFile,
  restoreDocument,
  restoreMediaAsset,
  type Client,
} from '@evia/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { StepUpCancelled } from '../administration/use-guarded-call.ts';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { useToast } from '../shell/toast-context.tsx';
import { eraseText } from './erase-labels.ts';
import { WORK_ORDER_DOCUMENTS_KEY, WORK_ORDER_MEDIA_KEY } from './query-keys.ts';

/** What is deleted, restored or erased: a medium or a document of the order, with the version for `If-Match` of the purge. */
export interface EraseSubject {
  readonly kind: 'media' | 'document';
  readonly id: string;
  readonly version: number;
}

export type EraseFailureKind =
  'forbidden' | 'gone' | 'erased' | 'processing' | 'conflict' | 'registerDown' | 'notConfirmed' | 'network' | 'server';

export interface EraseFailure {
  readonly kind: EraseFailureKind;
  /** Only for `server`: the short trace of the request (never a value of the record). */
  readonly code?: string;
}

/** Why an operation did not go through; the answers carry no names, titles or descriptions. */
export function describeFailure(error: unknown): EraseFailure {
  if (error instanceof StepUpCancelled) return { kind: 'notConfirmed' };
  if (!(error instanceof ApiError) || error.status === 0) return { kind: 'network' };
  if (error.status === 412 || error.status === 428) return { kind: 'conflict' };
  if (error.status === 404) return { kind: 'gone' };
  if (error.status === 403) return { kind: 'forbidden' };
  if (error.status === 409 && error.code === 'file_erased') return { kind: 'erased' };
  if (error.status === 409 && error.code === 'file_processing') return { kind: 'processing' };
  if (error.status === 409) return { kind: 'conflict' };
  if (error.status === 503 && error.code === 'deletion_register_unavailable') return { kind: 'registerDown' };
  return { kind: 'server', code: error.traceId?.slice(0, 8) ?? error.code };
}

export function failureText(failure: EraseFailure): string {
  if (failure.kind === 'server') return eraseText.failure.server(failure.code ?? 'unknown');
  return eraseText.failure[failure.kind];
}

/** The list must be read again when the record changed or is gone (the failure says what happened to it). */
export const refreshesList = (failure: EraseFailure): boolean =>
  failure.kind === 'conflict' || failure.kind === 'gone' || failure.kind === 'erased' || failure.kind === 'processing';

const etag = (version: number) => `"${String(version)}"`;

export function removeSubject(client: Client, workOrderId: string, subject: EraseSubject): Promise<unknown> {
  return subject.kind === 'media'
    ? unwrap(deleteMediaAsset({ client, path: { workOrderId, mediaAssetId: subject.id } }))
    : unwrap(deleteDocument({ client, path: { workOrderId, documentId: subject.id } }));
}

export function restoreSubject(client: Client, workOrderId: string, subject: EraseSubject): Promise<unknown> {
  return subject.kind === 'media'
    ? unwrap(restoreMediaAsset({ client, path: { workOrderId, mediaAssetId: subject.id } }))
    : unwrap(restoreDocument({ client, path: { workOrderId, documentId: subject.id } }));
}

export function purgeSubject(client: Client, workOrderId: string, subject: EraseSubject): Promise<unknown> {
  const headers = { 'If-Match': etag(subject.version) };
  return subject.kind === 'media'
    ? unwrap(purgeMediaAssetFile({ client, path: { workOrderId, mediaAssetId: subject.id }, headers }))
    : unwrap(purgeDocumentFile({ client, path: { workOrderId, documentId: subject.id }, headers }));
}

/** Reads the lists of the media and of the documents of the order again. */
export function useRefreshFiles(workOrderId: string): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [WORK_ORDER_MEDIA_KEY, workOrderId] });
    void queryClient.invalidateQueries({ queryKey: [WORK_ORDER_DOCUMENTS_KEY, workOrderId] });
  }, [queryClient, workOrderId]);
}

/**
 * "Usuń" with the toast "Usunięto. [Cofnij]" (EVM-051 AC1, AC7; Administrator): a soft delete, so there is no dialog. A failure is not a success
 * toast: it is kept in `failure` for an alert. Offline the callers disable the actions; the server decides all the same (`403`, `404`).
 */
export function useSoftErase(workOrderId: string) {
  const client = useApi();
  const showToast = useToast();
  const refresh = useRefreshFiles(workOrderId);
  const [failure, setFailure] = useState<EraseFailure | null>(null);

  const fail = useCallback(
    (error: unknown) => {
      const failed = describeFailure(error);
      if (refreshesList(failed)) refresh();
      setFailure(failed);
    },
    [refresh],
  );

  const restore = useCallback(
    (subject: EraseSubject) => {
      setFailure(null);
      restoreSubject(client, workOrderId, subject)
        .then(() => {
          showToast(eraseText.restored);
          refresh();
        })
        .catch(fail);
    },
    [client, workOrderId, showToast, refresh, fail],
  );

  const remove = useCallback(
    (subject: EraseSubject) => {
      setFailure(null);
      removeSubject(client, workOrderId, subject)
        .then(() => {
          showToast(eraseText.removed, {
            label: eraseText.undo,
            onSelect: () => {
              restore(subject);
            },
          });
          refresh();
        })
        .catch(fail);
    },
    [client, workOrderId, showToast, refresh, fail, restore],
  );

  return {
    remove,
    failure,
    dismissFailure: () => {
      setFailure(null);
    },
  };
}

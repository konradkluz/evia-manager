import { createMediaExport, createMediaExportDownloadUrl, listMediaExports, type MediaExport } from '@evia/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StepUpCancelled, useGuardedCall } from '../administration/use-guarded-call.ts';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { uuidv7 } from '../customers/uuid.ts';
import { exportText } from './export-labels.ts';
import { startDownload } from './media-viewer.tsx';
import { WORK_ORDER_MEDIA_KEY } from './query-keys.ts';

// The ZIP export of the photos of an order (EVM-052). The list holds only the caller's own active exports; the address of the file
// is used at once by an anchor and forgotten (never kept in the state, logged or shown). The server decides - hiding is a convenience.

/** While an export is prepared the list is read again. */
export const EXPORT_POLL_MS = 3000;

const exportsKey = (workOrderId: string) => [WORK_ORDER_MEDIA_KEY, workOrderId, 'exports'] as const;

export function useMediaExports(workOrderId: string, enabled: boolean) {
  const client = useApi();
  return useQuery({
    queryKey: exportsKey(workOrderId),
    queryFn: ({ signal }) => unwrap(listMediaExports({ client, signal, path: { workOrderId } })),
    enabled,
    gcTime: 0,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.items.some((entry) => entry.state === 'queued' || entry.state === 'running') === true ? EXPORT_POLL_MS : false,
  });
}

/** The text of a failed order of an export (closed codes of the server, never a stack or a message of the storage). */
export function exportFailureText(error: unknown): string {
  if (!(error instanceof ApiError)) return exportText.server;
  switch (error.status) {
    case 0:
      return exportText.network;
    case 403:
      return exportText.forbidden;
    case 404:
      return exportText.notFound;
    case 409:
      return exportText.noMedia;
    case 429:
      return error.code === 'export_too_large' ? exportText.tooLarge : exportText.limited;
    case 503:
      return exportText.unavailable;
    default:
      return exportText.server;
  }
}

export function useOrderExport(workOrderId: string) {
  const client = useApi();
  const queryClient = useQueryClient();
  const guarded = useGuardedCall(exportText.stepUpTitle);
  const [failure, setFailure] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: exportsKey(workOrderId) });
  const order = useMutation({
    mutationFn: () => {
      const key = uuidv7();
      return guarded.run(() => unwrap(createMediaExport({ client, path: { workOrderId }, headers: { 'Idempotency-Key': key } })));
    },
    onSuccess: () => {
      setFailure(null);
    },
    onError: (error) => {
      setFailure(error instanceof StepUpCancelled ? exportText.notConfirmed : exportFailureText(error));
    },
    onSettled: refresh,
  });
  const download = useMutation({
    mutationFn: (exportId: string) => unwrap(createMediaExportDownloadUrl({ client, path: { workOrderId, exportId } })),
    onSuccess: (answer) => {
      setFailure(null);
      startDownload(answer.url, false);
    },
    onError: (error) => {
      setFailure(error instanceof ApiError && error.status === 404 ? exportText.gone : exportText.downloadFailed);
    },
    onSettled: refresh,
  });
  return {
    stepping: guarded.stepping,
    ordering: order.isPending,
    downloading: download.isPending,
    failure,
    clearFailure: () => {
      setFailure(null);
    },
    order: (onSettled: () => void) => {
      setFailure(null);
      order.mutate(undefined, { onSettled });
    },
    download: (exportId: string) => {
      setFailure(null);
      download.mutate(exportId);
    },
  };
}

export const isPreparing = (entry: MediaExport): boolean => entry.state === 'queued' || entry.state === 'running';

import {
  deleteTimelineEntry,
  getTimelineEntry,
  redactTimelineEntry,
  restoreTimelineEntry,
  type Client,
  type TimelineEntry,
  type TimelineEntryList,
} from '@evia/contracts';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { ApiError, unwrap } from '../api/client.ts';
import { StepUpCancelled } from '../administration/use-guarded-call.ts';
import { uuidv7 } from '../customers/uuid.ts';
import { WORK_ORDER_JOURNAL_KEY } from './query-keys.ts';

/** Why a delete, a restore or a redaction of an entry did not go through (EVM-040 AC3, AC5, AC6, AC7); the answers carry no values. */
export type EraseFailure =
  | {
      readonly kind: 'conflict' | 'gone' | 'event' | 'alreadyRedacted' | 'registerDown' | 'busy' | 'notConfirmed' | 'forbidden' | 'network';
    }
  | { readonly kind: 'server'; readonly code: string };

export function describeEraseFailure(error: unknown): EraseFailure {
  if (error instanceof StepUpCancelled) return { kind: 'notConfirmed' };
  if (!(error instanceof ApiError) || error.status === 0) return { kind: 'network' };
  if (error.status === 412 || error.status === 428) return { kind: 'conflict' };
  if (error.status === 404) return { kind: 'gone' };
  if (error.status === 403) return { kind: 'forbidden' };
  if (error.status === 409 && error.code === 'entry_is_event') return { kind: 'event' };
  if (error.status === 409 && error.code === 'already_redacted') return { kind: 'alreadyRedacted' };
  if (error.status === 503 && error.code === 'deletion_register_unavailable') return { kind: 'registerDown' };
  if (error.status === 503 && error.code === 'service_unavailable') return { kind: 'busy' };
  return { kind: 'server', code: error.traceId?.slice(0, 8) ?? error.code };
}

/** The words for a failure; nothing of the entry is repeated in them. */
export function eraseFailureText(t: TFunction, failure: EraseFailure): string {
  switch (failure.kind) {
    case 'server':
      return t('workOrder.journal.erase.failure.server', { code: failure.code });
    case 'conflict':
      return t('workOrder.journal.erase.failure.conflict');
    case 'gone':
      return t('workOrder.journal.erase.failure.gone');
    case 'event':
      return t('workOrder.journal.erase.failure.event');
    case 'alreadyRedacted':
      return t('workOrder.journal.erase.failure.alreadyRedacted');
    case 'registerDown':
      return t('workOrder.journal.erase.failure.registerDown');
    case 'busy':
      return t('workOrder.journal.erase.failure.busy');
    case 'notConfirmed':
      return t('workOrder.journal.erase.failure.notConfirmed');
    case 'forbidden':
      return t('workOrder.journal.erase.failure.forbidden');
    case 'network':
      return t('workOrder.journal.erase.failure.network');
  }
}

/**
 * The strong ETag of the entry now (`If-Match` of the three operations): `TimelineEntry` carries no version, so it is read just
 * before the operation. A missing header is a version that cannot be trusted — the same as a conflict.
 */
export async function readEntryEtag(client: Client, workOrderId: string, entryId: string): Promise<string> {
  const result = await getTimelineEntry({ client, path: { workOrderId, entryId } });
  await unwrap(Promise.resolve(result));
  const etag = result.response?.headers.get('ETag') ?? null;
  if (etag === null || etag === '') throw new ApiError(412, { code: 'version_conflict' });
  return etag;
}

export async function removeEntry(client: Client, workOrderId: string, entryId: string): Promise<void> {
  const etag = await readEntryEtag(client, workOrderId, entryId);
  await unwrap(
    deleteTimelineEntry({
      client,
      path: { workOrderId, entryId },
      headers: { 'If-Match': etag, 'Idempotency-Key': uuidv7() },
    }),
  );
}

export async function restoreEntry(client: Client, workOrderId: string, entryId: string): Promise<TimelineEntry> {
  const etag = await readEntryEtag(client, workOrderId, entryId);
  return unwrap(
    restoreTimelineEntry({
      client,
      path: { workOrderId, entryId },
      headers: { 'If-Match': etag, 'Idempotency-Key': uuidv7() },
    }),
  );
}

export async function redactEntry(client: Client, workOrderId: string, entryId: string): Promise<TimelineEntry> {
  const etag = await readEntryEtag(client, workOrderId, entryId);
  return unwrap(redactTimelineEntry({ client, path: { workOrderId, entryId }, headers: { 'If-Match': etag } }));
}

/**
 * After a redaction the entry of the cache is replaced with the answer of the server, so the old text does not stay in the memory
 * of the tab (SR-PRIV-04); the journal is read again for the rest (the order of the entries does not change).
 */
export function replaceEntryInCache(queryClient: QueryClient, workOrderId: string, replacement: TimelineEntry): void {
  queryClient.setQueriesData<InfiniteData<TimelineEntryList, string | null>>({ queryKey: [WORK_ORDER_JOURNAL_KEY, workOrderId] }, (data) =>
    data === undefined
      ? data
      : {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.map((item) => (item.id === replacement.id ? replacement : item)),
          })),
        },
  );
}

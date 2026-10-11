import {
  createTimelineEntry,
  listTimelineEntries,
  type CreateTimelineEntryRequest,
  type TimelineEntry,
  type TimelineEntryInputKind,
  type TimelineEventGroup,
  type TimelineEntryList,
} from '@evia/contracts';
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData, type UseInfiniteQueryResult } from '@tanstack/react-query';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { describeFailure, type SaveFailure } from '../forms/save-failure.ts';
import { WORK_ORDER_JOURNAL_KEY } from './query-keys.ts';

/** The page size of "Pokaż starsze" (the API's default; at most 100). */
export const JOURNAL_PAGE_SIZE = 25;

export interface JournalFilters {
  /** `null`: "Wszystko" (every kind the API returns). */
  readonly kind: TimelineEntryInputKind | null;
  /** `null`: every stage. */
  readonly stageId: string | null;
  /** The group of automatic entries ("Zmiany statusów"); excludes `kind` (the server answers `400` for both). */
  readonly eventGroup: TimelineEventGroup | null;
}

/**
 * The journal of an order, newest first, a page at a time with the cursor of the API (EVM-037 AC6). The filters are part
 * of the key AND of the request (the server filters in SQL and binds the cursor to them). The texts are free text with
 * personal data: the entries live in the memory of the tab only — `gcTime: 0`, no persistence, a logout and a `401` drop
 * them (SR-WEB-05, TM-10).
 */
export function useJournal(
  workOrderId: string,
  filters: JournalFilters,
  enabled: boolean,
): UseInfiniteQueryResult<InfiniteData<TimelineEntryList, string | null>> {
  const client = useApi();
  return useInfiniteQuery({
    queryKey: [WORK_ORDER_JOURNAL_KEY, workOrderId, filters.kind, filters.stageId, filters.eventGroup],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        listTimelineEntries({
          client,
          signal,
          path: { workOrderId },
          query: {
            limit: JOURNAL_PAGE_SIZE,
            ...(filters.kind === null ? {} : { kind: filters.kind }),
            ...(filters.eventGroup === null ? {} : { eventGroup: filters.eventGroup }),
            ...(filters.stageId === null ? {} : { procedureStageId: filters.stageId }),
            ...(pageParam === null ? {} : { cursor: pageParam }),
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    gcTime: 0,
    retry: false,
  });
}

/** A request to add an entry: the body of the API and the `Idempotency-Key` that goes with it (the same pair on a retry — AC5). */
export interface CreateEntryRequest {
  readonly body: CreateTimelineEntryRequest;
  readonly key: string;
}

/**
 * Adds an entry; on success the journal of the order is read again so the new entry stands on top. `effects` run when the
 * answer comes even if the field was unmounted meanwhile (callbacks of `mutate` are skipped then — AC5).
 */
export function useCreateJournalEntry(
  workOrderId: string,
  effects?: {
    readonly onSaved?: (request: CreateEntryRequest) => void;
    readonly onRefused?: (error: unknown, request: CreateEntryRequest) => void;
  },
) {
  const client = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    onError: (error: unknown, request: CreateEntryRequest) => {
      effects?.onRefused?.(error, request);
    },
    mutationFn: (request: CreateEntryRequest): Promise<TimelineEntry> =>
      unwrap(
        createTimelineEntry({
          client,
          path: { workOrderId },
          body: request.body,
          headers: { 'Idempotency-Key': request.key },
        }),
      ),
    onSuccess: (_entry, request) => {
      effects?.onSaved?.(request);
      return queryClient.invalidateQueries({ queryKey: [WORK_ORDER_JOURNAL_KEY, workOrderId] });
    },
  });
}

/** The server did not accept the cursor (expired after 30 minutes, other filters): `400 invalid_cursor`. */
export const isBadJournalCursor = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 400 && error.code === 'invalid_cursor';

/** Why an entry was not saved, as the form tells the person (the texts are in the form). */
export type JournalFailure =
  { readonly kind: 'required' | 'tooLong' | 'invalidCharacters' | 'stage' | 'superseded' | 'entryGone' | 'gone' } | SaveFailure;

/**
 * Maps an error of the creation to a failure: the field errors of the API are matched by their pointer and code (no values
 * in them); no answer, a 5xx and a repeat in progress are a failure of the network — the retry keeps the `id` and the key,
 * so nothing is saved twice (AC5).
 */
export function describeJournalFailure(error: unknown): JournalFailure {
  if (error instanceof ApiError) {
    if (error.status === 404) return { kind: 'gone' };
    if (error.status === 409 && error.code === 'entry_superseded') return { kind: 'superseded' };
    if (error.status === 400) {
      for (const entry of error.errors) {
        if (entry.pointer === '/procedureStageId') return { kind: 'stage' };
        if (entry.pointer === '/supersedesEntryId') return { kind: 'entryGone' };
        if (entry.pointer === '/body' && entry.code === 'too_long') return { kind: 'tooLong' };
        if (entry.pointer === '/body' && entry.code === 'required') return { kind: 'required' };
        if (entry.pointer === '/body') return { kind: 'invalidCharacters' };
      }
    }
  }
  return describeFailure(error, false);
}

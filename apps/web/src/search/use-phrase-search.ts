import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../api/client.ts';
import { useDebounced } from '../shell/use-debounced.ts';
import { useOnline } from '../shell/use-online.ts';

/** The phrase must have 3–100 characters after trimming (the same bounds the API checks; a shorter one is never sent). */
const SEARCH_MIN = 3;
const SEARCH_MAX = 100;
/** The search starts when typing pauses; the API allows 60 searches a minute per person and kind of search. */
const SEARCH_DELAY_MS = 300;

const phraseOf = (text: string): string => text.normalize('NFC').trim();

export type PhraseState = 'empty' | 'short' | 'long' | 'ok';

export function phraseState(text: string): PhraseState {
  const length = Array.from(phraseOf(text)).length;
  if (length === 0) return 'empty';
  if (length < SEARCH_MIN) return 'short';
  return length > SEARCH_MAX ? 'long' : 'ok';
}

export interface PhraseSearch<T> {
  readonly state: PhraseState;
  /** A search is on its way or waiting for the typing to pause. */
  readonly loading: boolean;
  readonly items: readonly T[] | undefined;
  readonly error: ApiError | undefined;
  readonly online: boolean;
  readonly retry: () => void;
}

export interface PhraseSearchOptions<T> {
  readonly text: string;
  readonly enabled: boolean;
  /** Names the search in the cache (and tells one search from another: customers, sites, parties of a kind). */
  readonly scope: readonly unknown[];
  readonly run: (phrase: string, signal: AbortSignal) => Promise<readonly T[]>;
}

/**
 * Search by a typed phrase (EVM-020 AC1, AC8; EVM-021 AC1, AC3, AC7): the phrase goes in the body of a `POST` (never in the
 * address, the tab title or a log of the panel), not offline, not when shorter than 3 characters. The answer is not kept after
 * it is no longer shown (`gcTime: 0`, SR-WEB-05); logout and `401` drop the rest of the cache.
 */
export function usePhraseSearch<T>({ text, enabled, scope, run }: PhraseSearchOptions<T>): PhraseSearch<T> {
  const online = useOnline();
  const state = phraseState(text);
  const phrase = useDebounced(phraseOf(text), SEARCH_DELAY_MS);
  const settled = phrase === phraseOf(text);
  const active = enabled && online && state === 'ok';
  const query = useQuery({
    queryKey: [...scope, 'search', phrase],
    queryFn: ({ signal }) => run(phrase, signal),
    enabled: active && settled,
    retry: false,
    gcTime: 0,
  });
  return {
    state,
    loading: active && (!settled || query.isPending),
    items: active && settled ? query.data : undefined,
    error: active && settled && query.error instanceof ApiError ? query.error : undefined,
    online,
    retry: () => {
      void query.refetch();
    },
  };
}

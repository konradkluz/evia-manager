import { searchSites, type SiteSearchItem } from '@evia/contracts';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { usePhraseSearch, type PhraseSearch } from '../search/use-phrase-search.ts';

/** Search of sites by address (EVM-021 AC1, AC7): `POST /api/v1/sites/search`, the phrase in the body. */
export function useSiteSearch(text: string, enabled = true): PhraseSearch<SiteSearchItem> {
  const client = useApi();
  return usePhraseSearch({
    text,
    enabled,
    scope: ['sites'],
    run: async (phrase, signal) => (await unwrap(searchSites({ client, signal, body: { query: phrase } }))).items,
  });
}

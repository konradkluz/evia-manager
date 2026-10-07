import { searchParties, type PartyKind, type PartySearchItem } from '@evia/contracts';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { usePhraseSearch, type PhraseSearch } from '../search/use-phrase-search.ts';

/**
 * Search of parties restricted to `kinds` (EVM-021 AC3): the combobox of the OSD asks for `distribution_system_operator`,
 * the combobox of the manager for the three kinds of managers. The filter travels in the body, next to the phrase.
 */
export function usePartySearch(text: string, kinds: readonly PartyKind[], enabled = true): PhraseSearch<PartySearchItem> {
  const client = useApi();
  return usePhraseSearch({
    text,
    enabled,
    scope: ['parties', ...kinds],
    run: async (phrase, signal) => (await unwrap(searchParties({ client, signal, body: { query: phrase, kinds: [...kinds] } }))).items,
  });
}

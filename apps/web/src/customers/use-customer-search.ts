import { searchCustomers, type CustomerSearchItem } from '@evia/contracts';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { usePhraseSearch, type PhraseSearch } from '../search/use-phrase-search.ts';

export type CustomerSearch = PhraseSearch<CustomerSearchItem>;

/** Search of customers (EVM-020 AC1, AC8) — the rules of the phrase and the states are in `usePhraseSearch`. */
export function useCustomerSearch(text: string, enabled = true): CustomerSearch {
  const client = useApi();
  return usePhraseSearch({
    text,
    enabled,
    scope: ['customers'],
    run: async (phrase, signal) => (await unwrap(searchCustomers({ client, signal, body: { query: phrase } }))).items,
  });
}

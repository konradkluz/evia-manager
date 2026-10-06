/**
 * Data layer of the panel (EVM-008 AC2; ADR-0004, ADR-0006): the fetch client generated from the OpenAPI contract
 * (@evia/contracts, built by `^build`) and TanStack Query options. The API is same-origin (/api) — session cookies
 * (E1) travel with same-origin requests; no tokens in browser storage.
 * The shell does not call the API at runtime (architect, point 18) — the first query arrives with the list of work
 * orders; getHealth is the contract operation available today.
 */
import { createClient, getHealth, type Client } from '@evia/contracts';
import { queryOptions } from '@tanstack/react-query';

export function createApiClient(fetchImplementation: typeof fetch = globalThis.fetch): Client {
  return createClient({ baseUrl: globalThis.location.origin, fetch: fetchImplementation });
}

export function healthQueryOptions(client: Client) {
  return queryOptions({
    queryKey: ['health'],
    queryFn: async ({ signal }) => {
      const { data } = await getHealth({ client, signal, throwOnError: true });
      return data;
    },
  });
}

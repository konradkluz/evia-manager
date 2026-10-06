import { getCurrentSession, type Client } from '@evia/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { unwrap } from '../api/client.ts';
import { useApi } from '../api/api-context.tsx';
import { setCsrfToken } from './csrf.ts';
import { noteServerDate } from './server-clock.ts';

/** Query key of the session; the error handler of the cache keeps this query when it clears the others. */
export const SESSION_KEY = ['session'] as const;

/**
 * The current session (user, state, token CSRF). A fresh answer replaces the token in the memory of the tab. No retry:
 * `401` is an answer (no session), not a failure to repeat. Revocation is noticed on focus once the data is stale.
 */
export function sessionQueryOptions(client: Client) {
  return queryOptions({
    queryKey: SESSION_KEY,
    queryFn: async ({ signal }) => {
      const result = await getCurrentSession({ client, signal });
      noteServerDate(result.response?.headers.get('Date'));
      const session = await unwrap(Promise.resolve(result));
      setCsrfToken(session.csrfToken);
      return session;
    },
    retry: false,
    staleTime: 60_000,
  });
}

export function useSession() {
  return useQuery(sessionQueryOptions(useApi()));
}

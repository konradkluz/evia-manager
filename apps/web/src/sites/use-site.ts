import { getSite, type Site } from '@evia/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { SITE_KEY } from '../work-orders/query-keys.ts';

/**
 * The site as the dialog "Edytuj lokalizację" needs it (EVM-036 AC1): the whole site and its version (the `If-Match` of the save).
 * It lives in the memory of the tab only while the dialog is open (SR-WEB-05) and is read again on every opening.
 */
export function useSite(siteId: string): UseQueryResult<Site> {
  const client = useApi();
  return useQuery({
    queryKey: [SITE_KEY, siteId],
    queryFn: ({ signal }) => unwrap(getSite({ client, signal, path: { siteId } })),
    retry: false,
    gcTime: 0,
  });
}

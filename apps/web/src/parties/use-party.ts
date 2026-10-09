import { getParty, type Party } from '@evia/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { PARTY_KEY } from '../work-orders/query-keys.ts';

/**
 * A party as the dialogs need it (EVM-036 AC2, AC3): its kind (for the line of a chosen party) and, for "Edytuj stronę", the whole
 * party and its version. `partyId` `undefined` reads nothing. Memory of the tab only, while the dialog is open (SR-WEB-05).
 */
export function useParty(partyId: string | undefined): UseQueryResult<Party> {
  const client = useApi();
  return useQuery({
    queryKey: [PARTY_KEY, partyId],
    queryFn: ({ signal }) => unwrap(getParty({ client, signal, path: { partyId: partyId ?? '' } })),
    enabled: partyId !== undefined,
    retry: false,
    gcTime: 0,
  });
}

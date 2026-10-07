import { listAssignableUsers, listWorkOrderTemplates } from '@evia/contracts';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';

/** Query keys: the lists are dropped together with the rest of the cache at logout and at a `401`. */
export const TEMPLATES_KEY = ['catalog', 'work-order-templates'] as const;
export const ASSIGNABLE_USERS_KEY = ['users', 'assignable'] as const;

/**
 * Active templates of work orders (EVM-019; the card of W-05 shows the scope only). The whole small set is read once; the
 * filter by the type of the object is done in the panel, so that "Pokaż wszystkie" needs no new request.
 */
export function useTemplates() {
  const client = useApi();
  return useQuery({
    queryKey: TEMPLATES_KEY,
    queryFn: async () => (await unwrap(listWorkOrderTemplates({ client }))).items,
    // The panel shows the failure itself ("Spróbuj ponownie"); a silent retry would only delay it.
    retry: false,
  });
}

/** The users who can be the coordinator of an order: only `id` and `displayName` (SR-DATA-03). */
export function useAssignableUsers() {
  const client = useApi();
  return useQuery({
    queryKey: ASSIGNABLE_USERS_KEY,
    queryFn: async () => (await unwrap(listAssignableUsers({ client }))).items,
    retry: false,
  });
}

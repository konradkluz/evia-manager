import { listAssignableUsers, listProcedureTemplates, listServiceItems, listWorkOrderTemplates } from '@evia/contracts';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';

/** Query keys: the lists are dropped together with the rest of the cache at logout and at a `401`. */
export const TEMPLATES_KEY = ['catalog', 'work-order-templates'] as const;
export const ASSIGNABLE_USERS_KEY = ['users', 'assignable'] as const;
export const SERVICE_ITEMS_KEY = ['catalog', 'service-items'] as const;
export const PROCEDURE_TEMPLATES_KEY = ['catalog', 'procedure-templates'] as const;

/**
 * Active templates of work orders (EVM-019; the card of W-05 shows the scope only). The whole small set is read once; the
 * filter by the type of the object is done in the panel, so that "Pokaż wszystkie" needs no new request.
 */
export function useTemplates(enabled = true) {
  const client = useApi();
  return useQuery({
    queryKey: TEMPLATES_KEY,
    queryFn: async () => (await unwrap(listWorkOrderTemplates({ client }))).items,
    enabled,
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

/**
 * The active items of the service catalogue (EVM-035 AC2): the name, the category, the set of parameters and the codes of the
 * processes an item brings. Small set, read whole; `enabled` keeps the dialog and the journal from reading it before it is needed.
 */
export function useServiceItems(enabled = true) {
  const client = useApi();
  return useQuery({
    queryKey: SERVICE_ITEMS_KEY,
    queryFn: async () => (await unwrap(listServiceItems({ client }))).items,
    enabled,
    retry: false,
  });
}

/** The templates of the processes with their stages (EVM-035 AC2: the names and the number of stages of what an item brings). */
export function useProcedureTemplates(enabled = true) {
  const client = useApi();
  return useQuery({
    queryKey: PROCEDURE_TEMPLATES_KEY,
    queryFn: async () => (await unwrap(listProcedureTemplates({ client }))).items,
    enabled,
    retry: false,
  });
}

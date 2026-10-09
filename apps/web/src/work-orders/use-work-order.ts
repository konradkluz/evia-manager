import {
  getWorkOrder,
  getWorkOrderCustomer,
  getWorkOrderSite,
  listWorkOrderProcedures,
  listWorkOrderScopeItems,
  listWorkOrderSiteOrders,
  type CustomerCard,
  type ProcedureList,
  type ScopeItemList,
  type SiteCard,
  type SiteOrders,
  type WorkOrderDetails,
} from '@evia/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import {
  WORK_ORDER_HEADER_KEY,
  WORK_ORDER_CUSTOMER_KEY,
  WORK_ORDER_PROCEDURES_KEY,
  WORK_ORDER_SCOPE_KEY,
  WORK_ORDER_SITE_KEY,
  WORK_ORDER_SITE_ORDERS_KEY,
} from './query-keys.ts';

/**
 * The four reads of W-06 (EVM-018): the header, the scope, the card of the customer and the card of the site. Each is its own
 * request anchored in the order (there is no collective endpoint), so one section can fail while the others work (AC7).
 * The data lives in the query cache — the memory of this tab only: no `persistQueryClient`, nothing in a store of the browser
 * (SR-WEB-05, TM-10); logout and a `401` clear it, a `404` removes the four entries of the order (see the page).
 *
 * `enabled: false` is used once the order turned out to be gone, so the removed entries are not asked for again.
 */
const common = { retry: false } as const;

export function useWorkOrderHeader(id: string, enabled: boolean): UseQueryResult<WorkOrderDetails> {
  const client = useApi();
  return useQuery({
    queryKey: [WORK_ORDER_HEADER_KEY, id],
    queryFn: ({ signal }) => unwrap(getWorkOrder({ client, signal, path: { workOrderId: id } })),
    enabled,
    ...common,
  });
}

export function useWorkOrderScope(id: string, enabled: boolean): UseQueryResult<ScopeItemList> {
  const client = useApi();
  return useQuery({
    queryKey: [WORK_ORDER_SCOPE_KEY, id],
    queryFn: ({ signal }) => unwrap(listWorkOrderScopeItems({ client, signal, path: { workOrderId: id } })),
    enabled,
    // The card of a person stays in memory only while the page is open (SR-WEB-05).
    gcTime: 0,
    ...common,
  });
}

export function useWorkOrderCustomer(id: string, enabled: boolean): UseQueryResult<CustomerCard> {
  const client = useApi();
  return useQuery({
    queryKey: [WORK_ORDER_CUSTOMER_KEY, id],
    queryFn: ({ signal }) => unwrap(getWorkOrderCustomer({ client, signal, path: { workOrderId: id } })),
    enabled,
    gcTime: 0,
    ...common,
  });
}

export function useWorkOrderSite(id: string, enabled: boolean): UseQueryResult<SiteCard> {
  const client = useApi();
  return useQuery({
    queryKey: [WORK_ORDER_SITE_KEY, id],
    queryFn: ({ signal }) => unwrap(getWorkOrderSite({ client, signal, path: { workOrderId: id } })),
    enabled,
    gcTime: 0,
    ...common,
  });
}

/**
 * The other orders of the site of this order (EVM-036 AC5): metadata only — the number, the title, the status and the date of closing.
 * The server takes the site from the order, so there is no site in the request. Titles are free text of other orders: memory of the tab only.
 */
export function useWorkOrderSiteOrders(id: string, enabled: boolean): UseQueryResult<SiteOrders> {
  const client = useApi();
  return useQuery({
    queryKey: [WORK_ORDER_SITE_ORDERS_KEY, id],
    queryFn: ({ signal }) => unwrap(listWorkOrderSiteOrders({ client, signal, path: { workOrderId: id } })),
    enabled,
    gcTime: 0,
    ...common,
  });
}

/**
 * The processes of the order with their stages (EVM-031 AC2): one read for the section "Procesy i etapy" and for the number of
 * open stages in the dialog "Zakończ" (AC4). The names of the people are personal data (DO-P): the memory of the tab only.
 */
export function useWorkOrderProcedures(id: string, enabled: boolean): UseQueryResult<ProcedureList> {
  const client = useApi();
  return useQuery({
    queryKey: [WORK_ORDER_PROCEDURES_KEY, id],
    queryFn: ({ signal }) => unwrap(listWorkOrderProcedures({ client, signal, path: { workOrderId: id } })),
    enabled,
    gcTime: 0,
    // The section and the dialog "Zakończ" share this entry: the second reader must not ask again, the dialog refreshes it itself.
    staleTime: Infinity,
    ...common,
  });
}

/** `404 not_found` — the order does not exist, is deleted or is not the caller's: the API says the same for all three. */
export const isNotFound = (error: unknown): boolean => error instanceof ApiError && error.status === 404;

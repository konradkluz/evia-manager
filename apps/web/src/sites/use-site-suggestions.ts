import { listWorkOrders, type SiteType, type WorkOrderListItem } from '@evia/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { SITE_SUGGESTIONS_KEY } from '../work-orders/query-keys.ts';

/** The most recent orders read for the suggestion: ONE page, no paging (EVM-043 decision — the locations of the newest 100 orders). */
const SUGGESTION_ORDERS = 100;
/** The answer is kept for the time of working on the form: showing the list again (mode, "Zmień lokalizację") asks for nothing (limit 300/min, EVM-082). */
const STALE_MS = 10 * 60_000;

/** A location of an earlier order of the customer, as the list of orders carries it (no postal code, SR-DATA-03). */
export interface SiteSuggestion {
  readonly id: string;
  readonly siteType: SiteType;
  readonly street: string;
  readonly buildingNumber: string;
  readonly city: string;
}

/**
 * The distinct locations of the orders, the newest order first (the API sorts `-createdAt`): an order without a (visible) site is
 * skipped, so is one whose customer is gone. Only the allow-listed fields are kept (SR-DATA-03, SR-WEB-05).
 */
export function suggestionsOf(items: readonly WorkOrderListItem[]): SiteSuggestion[] {
  const seen = new Set<string>();
  const found: SiteSuggestion[] = [];
  for (const item of items) {
    const site = item.site;
    if (site === null || site === undefined || seen.has(site.id)) continue;
    if (item.customer !== null && item.customer !== undefined && 'deleted' in item.customer) continue;
    seen.add(site.id);
    found.push({ id: site.id, siteType: site.siteType, street: site.street, buildingNumber: site.buildingNumber, city: site.city });
  }
  return found;
}

/**
 * "Lokalizacje z poprzednich zleceń klienta" (EVM-043 AC1–AC4): ONE `listWorkOrders` per chosen customer (the key is the customer
 * only), from the same list and the same read policy as W-10 (SR-AUTHZ-03), no phrase in the address (SR-API-04). No retry, no refetch
 * on focus, no polling: a failure is read again only by the button (limit 300 requests a minute per user, EVM-082). The entry
 * is dropped with the form (`gcTime: 0`, SR-WEB-05); `enabled` says whether a customer is chosen and the panel is online.
 */
export function useSiteSuggestions(customerId: string | null, enabled: boolean): UseQueryResult<SiteSuggestion[]> {
  const client = useApi();
  return useQuery({
    queryKey: [SITE_SUGGESTIONS_KEY, customerId],
    queryFn: async ({ signal }) =>
      suggestionsOf(
        (
          await unwrap(
            listWorkOrders({ client, signal, query: { customerId: customerId ?? '', sort: '-createdAt', limit: SUGGESTION_ORDERS } }),
          )
        ).items,
      ),
    enabled: enabled && customerId !== null,
    staleTime: STALE_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    gcTime: 0,
  });
}

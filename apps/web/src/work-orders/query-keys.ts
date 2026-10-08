/** Query key root of the pages of W-10: the loaded pages are dropped from the cache together (logout, a `401`, a new order). */
export const WORK_ORDERS_KEY = 'work-orders' as const;

/**
 * The header of a work order (W-06, EVM-018). The creation (EVM-022) puts the answer of the API here before the page opens,
 * so the header is shown at once; the page asks again and the answer of the API replaces it.
 */
export const WORK_ORDER_HEADER_KEY = 'work-order-header' as const;

/** The other three reads of W-06: the scope, the card of the customer, the card of the site. Each key is `[name, workOrderId]`. */
export const WORK_ORDER_SCOPE_KEY = 'work-order-scope' as const;
export const WORK_ORDER_CUSTOMER_KEY = 'work-order-customer' as const;
export const WORK_ORDER_SITE_KEY = 'work-order-site' as const;

/** All four keys of one order: a `404` removes them together (TM-10 — nothing of a gone order stays in the memory of the tab). */
export const WORK_ORDER_KEYS = [WORK_ORDER_HEADER_KEY, WORK_ORDER_SCOPE_KEY, WORK_ORDER_CUSTOMER_KEY, WORK_ORDER_SITE_KEY] as const;

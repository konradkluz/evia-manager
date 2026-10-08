/**
 * Query keys of W-14 (EVM-039). Everything here is personal data (DO-K): the entries live in the memory of the tab only, are
 * dropped when the page is left (`gcTime: 0`), at logout and at a `401` (the cache is cleared — see `createQueryClient`).
 */
export const CUSTOMER_LIST_KEY = 'customer-list' as const;
export const CUSTOMER_KEY = 'customer' as const;
export const CUSTOMER_ORDERS_KEY = 'customer-orders' as const;

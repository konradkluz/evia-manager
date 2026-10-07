/** Query key root of the pages of W-10: the loaded pages are dropped from the cache together (logout, a `401`, a new order). */
export const WORK_ORDERS_KEY = 'work-orders' as const;

/** The header of a work order that was just created (W-06 shows it without asking again; the details come with EVM-018). */
export const WORK_ORDER_HEADER_KEY = 'work-order-header' as const;

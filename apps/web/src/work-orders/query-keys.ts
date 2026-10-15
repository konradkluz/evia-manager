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
/** "Inne zlecenia w tej lokalizacji" (EVM-036): metadata of the other orders of the site of this order — a read of its own. */
export const WORK_ORDER_SITE_ORDERS_KEY = 'work-order-site-orders' as const;
/** The processes with their stages (EVM-031): the section of W-06 and the warning of the dialog "Zakończ" read the same entry. */
export const WORK_ORDER_PROCEDURES_KEY = 'work-order-procedures' as const;
/** The deleted processes and stages of the order (EVM-042; Administrator only): the section "Usunięte procesy i etapy". Names are free text — memory of the tab only. */
export const WORK_ORDER_DELETED_PROCEDURES_KEY = 'work-order-deleted-procedures' as const;
/** The instalments of the order with their totals (EVM-053): the section "Płatności" and the warning of "Anuluj zlecenie…" read the same entry. */
export const WORK_ORDER_PAYMENTS_KEY = 'work-order-payments' as const;
/**
 * The unpaid list (W-11, EVM-055): the pages of the list with its tiles and sum. Rows carry the numbers of invoices, the amounts and the
 * names of customers — the memory of the tab only; a command on an instalment (W-06 or W-11) refreshes it.
 */
export const UNPAID_PAYMENTS_KEY = 'unpaid-payments' as const;
/** The journal of the order (EVM-037): the pages of the timeline for one filter; the texts are personal data — memory of the tab only. */
export const WORK_ORDER_JOURNAL_KEY = 'work-order-journal' as const;
/** The site and the party read for the dialogs "Edytuj lokalizację" and "Edytuj stronę" (EVM-036); gone when the dialog closes. */
export const SITE_KEY = 'site' as const;
export const PARTY_KEY = 'party' as const;
/** The locations of the earlier orders of the chosen customer (EVM-043): `[key, customerId]`; addresses are personal data — memory of the tab only. */
export const SITE_SUGGESTIONS_KEY = 'site-suggestions' as const;

/** All keys of one order: a `404` removes them together (TM-10 — nothing of a gone order stays in the memory of the tab). */
export const WORK_ORDER_KEYS = [
  WORK_ORDER_HEADER_KEY,
  WORK_ORDER_SCOPE_KEY,
  WORK_ORDER_CUSTOMER_KEY,
  WORK_ORDER_SITE_KEY,
  WORK_ORDER_SITE_ORDERS_KEY,
  WORK_ORDER_PROCEDURES_KEY,
  WORK_ORDER_DELETED_PROCEDURES_KEY,
  WORK_ORDER_PAYMENTS_KEY,
  WORK_ORDER_JOURNAL_KEY,
] as const;

/**
 * Paths of the panel. English, because a URL is an identifier that must survive a second UI language (architect,
 * EVM-008 point 19); only visible texts are translated. No personal data in paths (styleguide § 3.7), and no tokens:
 * a link token lives only in a fragment that is removed on load (EVM-016 AC5).
 */
export const WORK_ORDERS_PATH = '/work-orders';
/** W-05 (EVM-020): a new work order; a draft of it lives in the memory of the tab only (SR-WEB-05). */
export const NEW_WORK_ORDER_PATH = '/work-orders/new';
/** W-06 (EVM-018): the details of a work order; the identifier is a UUID of the API, never text typed by a person. */
export const workOrderPath = (id: string): string => `${WORK_ORDERS_PATH}/${encodeURIComponent(id)}`;
/** W-14 (EVM-039): the list of customers and the details of one; only the identifier of a customer is in the address, never a name or a phrase. */
export const CUSTOMERS_PATH = '/customers';
export const customerPath = (id: string): string => `${CUSTOMERS_PATH}/${encodeURIComponent(id)}`;
/** W-11 (EVM-055): the unpaid instalments; the address carries only `view=overdue` — never a customer, a range of dates or a cursor. */
export const PAYMENTS_PATH = '/payments';
/** Administration (W-16, W-18; EVM-024, EVM-029): the users are its default page, the audit log the second; only an Administrator sees it in the menu. */
export const ADMINISTRATION_PATH = '/administration';
export const AUDIT_PATH = '/administration/audit';
/** W-16 (EVM-024): the users of the office — the first, default page of the administration; never an e-mail or a name in the address. */
export const USERS_PATH = '/administration/users';
export const ACTIVATE_PATH = '/activate';
/** W-12 (EVM-025): the token of the reset link is only in the fragment and leaves the address at once; never in the path or the query. */
export const RESET_PASSWORD_PATH = '/reset-password';
export const MFA_SETUP_PATH = '/mfa-setup';
export const LOGIN_PATH = '/login';
/** W-19 (EVM-063): reachable with and without a session; the anchors are `#pomoc` and `#prywatnosc` (flow 15). */
export const PRIVACY_PATH = '/privacy';
export const PRIVACY_ANCHORS: readonly string[] = ['pomoc', 'prywatnosc'];
/** W-02: reachable only in the tab that did the first step (the `loginToken` is in memory), otherwise back to W-01. */
export const LOGIN_SECOND_STEP_PATH = '/login/second-step';
/** W-01 "Zresetuj hasło" (EVM-025): the request for a link; the mails of reset and of the blocked account point here. */
export const LOGIN_RESET_PATH = '/login/reset';
/** Pages reachable without a session (the gate does not ask for one). */
export const PUBLIC_PATHS: readonly string[] = [ACTIVATE_PATH, RESET_PASSWORD_PATH, LOGIN_PATH, LOGIN_SECOND_STEP_PATH, LOGIN_RESET_PATH];
/** W-15 (EVM-028): the own account — the profile, the password, the second step (anchor `#drugi-krok`) and the sessions; never an e-mail or a name in the address. */
export const ACCOUNT_PATH = '/account';
export const SECOND_STEP_ANCHOR = 'drugi-krok';
/** W-17 (EVM-095): the devices of all users, a tab of the administration; no user, model or cursor in the address. */
export const DEVICES_PATH = '/administration/devices';

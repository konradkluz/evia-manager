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
/** Administration (W-16, W-18; EVM-029): the audit log is the first page of it; only an Administrator sees it in the menu. */
export const ADMINISTRATION_PATH = '/administration';
export const AUDIT_PATH = '/administration/audit';
export const ACTIVATE_PATH = '/activate';
export const MFA_SETUP_PATH = '/mfa-setup';
export const LOGIN_PATH = '/login';
/** W-02: reachable only in the tab that did the first step (the `loginToken` is in memory), otherwise back to W-01. */
export const LOGIN_SECOND_STEP_PATH = '/login/second-step';
/** Pages reachable without a session (the gate does not ask for one). */
export const PUBLIC_PATHS: readonly string[] = [ACTIVATE_PATH, LOGIN_PATH, LOGIN_SECOND_STEP_PATH];

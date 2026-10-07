/**
 * Paths of the panel. English, because a URL is an identifier that must survive a second UI language (architect,
 * EVM-008 point 19); only visible texts are translated. No personal data in paths (styleguide § 3.7), and no tokens:
 * a link token lives only in a fragment that is removed on load (EVM-016 AC5).
 */
export const WORK_ORDERS_PATH = '/work-orders';
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

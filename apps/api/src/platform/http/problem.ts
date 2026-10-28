/**
 * RFC 9457 problem details (api-guidelines.md → Format błędów; SR-API-01). Fixed English titles per code, a relative
 * `type` (/problems/{code}) until the API domain exists (EVM-007), the trace identifier — never details, values,
 * stack traces or class names. `errors[]` carries only a JSON Pointer and a code per field, never the value.
 */
import type { Response } from 'express';

export const PROBLEMS = Object.freeze({
  malformed_json: { status: 400, title: 'Malformed request body' },
  validation_failed: { status: 400, title: 'Request validation failed' },
  invalid_cursor: { status: 400, title: 'Invalid cursor' },
  duplicate_parameter: { status: 400, title: 'Duplicate query parameter' },
  unknown_parameter: { status: 400, title: 'Unknown query parameter' },
  activation_link_invalid: { status: 400, title: 'Activation link is invalid or expired' },
  password_reset_link_invalid: { status: 400, title: 'Password reset link is invalid or expired' },
  passkey_verification_failed: { status: 400, title: 'Passkey verification failed' },
  totp_verification_failed: { status: 400, title: 'Authenticator code verification failed' },
  unauthenticated: { status: 401, title: 'Authentication required' },
  invalid_credentials: { status: 401, title: 'Invalid email or password' },
  passkey_failed: { status: 401, title: 'Passkey sign-in failed' },
  totp_failed: { status: 401, title: 'Authenticator code rejected' },
  recovery_code_failed: { status: 401, title: 'Recovery code rejected' },
  reauthentication_failed: { status: 401, title: 'Re-authentication failed' },
  login_expired: { status: 401, title: 'Sign-in took too long' },
  session_expired: { status: 401, title: 'Session expired' },
  session_revoked: { status: 401, title: 'Session revoked' },
  // EVM-094: the mobile channel.
  device_wipe_required: { status: 401, title: 'The device must wipe its data' },
  forbidden: { status: 403, title: 'Forbidden' },
  mfa_enrollment_required: { status: 403, title: 'Multi-factor enrollment required' },
  mfa_setup_expired: { status: 403, title: 'The window to set up a second step has expired' },
  channel_not_allowed: { status: 403, title: 'The role cannot sign in on this channel' },
  device_limit_reached: { status: 403, title: 'The limit of devices is reached' },
  totp_not_configured: { status: 403, title: 'A code from an authenticator app is not configured' },
  step_up_required: { status: 403, title: 'Re-authentication required' },
  reauthentication_required: { status: 403, title: 'Full re-authentication required' },
  csrf_failed: { status: 403, title: 'Cross-site request check failed' },
  recovery_codes_regeneration_unavailable: { status: 403, title: 'Recovery codes cannot be regenerated from this session' },
  not_found: { status: 404, title: 'Not found' },
  method_not_allowed: { status: 405, title: 'Method not allowed' },
  id_conflict: { status: 409, title: 'Identifier already in use' },
  mfa_already_configured: { status: 409, title: 'A second step is already configured' },
  last_second_step_method: { status: 409, title: 'The last second step method cannot be removed' },
  current_session: { status: 409, title: 'The current session cannot be ended this way' },
  email_conflict: { status: 409, title: 'A user with this e-mail address already exists' },
  last_active_administrator: { status: 409, title: 'The account is the last active Administrator' },
  own_account_not_allowed: { status: 409, title: 'The operation is not allowed on your own account' },
  administrator_passkey_required: { status: 409, title: 'An Administrator needs a passkey' },
  idempotency_in_progress: { status: 409, title: 'A request with this idempotency key is in progress' },
  invalid_state_transition: { status: 409, title: 'Transition is not allowed from the current state' },
  work_order_closed: { status: 409, title: 'The work order is closed' },
  has_active_dependents: { status: 409, title: 'The resource has active dependents' },
  customer_anonymized: { status: 409, title: 'The customer is anonymized' },
  already_anonymized: { status: 409, title: 'The customer is already anonymized' },
  entry_superseded: { status: 409, title: 'The entry already has a correction' },
  entry_is_event: { status: 409, title: 'The entry is an automatic event' },
  already_redacted: { status: 409, title: 'The entry text is already redacted' },
  procedure_already_active: { status: 409, title: 'A process with this code is already active in the work order' },
  parent_deleted: { status: 409, title: 'The process of the stage is deleted' },
  version_conflict: { status: 412, title: 'The resource was changed by someone else' },
  payload_too_large: { status: 413, title: 'Payload too large' },
  unsupported_media_type: { status: 415, title: 'Unsupported media type' },
  idempotency_mismatch: { status: 422, title: 'Idempotency key reused with a different request' },
  limit_exceeded: { status: 422, title: 'A limit of the number of objects was exceeded' },
  template_unavailable: { status: 422, title: 'Work order template is not available' },
  upload_incomplete: { status: 422, title: 'The uploaded parts do not make up the declared file' },
  transition_condition_not_met: { status: 422, title: 'A condition of the transition is not met' },
  client_version_unsupported: { status: 426, title: 'Client version is no longer supported' },
  precondition_required: { status: 428, title: 'Precondition required' },
  rate_limited: { status: 429, title: 'Too many requests' },
  internal_error: { status: 500, title: 'Internal server error' },
  service_unavailable: { status: 503, title: 'Service unavailable' },
  media_storage_unavailable: { status: 503, title: 'Media storage is unavailable' },
  deletion_register_unavailable: { status: 503, title: 'The deletion register is unavailable' },
});

export type ProblemCode = keyof typeof PROBLEMS;

export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

export interface FieldError {
  /** JSON Pointer (RFC 6901) of the offending field. */
  readonly pointer: string;
  /** Stable machine code, e.g. `too_short`. */
  readonly code: string;
}

export interface ProblemExtras {
  readonly errors?: readonly FieldError[];
  /** Sent as the Retry-After header (429, 503, 409 idempotency_in_progress). */
  readonly retryAfterSeconds?: number;
  /** Only `email_conflict` (EVM-024): the id of the existing account that is visible in the list of users — never an address or a name. */
  readonly existingUserId?: string;
  /** Only `has_active_dependents` of a customer (EVM-041): the NUMBER of its open work orders - never a number, a title or an id of an order. */
  readonly openWorkOrders?: number;
  /** Only `client_version_unsupported` (EVM-090): the oldest version of each platform the API serves. */
  readonly minSupportedVersion?: { readonly android: string; readonly ios: string };
}

/** Thrown by handlers and guards to answer with a problem of the given code. */
export class ProblemException extends Error {
  readonly code: ProblemCode;
  readonly extras: ProblemExtras;

  constructor(code: ProblemCode, extras: ProblemExtras = {}) {
    super(code);
    this.name = 'ProblemException';
    this.code = code;
    this.extras = extras;
  }
}

export interface ProblemBody {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: ProblemCode;
  readonly traceId: string;
  readonly errors?: readonly FieldError[];
  readonly existingUserId?: string;
  readonly openWorkOrders?: number;
  readonly minSupportedVersion?: { readonly android: string; readonly ios: string };
}

export function problemBody(
  code: ProblemCode,
  traceId: string,
  errors?: readonly FieldError[],
  existingUserId?: string,
  openWorkOrders?: number,
  minSupportedVersion?: ProblemExtras['minSupportedVersion'],
): ProblemBody {
  const { status, title } = PROBLEMS[code];
  return {
    type: `/problems/${code}`,
    title,
    status,
    code,
    traceId,
    ...(errors === undefined ? {} : { errors }),
    ...(existingUserId === undefined ? {} : { existingUserId }),
    ...(openWorkOrders === undefined ? {} : { openWorkOrders }),
    ...(minSupportedVersion === undefined ? {} : { minSupportedVersion }),
  };
}

export function sendProblem(response: Response, code: ProblemCode, traceId: string, extras: ProblemExtras = {}): void {
  const body = problemBody(code, traceId, extras.errors, extras.existingUserId, extras.openWorkOrders, extras.minSupportedVersion);
  if (extras.retryAfterSeconds !== undefined) response.set('Retry-After', String(extras.retryAfterSeconds));
  response.status(body.status).set('Content-Type', PROBLEM_CONTENT_TYPE).send(JSON.stringify(body));
}

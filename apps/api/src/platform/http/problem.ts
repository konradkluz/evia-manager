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
  passkey_verification_failed: { status: 400, title: 'Passkey verification failed' },
  unauthenticated: { status: 401, title: 'Authentication required' },
  invalid_credentials: { status: 401, title: 'Invalid email or password' },
  passkey_failed: { status: 401, title: 'Passkey sign-in failed' },
  login_expired: { status: 401, title: 'Sign-in took too long' },
  session_expired: { status: 401, title: 'Session expired' },
  session_revoked: { status: 401, title: 'Session revoked' },
  forbidden: { status: 403, title: 'Forbidden' },
  mfa_enrollment_required: { status: 403, title: 'Multi-factor enrollment required' },
  step_up_required: { status: 403, title: 'Re-authentication required' },
  csrf_failed: { status: 403, title: 'Cross-site request check failed' },
  not_found: { status: 404, title: 'Not found' },
  method_not_allowed: { status: 405, title: 'Method not allowed' },
  id_conflict: { status: 409, title: 'Identifier already in use' },
  idempotency_in_progress: { status: 409, title: 'A request with this idempotency key is in progress' },
  invalid_state_transition: { status: 409, title: 'Transition is not allowed from the current state' },
  version_conflict: { status: 412, title: 'The resource was changed by someone else' },
  payload_too_large: { status: 413, title: 'Payload too large' },
  unsupported_media_type: { status: 415, title: 'Unsupported media type' },
  idempotency_mismatch: { status: 422, title: 'Idempotency key reused with a different request' },
  template_unavailable: { status: 422, title: 'Work order template is not available' },
  transition_condition_not_met: { status: 422, title: 'A condition of the transition is not met' },
  precondition_required: { status: 428, title: 'Precondition required' },
  rate_limited: { status: 429, title: 'Too many requests' },
  internal_error: { status: 500, title: 'Internal server error' },
  service_unavailable: { status: 503, title: 'Service unavailable' },
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
}

export function problemBody(code: ProblemCode, traceId: string, errors?: readonly FieldError[]): ProblemBody {
  const { status, title } = PROBLEMS[code];
  return { type: `/problems/${code}`, title, status, code, traceId, ...(errors === undefined ? {} : { errors }) };
}

export function sendProblem(response: Response, code: ProblemCode, traceId: string, extras: ProblemExtras = {}): void {
  const body = problemBody(code, traceId, extras.errors);
  if (extras.retryAfterSeconds !== undefined) response.set('Retry-After', String(extras.retryAfterSeconds));
  response.status(body.status).set('Content-Type', PROBLEM_CONTENT_TYPE).send(JSON.stringify(body));
}

/**
 * RFC 9457 problem details (api-guidelines.md → Format błędów; SR-API-01). Fixed English titles per code, a relative
 * `type` (/problems/{code}) until the API domain exists (EVM-007), the trace identifier — never details, values,
 * stack traces or class names.
 */
import type { Response } from 'express';

export const PROBLEMS = Object.freeze({
  malformed_json: { status: 400, title: 'Malformed request body' },
  unauthenticated: { status: 401, title: 'Authentication required' },
  forbidden: { status: 403, title: 'Forbidden' },
  not_found: { status: 404, title: 'Not found' },
  payload_too_large: { status: 413, title: 'Payload too large' },
  unsupported_media_type: { status: 415, title: 'Unsupported media type' },
  internal_error: { status: 500, title: 'Internal server error' },
  service_unavailable: { status: 503, title: 'Service unavailable' },
});

export type ProblemCode = keyof typeof PROBLEMS;

export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

/** Thrown by handlers and guards to answer with a problem of the given code. */
export class ProblemException extends Error {
  readonly code: ProblemCode;

  constructor(code: ProblemCode) {
    super(code);
    this.name = 'ProblemException';
    this.code = code;
  }
}

export interface ProblemBody {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: ProblemCode;
  readonly traceId: string;
}

export function problemBody(code: ProblemCode, traceId: string): ProblemBody {
  const { status, title } = PROBLEMS[code];
  return { type: `/problems/${code}`, title, status, code, traceId };
}

export function sendProblem(response: Response, code: ProblemCode, traceId: string): void {
  const body = problemBody(code, traceId);
  response.status(body.status).set('Content-Type', PROBLEM_CONTENT_TYPE).send(JSON.stringify(body));
}

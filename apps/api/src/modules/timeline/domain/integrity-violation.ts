/**
 * A constraint of the database that refused a row the use case did not expect to be refused (EVM-037 K9; SR-API-01, ASVS V16.5.1):
 * the pre-checks of the use case answer the usual cases, and this is the last line — a race, or a row (a correction that was soft
 * deleted) that the pre-check does not see but the UNIQUE key of the database does. The answer is a MAPPED `409` of the catalogue,
 * never a `500` that names a constraint. The same last line maps a wait for a lock that ran out (the statement timeout `57014`, `55P03`:
 * a redaction holds the row while the register of deletions answers, up to about five seconds, and the statement timeout is two - RR-NOC-T2-4) to
 * `503 service_unavailable` with `Retry-After`: nothing was changed, the retry is safe. Any other error is passed on untouched.
 * Pure; no database.
 */
import { ProblemException, type ProblemCode } from '../../../platform/http/problem.ts';

/** SQLSTATE class 23 — integrity constraint violation. */
const INTEGRITY_VIOLATION = /^23[0-9A-Z]{3}$/;

/** SQLSTATE of a statement cancelled by the timeout and of a lock that could not be taken. */
const LOCK_WAIT_RAN_OUT = new Set(['57014', '55P03']);
const RETRY_AFTER_SECONDS = 2;

/** The constraint of the one correction per entry (migration 0020). */
export const SUPERSEDES_KEY = 'timeline_entries_supersedes_key';

/** @returns the code of the answer for a violation of a constraint, or `undefined` when the error is of another kind */
export function problemOfIntegrityViolation(error: unknown): ProblemCode | undefined {
  if (typeof error !== 'object' || error === null || error instanceof ProblemException) return undefined;
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  if (typeof code !== 'string' || !INTEGRITY_VIOLATION.test(code)) return undefined;
  return constraint === SUPERSEDES_KEY ? 'entry_superseded' : 'invalid_state_transition';
}

/** For `promise.catch(…)`: throws the mapped problem for a violation of a constraint and the original error for anything else. */
export function rethrowMapped(error: unknown): never {
  const code = problemOfIntegrityViolation(error);
  if (code !== undefined) throw new ProblemException(code);
  const sqlState = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (typeof sqlState === 'string' && LOCK_WAIT_RAN_OUT.has(sqlState)) {
    throw new ProblemException('service_unavailable', { retryAfterSeconds: RETRY_AFTER_SECONDS });
  }
  throw error;
}

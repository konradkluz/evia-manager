/**
 * A constraint of the database that refused a row the use case did not expect to be refused (EVM-037 K9; SR-API-01, ASVS V16.5.1):
 * the pre-checks of the use case answer the usual cases, and this is the last line — a race, or a row (a correction that was soft
 * deleted) that the pre-check does not see but the UNIQUE key of the database does. The answer is a MAPPED `409` of the catalogue,
 * never a `500` that names a constraint. An error that is not a violation of a constraint is passed on untouched.
 * Pure; no database.
 */
import { ProblemException, type ProblemCode } from '../../../platform/http/problem.ts';

/** SQLSTATE class 23 — integrity constraint violation. */
const INTEGRITY_VIOLATION = /^23[0-9A-Z]{3}$/;

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
  if (code === undefined) throw error;
  throw new ProblemException(code);
}

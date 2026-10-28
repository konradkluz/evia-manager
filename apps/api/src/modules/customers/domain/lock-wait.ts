/**
 * A wait for the lock of a customer that ran out (EVM-041; RR-NOC-T2-4): an anonymization holds the row while the register of deletions
 * answers (up to about five seconds), and the statement timeout is two. The statement that waited is cancelled (`57014`, or `55P03`
 * when the lock could not be taken) and the answer is `503 service_unavailable` with `Retry-After`: nothing was changed, so the retry is
 * safe. Any other error is passed on untouched. Pure; no database.
 */
import { ProblemException } from '../../../platform/http/problem.ts';

/** SQLSTATE of a statement cancelled by the timeout and of a lock that could not be taken. */
const LOCK_WAIT_RAN_OUT = new Set(['57014', '55P03']);
const RETRY_AFTER_SECONDS = 2;

/** For `promise.catch(...)`: throws `503 service_unavailable` for a lock wait that ran out and the original error for anything else. */
export function rethrowLockWait(error: unknown): never {
  const sqlState = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (typeof sqlState === 'string' && LOCK_WAIT_RAN_OUT.has(sqlState)) {
    throw new ProblemException('service_unavailable', { retryAfterSeconds: RETRY_AFTER_SECONDS });
  }
  throw error;
}

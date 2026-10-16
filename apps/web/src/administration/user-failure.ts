import { ApiError } from '../api/client.ts';
import { retryMinutes } from '../pages/login-failure.tsx';
import { StepUpCancelled } from './use-guarded-call.ts';

/** Why an operation on an account did not go through, as the dialog tells it (the answers carry no values — SR-ERR-02). */
export type UserFailure =
  | { readonly kind: 'fields' | 'network' | 'inProgress' | 'forbidden' | 'gone' | 'notInvited' | 'notConfirmed' }
  /** `409 email_conflict`: `existingUserId` is the account of the list that holds the address (absent: a deleted account). */
  | { readonly kind: 'conflict'; readonly existingUserId: string | undefined }
  | { readonly kind: 'rate'; readonly minutes: number }
  | { readonly kind: 'server'; readonly code: string };

/**
 * Maps the error of an invitation or of a resend: no answer or 5xx is a failure of the network (the retry keeps the `id` and the
 * key, so nothing is done twice); `400` with fields points at the fields; `409` says who holds the address, that the request is in
 * progress or that the account no longer waits for activation; `404` that the account is gone; a refused identifier or key is
 * repaired by a fresh attempt.
 */
export function describeUserFailure(error: unknown, hasFieldErrors: boolean): UserFailure {
  if (error instanceof StepUpCancelled) return { kind: 'notConfirmed' };
  if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) return { kind: 'network' };
  if (error.status === 400 && hasFieldErrors) return { kind: 'fields' };
  if (error.status === 403) return { kind: 'forbidden' };
  if (error.status === 404) return { kind: 'gone' };
  if (error.status === 409) {
    if (error.code === 'email_conflict') return { kind: 'conflict', existingUserId: error.existingUserId };
    if (error.code === 'idempotency_in_progress') return { kind: 'inProgress' };
    if (error.code === 'invalid_state_transition') return { kind: 'notInvited' };
    if (error.code === 'id_conflict' || error.code === 'idempotency_mismatch') return { kind: 'network' };
  }
  if (error.status === 429) return { kind: 'rate', minutes: retryMinutes(error) };
  return { kind: 'server', code: error.traceId?.slice(0, 8) ?? error.code };
}

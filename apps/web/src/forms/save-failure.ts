import { ApiError } from '../api/client.ts';

/** Why a save did not go through, as the form tells the person (the texts are in the form: they name the object). */
export type SaveFailure =
  | { readonly kind: 'fields' | 'network' | 'inProgress' | 'forbidden' }
  | { readonly kind: 'rate'; readonly seconds: number }
  | { readonly kind: 'server'; readonly code: string };

/**
 * Maps an error of a create call (`createSite`, `createParty`) to a failure: no answer or a 5xx is a failure of the network (the
 * retry keeps the `id` and the key, so nothing is saved twice); `400` with fields points at the fields; `409
 * idempotency_in_progress` asks to wait; `403` and `429` say so; a refused identifier or key is repaired by a fresh attempt.
 */
export function describeFailure(error: unknown, hasFieldErrors: boolean): SaveFailure {
  if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) return { kind: 'network' };
  if (error.status === 400 && hasFieldErrors) return { kind: 'fields' };
  if (error.status === 403) return { kind: 'forbidden' };
  if (error.status === 409 && error.code === 'idempotency_in_progress') return { kind: 'inProgress' };
  if (error.status === 429) return { kind: 'rate', seconds: error.retryAfterSeconds ?? 60 };
  if (error.code === 'id_conflict' || error.code === 'idempotency_mismatch') return { kind: 'network' };
  return { kind: 'server', code: error.traceId?.slice(0, 8) ?? error.code };
}

/** A refused identifier or key must not be sent again: the next try names the request anew. */
export const refusesAttempt = (error: unknown): boolean =>
  error instanceof ApiError && (error.code === 'id_conflict' || error.code === 'idempotency_mismatch');

import { ApiError } from '../api/client.ts';

/**
 * Why deleting or restoring a whole order (EVM-060) did not go through. The answers carry no state of the order and no instalment
 * (no count, no amount, no identifier — SR-AUTHZ-10, ASVS V16.5.1), so each kind is told in words and the panel adds nothing:
 * `dependents` (`409 has_active_dependents`: an invoiced instalment), `stepUp` (`403 step_up_required`: a paid instalment), `forbidden`
 * (`403`), `conflict` (`412`: the order changed meanwhile), `gone` (`404`: not an order of this person any more — the same answer for a
 * missing, a restored and a forbidden one), `inProgress` (`409 idempotency_in_progress`), `rate` (`429`), `network` and `server`.
 */
export type OrderDeletionFailure =
  | { readonly kind: 'dependents' | 'stepUp' | 'forbidden' | 'conflict' | 'gone' | 'inProgress' | 'network' }
  | { readonly kind: 'rate'; readonly seconds: number }
  | { readonly kind: 'server'; readonly code: string };

export function describeDeletionFailure(error: unknown): OrderDeletionFailure {
  if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) return { kind: 'network' };
  switch (error.status) {
    case 403:
      return { kind: error.code === 'step_up_required' ? 'stepUp' : 'forbidden' };
    case 404:
      return { kind: 'gone' };
    case 409:
      if (error.code === 'has_active_dependents') return { kind: 'dependents' };
      if (error.code === 'idempotency_in_progress') return { kind: 'inProgress' };
      break;
    case 412:
      return { kind: 'conflict' };
    case 429:
      return { kind: 'rate', seconds: error.retryAfterSeconds ?? 60 };
  }
  // A refused key is repaired by a fresh attempt (the caller forgets the old one); anything else is shown with the trace.
  if (error.code === 'idempotency_mismatch') return { kind: 'network' };
  return { kind: 'server', code: error.traceId?.slice(0, 8) ?? error.code };
}

/** The `If-Match` of a version the panel holds (strong ETag, `"<version>"`). */
export const etagOfVersion = (version: number): string => `"${String(version)}"`;

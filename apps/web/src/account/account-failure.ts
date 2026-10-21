import { ApiError } from '../api/client.ts';
import { retryMinutes } from '../pages/login-failure.tsx';
import { ReauthenticationCancelled } from './use-reauth-call.ts';

/** Why an operation of the own account did not go through, as the dialog or the card tells it (the answers carry no values — SR-ERR-02). */
export type AccountFailure =
  | {
      readonly kind:
        | 'network'
        | 'cancelled'
        | 'ended'
        | 'forbidden'
        | 'notFound'
        | 'currentSession'
        | 'configured'
        | 'unavailable'
        | 'reauthenticationExpired';
    }
  | { readonly kind: 'lastMethod'; readonly required: 'passkey' | 'method' }
  | { readonly kind: 'rate'; readonly minutes: number }
  | { readonly kind: 'server'; readonly code: string };

/**
 * Maps the error of an operation of the account (EVM-028 AC3, AC4, AC8): `409 last_second_step_method` with the thing to add first
 * (`passkey_required` for an Administrator's last key, `method_required` for any other last method), `404` as an object that is
 * not (or no longer) there — a stranger's and a missing one look the same —, `409 current_session`, `429` with the time from
 * `Retry-After`; no answer is a failure of the network and `503` the secret of the code of the app that is not available; The unknown is never shown raw — only a trace code to report.
 */
export function describeAccountFailure(error: unknown): AccountFailure {
  if (error instanceof ReauthenticationCancelled) return { kind: 'cancelled' };
  if (!(error instanceof ApiError) || error.status === 0) return { kind: 'network' };
  if (error.status === 503) return { kind: 'unavailable' };
  switch (error.status) {
    case 401:
      return { kind: 'ended' };
    case 403:
      return error.code === 'reauthentication_required' ? { kind: 'reauthenticationExpired' } : { kind: 'forbidden' };
    case 404:
      return { kind: 'notFound' };
    case 429:
      return { kind: 'rate', minutes: retryMinutes(error) };
    case 409:
      switch (error.code) {
        case 'last_second_step_method':
          return { kind: 'lastMethod', required: error.errors[0]?.code === 'passkey_required' ? 'passkey' : 'method' };
        case 'current_session':
          return { kind: 'currentSession' };
        case 'mfa_already_configured':
          return { kind: 'configured' };
        default:
          return { kind: 'server', code: error.traceId?.slice(0, 8) ?? error.code };
      }
    default:
      return { kind: 'server', code: error.traceId?.slice(0, 8) ?? error.code };
  }
}

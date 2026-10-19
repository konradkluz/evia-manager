import { ApiError } from '../api/client.ts';
import { retryMinutes } from '../pages/login-failure.tsx';
import { StepUpCancelled } from './use-guarded-call.ts';

/** Why an operation on an account did not go through, as the dialog tells it (the answers carry no values — SR-ERR-02). */
export type AccountFailure =
  | {
      readonly kind:
        | 'network'
        | 'forbidden'
        | 'gone'
        | 'notConfirmed'
        | 'fields'
        | 'lastAdministrator'
        | 'ownAccount'
        | 'passkeyRequired'
        | 'stateChanged'
        | 'versionConflict'
        | 'ended';
    }
  | { readonly kind: 'rate'; readonly minutes: number }
  | { readonly kind: 'server'; readonly code: string };

/**
 * Maps the error of an operation on an account (EVM-027 AC5, AC8): `409` by its code (the last active Administrator, the own
 * account, an Administrator without a passkey, a state that no longer fits), `412`/`428` as a version that moved on, `404` as a
 * missing account, `401` as an ended session of the person who acts; no answer or a 5xx is a failure of the network. The
 * unknown is never shown raw — only a trace code to report.
 */
export function describeAccountFailure(error: unknown): AccountFailure {
  if (error instanceof StepUpCancelled) return { kind: 'notConfirmed' };
  if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) return { kind: 'network' };
  switch (error.status) {
    case 400:
      return { kind: 'fields' };
    case 401:
      return { kind: 'ended' };
    case 403:
      return { kind: 'forbidden' };
    case 404:
      return { kind: 'gone' };
    case 412:
    case 428:
      return { kind: 'versionConflict' };
    case 429:
      return { kind: 'rate', minutes: retryMinutes(error) };
    case 409:
      switch (error.code) {
        case 'last_active_administrator':
          return { kind: 'lastAdministrator' };
        case 'own_account_not_allowed':
          return { kind: 'ownAccount' };
        case 'administrator_passkey_required':
          return { kind: 'passkeyRequired' };
        case 'invalid_state_transition':
          return { kind: 'stateChanged' };
        default:
          return { kind: 'server', code: error.traceId?.slice(0, 8) ?? error.code };
      }
    default:
      return { kind: 'server', code: error.traceId?.slice(0, 8) ?? error.code };
  }
}

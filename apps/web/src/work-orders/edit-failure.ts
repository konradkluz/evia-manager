import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client.ts';
import { describeFailure } from '../forms/save-failure.ts';

/**
 * Why an edit of the data or of the scope of an order did not go through (EVM-035 AC1, AC5, AC6, AC8), as a dialog tells the person.
 * `412` is the conflict (the typed data stays), `409 work_order_closed` the closed order, `404` a gone order or item (also the item of
 * another order — the API says the same), `422 limit_exceeded` a limit of the scope. Nothing carries a value: the answers do not.
 */
export type EditFailure =
  | { readonly kind: 'conflict' | 'closed' | 'gone' | 'forbidden' | 'network' | 'inProgress' | 'limit' | 'proceduresLimit' | 'invalid' }
  | { readonly kind: 'rate'; readonly seconds: number }
  | { readonly kind: 'server'; readonly code: string };

export function classifyEdit(error: unknown): EditFailure {
  if (error instanceof ApiError) {
    if (error.status === 412) return { kind: 'conflict' };
    if (error.status === 409 && error.code === 'work_order_closed') return { kind: 'closed' };
    if (error.status === 404) return { kind: 'gone' };
    if (error.status === 422 && error.code === 'limit_exceeded') {
      return { kind: error.errors.some((entry) => entry.code === 'too_many_scope_items') ? 'limit' : 'proceduresLimit' };
    }
    if (error.status === 400) return { kind: 'invalid' };
  }
  const generic = describeFailure(error, false);
  switch (generic.kind) {
    case 'forbidden':
    case 'inProgress':
    case 'network':
      return { kind: generic.kind };
    case 'rate':
      return { kind: 'rate', seconds: generic.seconds };
    case 'server':
      return { kind: 'server', code: generic.code };
    case 'fields':
      return { kind: 'invalid' };
  }
}

/** A closed order is `settled` or `cancelled`: the word that names it in a sentence comes from the i18n catalogue. */
export const closedStateOf = (status: string): 'settled' | 'cancelled' => (status === 'cancelled' ? 'cancelled' : 'settled');

/** The word for the state of a closed order ("rozliczone", "anulowane") for the hints and the alerts of the dialogs. */
export function useStateWord(): (status: string) => string {
  const { t } = useTranslation();
  return (status) => (closedStateOf(status) === 'cancelled' ? t('workOrder.scope.stateCancelled') : t('workOrder.scope.stateSettled'));
}

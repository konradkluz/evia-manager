import { transitionWorkOrder, type TransitionWorkOrderRequest, type WorkOrderDetails } from '@evia/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { useAttempt } from '../forms/attempt.ts';
import { refusesAttempt } from '../forms/save-failure.ts';
import { useStepUp } from '../session/step-up-context.tsx';
import { WORK_ORDER_HEADER_KEY, WORK_ORDER_JOURNAL_KEY, WORK_ORDERS_KEY } from './query-keys.ts';

/** Why a transition of a survey did not go through (flows/17 → the dialogs "Odrzuć wizję" and "Przywróć wizję"). */
export type SurveyFailure =
  | 'conflict'
  | 'forbidden'
  | 'stepUp'
  | 'reason'
  | 'network'
  | { readonly kind: 'rate'; readonly seconds: number }
  | { readonly kind: 'server'; readonly code: string };

/**
 * `412 version_conflict` and `409 invalid_state_transition` both say the survey is not what the person saw; `403 step_up_required` that the
 * window of the re-authentication is closed; `400` on `/reasonCode` that the reason was not accepted (`required`, `invalid_value`,
 * `not_allowed`); no answer or a 5xx is "network" (the retry keeps the key, so nothing is done twice).
 */
export function describeSurveyFailure(error: unknown): SurveyFailure {
  if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) return 'network';
  if (error.status === 412 || (error.status === 409 && error.code === 'invalid_state_transition')) return 'conflict';
  if (error.status === 403) return error.code === 'step_up_required' ? 'stepUp' : 'forbidden';
  if (error.status === 400 && error.errors.some((entry) => entry.pointer === '/reasonCode')) return 'reason';
  if (error.status === 429) return { kind: 'rate', seconds: error.retryAfterSeconds ?? 60 };
  if (error.code === 'idempotency_mismatch' || error.code === 'idempotency_in_progress') return 'network';
  return { kind: 'server', code: error.traceId?.slice(0, 8) ?? error.code };
}

/**
 * One transition of a site survey (`POST …/transitions`, EVM-138 AC5): "Odrzuć wizję" (`cancelled` with `reasonCode`) and "Przywróć wizję"
 * (`on_hold`; the Administrator, with the step-up: `403 step_up_required` opens W-04 once and the same request is sent again, no loop).
 * Every request carries `If-Match` of the version on screen and an `Idempotency-Key` that is the same for a retry of the same content.
 * Returns the order as the server answered (it is also put in the cache of the header) or `null` when it did not go through.
 */
export function useSurveyTransition(order: WorkOrderDetails) {
  const client = useApi();
  const queryClient = useQueryClient();
  const requestStepUp = useStepUp();
  const attempt = useAttempt();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<SurveyFailure | null>(null);

  const send = (body: TransitionWorkOrderRequest): Promise<WorkOrderDetails> => {
    const { key } = attempt.next(`${order.id}|${String(order.version)}|${JSON.stringify(body)}`);
    return unwrap(
      transitionWorkOrder({
        client,
        path: { workOrderId: order.id },
        headers: { 'If-Match': `"${String(order.version)}"`, 'Idempotency-Key': key },
        body,
      }),
    );
  };

  const run = async (body: TransitionWorkOrderRequest, stepUpTitle?: string): Promise<WorkOrderDetails | null> => {
    setPending(true);
    setFailure(null);
    try {
      let result: WorkOrderDetails;
      try {
        result = await send(body);
      } catch (error) {
        if (stepUpTitle === undefined || describeSurveyFailure(error) !== 'stepUp') throw error;
        if (!(await requestStepUp(stepUpTitle))) throw error;
        result = await send(body);
      }
      attempt.forget();
      queryClient.setQueryData([WORK_ORDER_HEADER_KEY, order.id], result);
      void queryClient.invalidateQueries({ queryKey: [WORK_ORDERS_KEY] });
      // The change wrote an event of the journal; an open "Dziennik" shows it without a reload.
      void queryClient.invalidateQueries({ queryKey: [WORK_ORDER_JOURNAL_KEY, order.id] });
      return result;
    } catch (error) {
      if (refusesAttempt(error)) attempt.forget();
      const described = describeSurveyFailure(error);
      if (described === 'conflict') void queryClient.refetchQueries({ queryKey: [WORK_ORDER_HEADER_KEY, order.id] });
      setFailure(described);
      return null;
    } finally {
      setPending(false);
    }
  };

  /** "Odśwież zlecenie": the order is read again (the next request carries the new version and a new key). */
  const refresh = () => {
    setFailure(null);
    void queryClient.refetchQueries({ queryKey: [WORK_ORDER_HEADER_KEY, order.id] });
  };

  return { run, pending, failure, refresh };
}

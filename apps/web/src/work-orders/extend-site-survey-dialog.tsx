import { extendSiteSurvey, type SiteSurveyExtensionReason, type WorkOrderDetails } from '@evia/contracts';
import { AlertDialog, Button, InlineAlert, RadioGroup } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState } from 'react';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { useAttempt } from '../forms/attempt.ts';
import { refusesAttempt } from '../forms/save-failure.ts';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { HintedButton } from './hinted-button.tsx';
import { WORK_ORDER_HEADER_KEY, WORK_ORDER_JOURNAL_KEY, WORK_ORDERS_KEY } from './query-keys.ts';
import { extendText, surveyText } from './site-survey-labels.ts';
import { expiryDate, extendedExpiryDate, SURVEY_EXTENSIONS_MAX } from './site-survey.ts';

type Reason = '' | SiteSurveyExtensionReason;

type Failure =
  | 'conflict'
  | 'limit'
  | 'unavailable'
  | 'orderGone'
  | 'forbidden'
  | 'network'
  | { readonly kind: 'rate'; readonly seconds: number }
  | { readonly kind: 'server'; readonly code: string };

const REASONS = ['awaiting_client_decision', 'awaiting_community_decision', 'second_visit_needed'] as const;

/**
 * `412 version_conflict` — the order changed; `409 extension_limit_reached` — twice already; `409 invalid_state_transition` — the survey is
 * rejected or has a customer now; `404` — the order is gone; no answer or a 5xx — "network" (the retry keeps the key, so nothing is done twice).
 */
export function describeExtendFailure(error: unknown): Failure {
  if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) return 'network';
  if (error.status === 412) return 'conflict';
  if (error.status === 409 && error.code === 'extension_limit_reached') return 'limit';
  if (error.status === 409 && error.code === 'invalid_state_transition') return 'unavailable';
  if (error.status === 404) return 'orderGone';
  if (error.status === 403) return 'forbidden';
  if (error.status === 400) return 'network';
  if (error.status === 429) return { kind: 'rate', seconds: error.retryAfterSeconds ?? 60 };
  if (error.code === 'idempotency_mismatch' || error.code === 'idempotency_in_progress') return 'network';
  return { kind: 'server', code: error.traceId?.slice(0, 8) ?? error.code };
}

/**
 * "Przedłuż o 90 dni" (EVM-140 AC6; flows/17): Administrator and Editor, a reason from the closed list of three (none preselected — a conscious
 * decision; "Wybierz powód przedłużenia." when none is chosen). `POST …/site-survey/extensions` with `{reason, version}` and an `Idempotency-Key`
 * that is the same for a retry of the same content. The answer replaces the header (the banner shows the new deadline and the count), the list and
 * the journal are read again; the page puts the focus on the title of the banner. The data of the dialog stays after every failure.
 */
export function ExtendSiteSurveyDialog({
  order,
  onClose,
  onDone,
}: {
  readonly order: WorkOrderDetails;
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const client = useApi();
  const online = useOnline();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const attempt = useAttempt();
  const [reason, setReason] = useState<Reason>('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<Failure | null>(null);
  const group = useRef<HTMLDivElement>(null);
  const survey = order.siteSurvey;
  const count = survey?.extensionCount ?? 0;

  // The dialog focuses the element marked `data-initial-focus` when it opens: the first reason (a group of radios is not a button).
  useLayoutEffect(() => {
    group.current?.querySelector('input[type="radio"]')?.setAttribute('data-initial-focus', '');
  }, []);

  const mutation = useMutation({
    mutationFn: (request: { readonly reason: SiteSurveyExtensionReason; readonly version: number; readonly key: string }) =>
      unwrap(
        extendSiteSurvey({
          client,
          path: { workOrderId: order.id },
          headers: { 'Idempotency-Key': request.key },
          body: { reason: request.reason, version: request.version },
        }),
      ),
    // Here, not in `mutate(…)`: these run also when the dialog was closed while the request was in flight.
    onSuccess: (result) => {
      attempt.forget();
      queryClient.setQueryData([WORK_ORDER_HEADER_KEY, order.id], result);
      void queryClient.invalidateQueries({ queryKey: [WORK_ORDERS_KEY] });
      // The write of the journal ("Przedłużono wizję lokalną") is shown by an open "Dziennik" without a reload.
      void queryClient.invalidateQueries({ queryKey: [WORK_ORDER_JOURNAL_KEY, order.id] });
      showToast(result.siteSurvey === null ? extendText.extendedNoDate : extendText.extended(expiryDate(result.siteSurvey.expiresAt)));
      onDone();
    },
  });

  const submit = () => {
    if (reason === '') {
      setError(extendText.reasonRequired);
      group.current?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus();
      return;
    }
    const { key } = attempt.next(`${order.id}|${String(order.version)}|${reason}`);
    setFailure(null);
    mutation.mutate(
      { reason, version: order.version, key },
      {
        onError: (problem) => {
          if (refusesAttempt(problem)) attempt.forget();
          const described = describeExtendFailure(problem);
          if (described === 'conflict' || described === 'limit' || described === 'unavailable' || described === 'orderGone') {
            // The survey is not what the person saw: the header is read again (a missing order the page then names itself).
            void queryClient.refetchQueries({ queryKey: [WORK_ORDER_HEADER_KEY, order.id] });
          }
          if (described === 'orderGone') {
            onClose();
            return;
          }
          setFailure(described);
        },
      },
    );
  };

  const refresh = () => {
    setFailure(null);
    void queryClient.refetchQueries({ queryKey: [WORK_ORDER_HEADER_KEY, order.id] });
  };

  const failureText = (current: Failure): string => {
    if (typeof current === 'object') {
      return current.kind === 'rate' ? extendText.failure.rate(current.seconds) : extendText.failure.server(current.code);
    }
    return {
      conflict: extendText.failure.conflict,
      limit: extendText.failure.limit,
      unavailable: extendText.failure.unavailable,
      orderGone: extendText.failure.network,
      forbidden: extendText.failure.forbidden,
      network: extendText.failure.network,
    }[current];
  };

  const action =
    failure === 'conflict' ? (
      <Button variant="secondary" onClick={refresh}>
        {extendText.failure.refresh}
      </Button>
    ) : failure === 'network' || (typeof failure === 'object' && failure !== null && failure.kind === 'server') ? (
      <Button variant="secondary" onClick={submit}>
        {extendText.failure.retry}
      </Button>
    ) : undefined;

  return (
    <AlertDialog
      open
      title={extendText.title}
      onDismiss={onClose}
      actions={
        <>
          <Button variant="tertiary" onClick={onClose}>
            {extendText.cancel}
          </Button>
          <HintedButton
            loading={mutation.isPending}
            hint={online ? undefined : surveyText.offlineExtend}
            onClick={() => {
              submit();
            }}
          >
            {extendText.confirm}
          </HintedButton>
        </>
      }
    >
      {survey === null ? null : (
        <>
          <p>{extendText.dates(expiryDate(survey.expiresAt), extendedExpiryDate(survey.expiresAt))}</p>
          <p>{count + 1 >= SURVEY_EXTENSIONS_MAX ? extendText.last : extendText.nth(count + 1)}</p>
        </>
      )}
      <div ref={group}>
        <RadioGroup
          legend={extendText.reasonLegend}
          value={reason}
          onChange={(value) => {
            setReason(REASONS.find((known) => known === value) ?? '');
            setError(undefined);
          }}
          options={REASONS.map((value) => ({ value, label: extendText.reasons[value] }))}
          {...(error === undefined ? {} : { error })}
        />
      </div>
      {failure === null ? null : (
        <InlineAlert tone="error" {...(action === undefined ? {} : { action })}>
          {failureText(failure)}
        </InlineAlert>
      )}
    </AlertDialog>
  );
}

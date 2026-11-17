import type { WorkOrderDetails } from '@evia/contracts';
import { AlertDialog, Button, RadioGroup } from '@evia/ui-web';
import { useLayoutEffect, useRef, useState } from 'react';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { HintedButton } from './hinted-button.tsx';
import { rejectText, surveyText } from './site-survey-labels.ts';
import { expiryDate } from './site-survey.ts';
import { SurveyFailureAlert } from './survey-failure-alert.tsx';
import { useSurveyTransition } from './use-survey-transition.ts';

type Reason = '' | 'offer_rejected' | 'customer_withdrew';

/**
 * "Odrzuć wizję" (EVM-138 AC5; flows/17): the reason is chosen from two (`offer_rejected` "Oferta odrzucona", `customer_withdrew` "Rezygnacja
 * klienta"), none is preselected — it is a conscious decision. No second confirmation (as cancelling an order): the dialog says what happens
 * ("Wizja zostanie trwale usunięta po 14 dniach"). `POST …/transitions` with `{to: "cancelled", reasonCode}`, `If-Match` and a key; the focus
 * starts on the first reason, and after the rejection the page puts it on the heading of the banner. The reason is kept in this component only.
 */
export function RejectSiteSurveyDialog({
  order,
  onClose,
  onDone,
}: {
  readonly order: WorkOrderDetails;
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const online = useOnline();
  const showToast = useToast();
  const transition = useSurveyTransition(order);
  const [reason, setReason] = useState<Reason>('');
  const [error, setError] = useState<string | undefined>(undefined);
  const group = useRef<HTMLDivElement>(null);

  // The dialog focuses the element marked `data-initial-focus` when it opens: the first reason (a group of radios is not a button).
  useLayoutEffect(() => {
    group.current?.querySelector('input[type="radio"]')?.setAttribute('data-initial-focus', '');
  }, []);

  const submit = async () => {
    if (reason === '') {
      setError(rejectText.reasonRequired);
      group.current?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus();
      return;
    }
    const result = await transition.run({ to: 'cancelled', reasonCode: reason });
    if (result === null) return;
    showToast(result.siteSurvey === null ? rejectText.rejectedNoDate : rejectText.rejected(expiryDate(result.siteSurvey.expiresAt)));
    onDone();
  };

  return (
    <AlertDialog
      open
      title={rejectText.title}
      onDismiss={onClose}
      actions={
        <>
          <Button variant="tertiary" onClick={onClose}>
            {rejectText.cancel}
          </Button>
          <HintedButton
            variant="danger"
            loading={transition.pending}
            hint={online ? undefined : surveyText.offlineReject}
            onClick={() => {
              void submit();
            }}
          >
            {rejectText.confirm}
          </HintedButton>
        </>
      }
    >
      <p>{rejectText.body}</p>
      <div ref={group}>
        <RadioGroup
          legend={rejectText.reasonLegend}
          value={reason}
          onChange={(value) => {
            setReason(value === 'offer_rejected' || value === 'customer_withdrew' ? value : '');
            setError(undefined);
          }}
          options={[
            { value: 'offer_rejected', label: rejectText.offerRejected },
            { value: 'customer_withdrew', label: rejectText.customerWithdrew },
          ]}
          {...(error === undefined ? {} : { error })}
        />
      </div>
      {transition.failure === null ? null : (
        <SurveyFailureAlert failure={transition.failure} texts={rejectText.failure} onRefresh={transition.refresh} />
      )}
    </AlertDialog>
  );
}

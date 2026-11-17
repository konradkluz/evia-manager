import type { WorkOrderDetails } from '@evia/contracts';
import { AlertDialog, Button } from '@evia/ui-web';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { HintedButton } from './hinted-button.tsx';
import { restoreText, surveyText } from './site-survey-labels.ts';
import { expiryDate } from './site-survey.ts';
import { SurveyFailureAlert } from './survey-failure-alert.tsx';
import { useSurveyTransition } from './use-survey-transition.ts';

/**
 * "Przywróć wizję" (EVM-138 AC5; flows/17): only the Administrator, with the re-authentication (W-04: `403 step_up_required` opens the
 * window once and the same request is sent again). The survey goes back to "Wstrzymane" and its deadline is set again (not shorter than 14
 * days — the server decides). The Editor does not get here: the button of the banner is disabled for him (and the API says `403` all the same).
 */
export function RestoreSiteSurveyDialog({
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

  const submit = async () => {
    const result = await transition.run({ to: 'on_hold' }, restoreText.stepUpTitle);
    if (result === null) return;
    showToast(result.siteSurvey === null ? restoreText.restoredNoDate : restoreText.restored(expiryDate(result.siteSurvey.expiresAt)));
    onDone();
  };

  return (
    <AlertDialog
      open
      title={restoreText.title}
      onDismiss={onClose}
      actions={
        <>
          <Button variant="tertiary" onClick={onClose}>
            {restoreText.cancel}
          </Button>
          <HintedButton
            loading={transition.pending}
            hint={online ? undefined : surveyText.offlineRestore}
            onClick={() => {
              void submit();
            }}
          >
            {restoreText.confirm}
          </HintedButton>
        </>
      }
    >
      <p>{restoreText.body}</p>
      {transition.failure === null ? null : (
        <SurveyFailureAlert failure={transition.failure} texts={restoreText.failure} onRefresh={transition.refresh} />
      )}
    </AlertDialog>
  );
}

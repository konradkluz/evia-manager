import { Button, InlineAlert } from '@evia/ui-web';
import type { Ref } from 'react';
import type { SurveyFailure } from './use-survey-transition.ts';

/** The words of the failures of one dialog of a survey (the dialogs say what they could not do). */
export interface SurveyFailureTexts {
  readonly conflict: string;
  readonly refresh: string;
  readonly forbidden: string;
  readonly reason?: string;
  readonly stepUp?: string;
  readonly network: string;
  readonly server: (code: string) => string;
  readonly rate: (seconds: number) => string;
}

/**
 * The error of a dialog of a survey (`role="alert"`): the data of the dialog stays; a conflict offers "Odśwież zlecenie" (flows/17 →
 * "Stany"). The texts name no address, phone or customer.
 */
export function SurveyFailureAlert({
  failure,
  texts,
  onRefresh,
  alertRef,
}: {
  readonly failure: SurveyFailure;
  readonly texts: SurveyFailureTexts;
  readonly onRefresh: () => void;
  readonly alertRef?: Ref<HTMLDivElement>;
}) {
  const text =
    typeof failure === 'object'
      ? failure.kind === 'rate'
        ? texts.rate(failure.seconds)
        : texts.server(failure.code)
      : failure === 'conflict'
        ? texts.conflict
        : failure === 'forbidden'
          ? texts.forbidden
          : failure === 'reason'
            ? (texts.reason ?? texts.network)
            : failure === 'stepUp'
              ? (texts.stepUp ?? texts.forbidden)
              : texts.network;
  return (
    <InlineAlert
      tone="error"
      {...(alertRef === undefined ? {} : { alertRef })}
      {...(failure === 'conflict'
        ? {
            action: (
              <Button variant="secondary" onClick={onRefresh}>
                {texts.refresh}
              </Button>
            ),
          }
        : {})}
    >
      {text}
    </InlineAlert>
  );
}

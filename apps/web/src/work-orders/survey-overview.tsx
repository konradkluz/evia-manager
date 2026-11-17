import { Plus } from '@evia/ui-web';
import { useId } from 'react';
import { useSession } from '../session/session.ts';
import { HintedButton } from './hinted-button.tsx';
import { surveyText } from './site-survey-labels.ts';

/**
 * The tab "Przegląd" of a site survey (EVM-138 AC3, AC4; flows/17 → W-06): a survey has no processes, scope or instalments, so there are
 * no empty sections — one sentence, and "Płatności" as a sentence with the disabled "Dodaj transzę" (the reason is its description).
 * The panel does not read the processes, the instalments or the scope of a survey. Only Administrator and Editor see the button.
 */
export function SurveyOverview() {
  const headingId = useId();
  const role = useSession().data?.user.role;
  return (
    <div className="flex flex-col gap-stack-lg">
      <p className="text-body text-text-primary">{surveyText.overviewNoProcesses}</p>
      <section aria-labelledby={headingId} className="flex flex-col gap-stack-md">
        <h2 id={headingId} className="text-heading-3 text-text-primary">
          {surveyText.payments}
        </h2>
        {role === 'administrator' || role === 'editor' ? (
          <HintedButton variant="tertiary" icon={Plus} hint={surveyText.paymentsHint}>
            {surveyText.addMilestone}
          </HintedButton>
        ) : (
          <p className="text-body text-text-secondary">{surveyText.paymentsHint}</p>
        )}
      </section>
    </div>
  );
}

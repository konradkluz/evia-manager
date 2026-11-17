import type { SiteSurvey } from '@evia/contracts';
import { CalendarX, StatusBadge, Trash2, TriangleAlert } from '@evia/ui-web';
import { serverNow } from '../session/server-clock.ts';
import { useNow } from '../shell/use-now.ts';
import { expiryLine, expiryName, surveyText } from './site-survey-labels.ts';
import { expiryOf } from './site-survey.ts';

/** The marks next to the number: "Wizja lokalna" and, for a survey in "Anulowane", "Odrzucona" (styleguide § 4.4); the status badge stays apart. */
export function SurveyMarks({ rejected }: { readonly rejected: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-inline-xs">
      <StatusBadge group="mark" status="survey" label={surveyText.mark} />
      {rejected ? <StatusBadge group="mark" status="rejected" label={surveyText.rejected} /> : null}
    </span>
  );
}

/**
 * The deadline of a survey as text with an icon, never a colour alone (flows/17, rule 3): "Wygasa za 80 dni" (`calendar-x`,
 * `color.text.secondary`), from 15 days `triangle-alert` + `color.text.warning`, a rejected survey "Usunięcie za 9 dni" (`trash-2`).
 * The accessible name adds the full date ("wygasa za 80 dni, dnia 14.02.2027").
 */
export function ExpiryLine({ survey, rejected }: { readonly survey: SiteSurvey; readonly rejected: boolean }) {
  const now = useNow(60_000);
  const expiry = expiryOf(survey, serverNow(now));
  const Icon = rejected ? Trash2 : expiry.warning ? TriangleAlert : CalendarX;
  const warning = expiry.warning && !rejected;
  return (
    <span className={`inline-flex items-start gap-inline-xs text-body ${warning ? 'text-text-warning' : 'text-text-secondary'}`}>
      <Icon aria-hidden="true" className={`size-icon-sm shrink-0 ${warning ? 'text-icon-warning' : ''}`} />
      <span aria-hidden="true">{expiryLine(expiry, rejected)}</span>
      <span className="sr-only">{expiryName(expiry, survey.expiresAt, rejected)}</span>
    </span>
  );
}

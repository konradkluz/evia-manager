import type { WorkOrderDetails } from '@evia/contracts';
import { Banner, Info, TriangleAlert } from '@evia/ui-web';
import type { Ref } from 'react';
import { serverNow } from '../session/server-clock.ts';
import { useSession } from '../session/session.ts';
import { useNow } from '../shell/use-now.ts';
import { useOnline } from '../shell/use-online.ts';
import { HintedButton } from './hinted-button.tsx';
import { bannerBody, surveyText } from './site-survey-labels.ts';
import { expiryOf, isSurvey } from './site-survey.ts';

/**
 * The banner "Wizja lokalna — brak klienta" of W-06 (EVM-138 AC3; flows/17): the date of the deletion with the days left, and the main
 * action "Przypisz klienta" — the only primary button of the view. The tone is `info`; from 15 days or fewer `warning` with
 * `triangle-alert` and the words "wymaga decyzji" in the name of the region (colour and icon are never the only signal). A named
 * region read with the page, not an alert. Only Administrator and Editor see the actions (the server decides all the same; Tylko odczyt
 * does not see a survey at all). Offline the action is disabled with the reason.
 */
export function SiteSurveyBanner({
  order,
  onAssign,
  titleRef,
}: {
  readonly order: WorkOrderDetails;
  readonly onAssign: () => void;
  /** The title of the banner takes the focus after an operation that keeps the banner (flows/17: "fokus … na nagłówku banera"). */
  readonly titleRef?: Ref<HTMLParagraphElement>;
}) {
  const role = useSession().data?.user.role;
  const online = useOnline();
  const now = useNow(60_000);
  if (!isSurvey(order) || order.status === 'cancelled') return null;
  const expiry = expiryOf(order.siteSurvey, serverNow(now));
  const acts = role === 'administrator' || role === 'editor';
  return (
    <Banner
      icon={expiry.warning ? TriangleAlert : Info}
      tone={expiry.warning ? 'warning' : 'info'}
      label={expiry.warning ? surveyText.bannerNeedsDecision : surveyText.bannerTitle}
    >
      <p ref={titleRef} tabIndex={-1} className="text-heading-4 text-text-primary focus-visible:focus-ring">
        {surveyText.bannerTitle}
      </p>
      <p>{bannerBody(expiry, order.siteSurvey.expiresAt, order.siteSurvey.extensionCount)}</p>
      {acts ? (
        <div className="flex flex-wrap items-start gap-inline-md">
          <HintedButton hint={online ? undefined : surveyText.offlineAssign} aria-haspopup="dialog" onClick={onAssign}>
            {surveyText.assign}
          </HintedButton>
        </div>
      ) : null}
    </Banner>
  );
}

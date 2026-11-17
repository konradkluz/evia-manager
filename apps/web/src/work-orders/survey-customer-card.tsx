import type { SiteSurvey } from '@evia/contracts';
import { Card, TextLink } from '@evia/ui-web';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { formatPhone } from '../customers/format.ts';
import { telHref } from './safe-href.ts';
import { DetailRow } from './section-states.tsx';
import { surveyText } from './site-survey-labels.ts';

/**
 * The card "Klient" of a site survey (EVM-138 AC3; flows/17 → W-06 "Kolumna boczna"): "Brak klienta" as text (no button, so the name
 * "Przypisz klienta" is not repeated) and the "Telefon zamawiającego" as a `tel:` link. The phone is personal data: it is React text and an
 * `href` built from the encoded value, never in the address, the title of the tab or a key of the cache.
 */
export function SurveyCustomerCard({ survey }: { readonly survey: SiteSurvey }) {
  const { t } = useTranslation();
  const headingId = useId();
  const phone = survey.requesterPhone;
  const href = phone === null ? undefined : telHref(phone);
  return (
    <Card labelledBy={headingId}>
      <h2 id={headingId} className="text-heading-3 text-text-primary">
        {t('workOrder.customer.heading')}
      </h2>
      <p className="text-body text-text-primary">{surveyText.noCustomer}</p>
      {phone === null ? null : (
        <dl className="flex flex-col gap-stack-sm">
          <DetailRow label={surveyText.requesterPhone}>
            {href === undefined ? (
              formatPhone(phone)
            ) : (
              <TextLink href={href}>
                {formatPhone(phone)}
                <span className="sr-only">{`, ${surveyText.callRequester}`}</span>
              </TextLink>
            )}
          </DetailRow>
        </dl>
      )}
    </Card>
  );
}

import type { CustomerCard as CustomerCardData } from '@evia/contracts';
import { Card, InlineAlert, TextLink } from '@evia/ui-web';
import type { UseQueryResult } from '@tanstack/react-query';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { formatPhone } from '../customers/format.ts';
import { mailtoHref, telHref } from './safe-href.ts';
import { DetailRow, SectionError, SectionLoading } from './section-states.tsx';
import { isNotFound } from './use-work-order.ts';

/**
 * The card "Klient" of W-06 (EVM-018 AC1): the name, the telephone and the e-mail — the three fields of the contract and
 * nothing else (SR-DATA-03). The telephone and the e-mail are links built from the encoded value (`tel:`, `mailto:`), the
 * name is React text. "Przejdź do klienta" (W-14) is EVM-039 and is not shown. A card that failed says so inside itself.
 */
export function CustomerCard({ query }: { readonly query: UseQueryResult<CustomerCardData> }) {
  const { t } = useTranslation();
  const headingId = useId();
  const card = query.data;
  return (
    <Card labelledBy={headingId}>
      <h2 id={headingId} className="text-heading-3 text-text-primary">
        {t('workOrder.customer.heading')}
      </h2>
      {card !== undefined ? (
        <>
          <p className="break-words text-body text-text-primary">{card.displayName}</p>
          <dl className="flex flex-col gap-stack-sm">
            <DetailRow label={t('workOrder.customer.phone')}>{link(telHref(card.phone), formatPhone(card.phone))}</DetailRow>
            <DetailRow label={t('workOrder.customer.email')}>
              {card.email === null ? t('workOrder.customer.noEmail') : link(mailtoHref(card.email), card.email)}
            </DetailRow>
          </dl>
        </>
      ) : query.isError ? (
        isNotFound(query.error) ? (
          <InlineAlert tone="info">{t('workOrder.customer.missing')}</InlineAlert>
        ) : (
          <SectionError
            message={t('workOrder.customer.error')}
            retryLabel={t('workOrder.customer.retry')}
            onRetry={() => {
              void query.refetch();
            }}
          />
        )
      ) : (
        <SectionLoading lines={2} />
      )}
    </Card>
  );
}

const link = (href: string | undefined, text: string) => (href === undefined ? text : <TextLink href={href}>{text}</TextLink>);

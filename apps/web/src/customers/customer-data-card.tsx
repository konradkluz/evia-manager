import type { Customer } from '@evia/contracts';
import { Card, TextLink } from '@evia/ui-web';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatAddress } from '../sites/format.ts';
import { mailtoHref, telHref } from '../work-orders/safe-href.ts';
import { DetailRow } from '../work-orders/section-states.tsx';
import { formatPhone } from './format.ts';

const link = (href: string | undefined, text: string): ReactNode => (href === undefined ? text : <TextLink href={href}>{text}</TextLink>);

/**
 * The card "Dane klienta" of W-14 (EVM-039 AC2): a person — telephone, e-mail, postal address and notes; a company — also the
 * company name, the NIP and the contact person. The telephone and the e-mail are links built from the encoded value (`tel:`,
 * `mailto:`, SR-WEB-03); everything else is React text. A field the customer does not have is "—".
 */
export function CustomerDataCard({ customer }: { readonly customer: Customer }) {
  const { t } = useTranslation();
  const headingId = useId();
  const none = t('customerPage.data.none');
  const company = customer.kind === 'company';
  return (
    <Card labelledBy={headingId}>
      <h2 id={headingId} className="text-heading-3 text-text-primary">
        {t('customerPage.data.heading')}
      </h2>
      <dl className="flex flex-col gap-stack-sm">
        {company ? (
          <>
            <DetailRow label={t('customerPage.data.companyName')}>{customer.companyName ?? none}</DetailRow>
            <DetailRow label={t('customerPage.data.taxId')}>{customer.taxId ?? none}</DetailRow>
            <DetailRow label={t('customerPage.data.contactPerson')}>{customer.contactPersonName ?? none}</DetailRow>
          </>
        ) : null}
        <DetailRow label={t('customerPage.data.phone')}>{link(telHref(customer.phone), formatPhone(customer.phone))}</DetailRow>
        <DetailRow label={t('customerPage.data.email')}>
          {customer.email === undefined ? none : link(mailtoHref(customer.email), customer.email)}
        </DetailRow>
        <DetailRow label={t('customerPage.data.address')}>
          {customer.postalAddress === undefined ? none : formatAddress(customer.postalAddress)}
        </DetailRow>
        <DetailRow label={t('customerPage.data.notes')}>
          <span className="whitespace-pre-line">{customer.notes ?? none}</span>
        </DetailRow>
      </dl>
    </Card>
  );
}

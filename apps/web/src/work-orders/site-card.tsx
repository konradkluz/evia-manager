import type { SiteCard as SiteCardData } from '@evia/contracts';
import { Card, InlineAlert, StatusBadge } from '@evia/ui-web';
import type { UseQueryResult } from '@tanstack/react-query';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { siteTypeLabels } from '../i18n/catalog-labels.ts';
import { formatAddress, formatSpot } from '../sites/format.ts';
import { LinkedText } from './linked-text.tsx';
import { DetailRow, SectionError, SectionLoading } from './section-states.tsx';
import { isNotFound } from './use-work-order.ts';

/**
 * The card "Lokalizacja" of W-06 (EVM-018 AC1, AC4): the type of the object, the address, the spot and the level, the OSD, the
 * manager, the connection power, the PPE and the notes. Everything is React text — the notes of a site are written by people,
 * so `<script>` stays text and only `https:`, `tel:` and `mailto:` words become links (`LinkedText`, SR-WEB-03). A type of
 * object this panel does not know is the badge of an unknown value (P-12), never the raw code. "Edytuj" (W-20) and "Inne
 * zlecenia w tej lokalizacji" are EVM-036 and are not shown.
 */
export function SiteCard({ query }: { readonly query: UseQueryResult<SiteCardData> }) {
  const { t } = useTranslation();
  const headingId = useId();
  const card = query.data;
  return (
    <Card labelledBy={headingId}>
      <h2 id={headingId} className="text-heading-3 text-text-primary">
        {t('workOrder.site.heading')}
      </h2>
      {card !== undefined ? (
        <SiteFacts card={card} />
      ) : query.isError ? (
        isNotFound(query.error) ? (
          <InlineAlert tone="info">{t('workOrder.site.missing')}</InlineAlert>
        ) : (
          <SectionError
            message={t('workOrder.site.error')}
            retryLabel={t('workOrder.site.retry')}
            onRetry={() => {
              void query.refetch();
            }}
          />
        )
      ) : (
        <SectionLoading />
      )}
    </Card>
  );
}

function SiteFacts({ card }: { readonly card: SiteCardData }) {
  const { t } = useTranslation();
  const spot = formatSpot(t, card);
  return (
    <dl className="flex flex-col gap-stack-sm">
      <DetailRow label={t('workOrder.site.type')}>
        {Object.hasOwn(siteTypeLabels, card.siteType) ? (
          siteTypeLabels[card.siteType]
        ) : (
          <StatusBadge status="unknown" label={t('workOrders.status.unknown')} hint={t('workOrders.status.unknownHint')} />
        )}
      </DetailRow>
      <DetailRow label={t('workOrder.site.address')}>{formatAddress(card)}</DetailRow>
      {spot === undefined ? null : <DetailRow label={t('workOrder.site.spot')}>{spot}</DetailRow>}
      {card.distributionSystemOperator === null ? null : (
        <DetailRow label={t('workOrder.site.dso')}>{card.distributionSystemOperator.displayName}</DetailRow>
      )}
      {card.manager === null ? null : <DetailRow label={t('workOrder.site.manager')}>{card.manager.displayName}</DetailRow>}
      {card.connectionPowerKw === undefined ? null : (
        <DetailRow label={t('workOrder.site.power')}>
          {t('workOrder.site.powerValue', { value: String(card.connectionPowerKw).replace('.', ',') })}
        </DetailRow>
      )}
      {card.meteringPointId === undefined ? null : <DetailRow label={t('workOrder.site.metering')}>{card.meteringPointId}</DetailRow>}
      {card.notes === undefined ? null : (
        <DetailRow label={t('workOrder.site.notes')}>
          <span className="whitespace-pre-line">
            <LinkedText text={card.notes} />
          </span>
        </DetailRow>
      )}
    </dl>
  );
}

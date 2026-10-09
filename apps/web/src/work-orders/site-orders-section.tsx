import type { SiteOrderItem, SiteOrders, WorkOrderStatus } from '@evia/contracts';
import { List, ListItem, StatusBadge, TextLink, type OrderStatusKey } from '@evia/ui-web';
import type { UseQueryResult } from '@tanstack/react-query';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client.ts';
import { workOrderStatusLabels } from '../i18n/work-order-labels.ts';
import { workOrderPath } from '../paths.ts';
import { RouterLink } from '../shell/router-link.tsx';
import { formatDate } from './format.ts';
import { SectionError } from './section-states.tsx';
import { isNotFound } from './use-work-order.ts';

const isKnown = (status: string): status is WorkOrderStatus => Object.hasOwn(workOrderStatusLabels, status);
/** The token key of a status: the model code in kebab-case (styleguide § 4.4). */
const keyOf = (status: WorkOrderStatus): OrderStatusKey => status.replaceAll('_', '-') as OrderStatusKey;

/**
 * "Inne zlecenia w tej lokalizacji (n)" in the card "Lokalizacja" (EVM-036 AC5, AC6, AC8): the number (a link to the details of that
 * order, which has its own authorisation), the title (free text, shown as text), the status badge and the date of closing — and
 * nothing of the customer. Hidden while loading and when there are none (or the order is gone); a failure says so inside the section.
 * `n` is the number of orders the server counted with the same policy as the list of orders; up to 20 are listed.
 */
export function SiteOrdersSection({ query }: { readonly query: UseQueryResult<SiteOrders> }) {
  const { t } = useTranslation();
  const headingId = useId();
  if (query.isError) {
    if (isNotFound(query.error)) return null;
    return (
      <SectionError
        message={
          query.error instanceof ApiError && query.error.status === 429
            ? t('workOrder.site.others.rateLimited', { seconds: query.error.retryAfterSeconds ?? 60 })
            : t('workOrder.site.others.error')
        }
        retryLabel={t('workOrder.site.others.retry')}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  const orders = query.data;
  if (orders === undefined || orders.total === 0) return null;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-stack-sm">
      <h3 id={headingId} className="text-heading-4 text-text-primary">
        {t('workOrder.site.others.heading', { count: orders.total })}
      </h3>
      <List labelledBy={headingId}>
        {orders.items.map((item) => (
          <ListItem key={item.id}>
            <OtherOrder item={item} />
          </ListItem>
        ))}
      </List>
      {orders.total > orders.items.length ? (
        <p className="text-body-sm text-text-secondary">
          {t('workOrder.site.others.more', { shown: orders.items.length, total: orders.total })}
        </p>
      ) : null}
    </section>
  );
}

function OtherOrder({ item }: { readonly item: SiteOrderItem }) {
  const { t } = useTranslation();
  return (
    <>
      <span className="font-semibold tabular-nums">
        <TextLink href={workOrderPath(item.id)} link={RouterLink}>
          {item.number}
        </TextLink>
      </span>
      <span className="break-words text-text-secondary">{item.title}</span>
      <span className="flex flex-wrap items-center gap-inline-md">
        {isKnown(item.status) ? (
          <StatusBadge status={keyOf(item.status)} label={workOrderStatusLabels[item.status]} />
        ) : (
          <StatusBadge status="unknown" label={t('workOrders.status.unknown')} hint={t('workOrders.status.unknownHint')} />
        )}
        {item.closedAt === undefined ? null : (
          <span className="text-body-sm text-text-secondary">{t('workOrder.site.others.closed', { date: formatDate(item.closedAt) })}</span>
        )}
      </span>
    </>
  );
}

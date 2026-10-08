import { listWorkOrders } from '@evia/contracts';
import { Button, Card, ChevronLeft, ChevronRight } from '@evia/ui-web';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { retryMinutes } from '../pages/login-failure.tsx';
import { useOnline } from '../shell/use-online.ts';
import { SectionError, SectionLoading } from '../work-orders/section-states.tsx';
import { CustomerOrdersTable } from './customer-orders-table.tsx';
import { CUSTOMER_ORDERS_KEY } from './query-keys.ts';

const PAGE_SIZE = 25;

/**
 * "Historia zleceń (n)" of W-14 (EVM-039 AC2; SR-AUTHZ-03): the orders of the customer from the list of work orders with the
 * filter `customerId` — the same policy as the list W-10, newest first, 25 on a page with a cursor. The API gives no total, so
 * "(n)" is what has been passed through, with "+" while there is a next page. A section that fails says so inside itself.
 */
export function CustomerHistory({ customerId, enabled }: { readonly customerId: string; readonly enabled: boolean }) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const headingId = useId();
  const [cursors, setCursors] = useState<readonly string[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef<'next' | 'previous' | null>(null);
  const cursor = cursors.at(-1);
  const query = useQuery({
    queryKey: [CUSTOMER_ORDERS_KEY, customerId, cursor ?? null],
    queryFn: ({ signal }) =>
      unwrap(
        listWorkOrders({
          client,
          signal,
          query: { customerId, sort: '-createdAt', limit: PAGE_SIZE, ...(cursor === undefined ? {} : { cursor }) },
        }),
      ),
    enabled,
    retry: false,
    // The numbers and titles of the orders of a person are not kept once the page is left (SR-WEB-05).
    gcTime: 0,
  });
  const data = query.data;
  const error = query.error;

  useEffect(() => {
    if (data === undefined || moved.current === null) return;
    setAnnouncement(moved.current === 'next' ? t('customerPage.history.loadedNext') : t('customerPage.history.loadedPrevious'));
    moved.current = null;
    heading.current?.focus();
  }, [data, t]);

  // The connection is back: a history that failed meanwhile is read again.
  useEffect(() => {
    if (online && query.error instanceof ApiError && query.error.status === 0) void query.refetch();
    // Only the return of the connection matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const count = cursors.length * PAGE_SIZE + (data?.items.length ?? 0);
  const title =
    data === undefined
      ? t('customerPage.history.title')
      : data.nextCursor === null
        ? t('customerPage.history.heading', { count })
        : t('customerPage.history.headingMore', { count });
  return (
    <Card labelledBy={headingId}>
      <h2 id={headingId} ref={heading} tabIndex={-1} className="text-heading-3 text-text-primary focus-visible:focus-ring">
        {title}
      </h2>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {data !== undefined ? (
        data.items.length === 0 ? (
          <p className="text-body text-text-secondary">{t('customerPage.history.empty')}</p>
        ) : (
          <>
            <CustomerOrdersTable items={data.items} />
            {cursors.length === 0 && data.nextCursor === null ? null : (
              <nav aria-label={t('customerPage.history.pagesLabel')} className="flex flex-wrap items-center justify-center gap-inline-md">
                <Button
                  variant="secondary"
                  icon={ChevronLeft}
                  disabled={!online || cursors.length === 0}
                  onClick={() => {
                    moved.current = 'previous';
                    setCursors(cursors.slice(0, -1));
                  }}
                >
                  {t('customerPage.history.previous')}
                </Button>
                <Button
                  variant="secondary"
                  icon={ChevronRight}
                  disabled={!online || data.nextCursor === null}
                  onClick={() => {
                    moved.current = 'next';
                    if (data.nextCursor !== null) setCursors([...cursors, data.nextCursor]);
                  }}
                >
                  {t('customerPage.history.next')}
                </Button>
              </nav>
            )}
          </>
        )
      ) : error !== null ? (
        <SectionError
          message={
            error instanceof ApiError && error.status === 429
              ? t('customerPage.history.rateLimited', { minutes: retryMinutes(error) })
              : t('customerPage.history.error')
          }
          retryLabel={t('customerPage.history.retry')}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <SectionLoading lines={3} />
      )}
    </Card>
  );
}

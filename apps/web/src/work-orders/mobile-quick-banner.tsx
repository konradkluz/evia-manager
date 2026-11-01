import type { WorkOrderDetails } from '@evia/contracts';
import { ArrowDown, Banner, Button, Info } from '@evia/ui-web';
import { useTranslation } from 'react-i18next';
import { customerPath } from '../paths.ts';
import { useSession } from '../session/session.ts';
import { useOnline } from '../shell/use-online.ts';
import { RouterLink } from '../shell/router-link.tsx';
import { formatDate } from './format.ts';

/**
 * The banner "Zlecenie założone w terenie" of W-06 (EVM-099 AC8; flow 03): shown while an order made on a phone (`origin = mobile_quick`)
 * is still "Nowe" — the status is the whole condition, there is no way back to it. The first line (the author and the date, React
 * text) is for every role; the three ways to complete the data — the customer (navigation), the site (opens W-20) and the instalments
 * (a link inside the page) — only for Administrator and Editor. The server decides what they may do; this only hides the links.
 */
export function MobileQuickBanner({
  order,
  onEditSite,
  onShowPayments,
}: {
  readonly order: WorkOrderDetails;
  readonly onEditSite: () => void;
  readonly onShowPayments: () => void;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const role = useSession().data?.user.role;
  if (order.origin !== 'mobile_quick' || order.status !== 'new' || role === undefined) return null;
  const date = formatDate(order.createdAt);
  const author = order.createdBy?.displayName;
  const canComplete = role === 'administrator' || role === 'editor';
  return (
    <Banner icon={Info} tone="info" label={t('workOrder.mobileQuick.label')}>
      <p>
        {author === undefined ? t('workOrder.mobileQuick.createdOn', { date }) : t('workOrder.mobileQuick.createdBy', { author, date })}
      </p>
      {canComplete ? (
        <p className="flex flex-wrap items-center gap-inline-sm">
          <span>{t('workOrder.mobileQuick.complete')}</span>
          {order.customer === null ? null : (
            <>
              <RouterLink
                href={customerPath(order.customer.id)}
                aria-label={t('workOrder.mobileQuick.customerLinkLabel')}
                className="break-words underline text-text-link focus-visible:focus-ring"
              >
                {t('workOrder.mobileQuick.customerLink')}
              </RouterLink>
              <span aria-hidden="true">{t('workOrder.mobileQuick.separator')}</span>
            </>
          )}
          <Button
            variant="tertiary"
            aria-haspopup="dialog"
            aria-label={t('workOrder.mobileQuick.siteButtonLabel')}
            disabled={!online}
            onClick={onEditSite}
          >
            {t('workOrder.mobileQuick.siteButton')}
          </Button>
          <span aria-hidden="true">{t('workOrder.mobileQuick.separator')}</span>
          <a
            href="#platnosci"
            aria-label={t('workOrder.mobileQuick.paymentsLinkLabel')}
            className="inline-flex items-center gap-inline-xs break-words underline text-text-link focus-visible:focus-ring"
            onClick={(event) => {
              event.preventDefault();
              onShowPayments();
            }}
          >
            {t('workOrder.mobileQuick.paymentsLink')}
            <ArrowDown aria-hidden="true" className="size-icon-sm" />
          </a>
        </p>
      ) : null}
    </Banner>
  );
}

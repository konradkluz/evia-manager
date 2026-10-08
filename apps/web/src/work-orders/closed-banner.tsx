import type { WorkOrderDetails } from '@evia/contracts';
import { Banner, Info } from '@evia/ui-web';
import { useTranslation } from 'react-i18next';
import { useSession } from '../session/session.ts';
import { isClosed } from './transition-actions.ts';

/**
 * The banner of a settled or cancelled order (W-06 (b), EVM-030 AC6): the first sentence for everybody, the second by role —
 * the Administrator learns the way back, the Editor that only an administrator restores, Tylko odczyt hears nothing about
 * adding entries (he cannot add them). A named region read with the page, not an alert. The server refuses the edits
 * (`409 work_order_closed`, EVM-031 and later); the banner only tells.
 */
export function ClosedBanner({ order }: { readonly order: WorkOrderDetails }) {
  const { t } = useTranslation();
  const role = useSession().data?.user.role;
  if (!isClosed(order.status) || role === undefined) return null;
  return (
    <Banner icon={Info} tone="info" label={t('workOrder.status.banner.label')}>
      <p>
        {order.status === 'settled' ? t('workOrder.status.banner.settled') : t('workOrder.status.banner.cancelled')}
        {role === 'read_only' ? '' : ` ${t('workOrder.status.banner.additions')}`}
      </p>
      {role === 'read_only' ? null : (
        <p>{role === 'administrator' ? t('workOrder.status.banner.administrator') : t('workOrder.status.banner.editor')}</p>
      )}
    </Banner>
  );
}

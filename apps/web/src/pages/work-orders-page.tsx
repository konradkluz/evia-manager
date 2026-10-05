import { ClipboardList, EmptyState } from '@evia/ui-web';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * W-10 "Zlecenia" — skeleton variant (EVM-008, decision (1) of Konrad): only the empty state "Brak zleceń" without the
 * "Nowe zlecenie" action, filters or search (they arrive with the list of work orders).
 */
export function WorkOrdersPage() {
  const { t } = useTranslation();
  const title = t('workOrders.title');
  useEffect(() => {
    document.title = t('app.pageTitle', { page: title });
  }, [t, title]);
  return (
    <>
      <h1 className="font-display text-heading-1 text-text-primary">{title}</h1>
      <EmptyState icon={ClipboardList} title={t('workOrders.empty.title')} description={t('workOrders.empty.description')} />
    </>
  );
}

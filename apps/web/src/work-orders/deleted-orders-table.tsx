import { restoreWorkOrder, type WorkOrderListItem, type WorkOrderStatus } from '@evia/contracts';
import {
  Button,
  DataTable,
  InlineAlert,
  StatusBadge,
  Undo2,
  type DataTableColumn,
  type DataTableRow,
  type OrderStatusKey,
} from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { useAttempt } from '../forms/attempt.ts';
import { refusesAttempt } from '../forms/save-failure.ts';
import { workOrderStatusLabels } from '../i18n/work-order-labels.ts';
import { formatSiteLine } from '../sites/format.ts';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { formatDate } from './format.ts';
import { describeDeletionFailure, etagOfVersion, type OrderDeletionFailure } from './order-deletion.ts';
import { WORK_ORDERS_KEY } from './query-keys.ts';

const isKnown = (status: string): status is WorkOrderStatus => Object.hasOwn(workOrderStatusLabels, status);
const keyOf = (status: WorkOrderStatus): OrderStatusKey => status.replaceAll('_', '-') as OrderStatusKey;

/**
 * The view "Usunięte" of W-10 (EVM-060 AC4, AC6; Administrator only): the orders that were deleted, each with "Przywróć". A row does not
 * lead to the details — a deleted order is `404` there, for every role — so the row is not a link. "Przywróć" sends `POST …/restore` with
 * `If-Match` of the `version` of the row (the list is the only place that holds it) and an `Idempotency-Key` that stays the same for a retry
 * of the same decision; no step-up (restoring changes no payment). The list is read again after `412` and `404`, so the rows show what is
 * true now. Offline the button is disabled with the reason. Titles are free text and the customer may be gone ("Klient usunięty"): React
 * text only.
 */
export function DeletedOrdersTable({
  items,
  onRestored,
}: {
  readonly items: readonly WorkOrderListItem[];
  /** The order came back: the row is gone, so the focus must go somewhere that stays (the heading of the page). */
  readonly onRestored: () => void;
}) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const attempt = useAttempt();
  const [failure, setFailure] = useState<OrderDeletionFailure | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (request: { readonly id: string; readonly version: number; readonly key: string }) =>
      unwrap(
        restoreWorkOrder({
          client,
          path: { workOrderId: request.id },
          headers: { 'If-Match': etagOfVersion(request.version), 'Idempotency-Key': request.key },
        }),
      ),
  });

  const restore = (item: WorkOrderListItem) => {
    // Without a version on screen nothing is sent: guessing one would only provoke a `412`.
    const version = item.version;
    if (version === undefined) return;
    const { key } = attempt.next(`${item.id}|${String(version)}`);
    setFailure(null);
    setPendingId(item.id);
    mutation.mutate(
      { id: item.id, version, key },
      {
        onSuccess: () => {
          attempt.forget();
          showToast(t('workOrders.deleted.restored', { number: item.number }));
          void queryClient.invalidateQueries({ queryKey: [WORK_ORDERS_KEY] });
          onRestored();
        },
        onError: (error) => {
          if (refusesAttempt(error)) attempt.forget();
          const described = describeDeletionFailure(error);
          // The answer carries no state: the list is read again, so the row shows what is true now.
          if (described.kind === 'conflict' || described.kind === 'gone') {
            void queryClient.invalidateQueries({ queryKey: [WORK_ORDERS_KEY] });
          }
          setFailure(described);
        },
        onSettled: () => {
          setPendingId(null);
        },
      },
    );
  };

  const failureText = (current: OrderDeletionFailure): string => {
    switch (current.kind) {
      case 'conflict':
        return t('workOrders.deleted.failure.conflict');
      case 'gone':
        return t('workOrders.deleted.failure.gone');
      case 'forbidden':
      case 'stepUp':
        return t('workOrders.deleted.failure.forbidden');
      case 'inProgress':
        return t('workOrders.deleted.failure.inProgress');
      case 'rate':
        return t('workOrders.deleted.failure.rateLimited', { seconds: current.seconds });
      case 'dependents':
      case 'network':
        return t('workOrders.deleted.failure.network');
      case 'server':
        return t('workOrders.deleted.failure.server', { code: current.code });
    }
  };

  const columns: DataTableColumn[] = [
    { id: 'order', card: 'primary', header: t('workOrders.table.order') },
    { id: 'customer', header: t('workOrders.table.customer'), expandedOnly: true },
    { id: 'status', card: 'badge', header: t('workOrders.table.status') },
    { id: 'deleted', card: 'detail', cardLabel: true, header: t('workOrders.deleted.column') },
  ];
  const rows: DataTableRow[] = items.map((item) => {
    const known = isKnown(item.status);
    const status = known ? workOrderStatusLabels[item.status] : t('workOrders.status.unknown');
    const customer = item.customer;
    const customerText =
      customer === undefined || customer === null
        ? undefined
        : 'deleted' in customer
          ? t('workOrders.table.customerDeleted')
          : customer.displayName;
    const site = item.site;
    const siteText = site === undefined || site === null ? undefined : formatSiteLine(site);
    const deletedOn = item.deletedAt === undefined ? undefined : formatDate(item.deletedAt);
    const restoreHint = online ? undefined : t('workOrders.deleted.offlineHint');
    return {
      id: item.id,
      label: [
        t('workOrders.table.rowHead', { number: item.number, title: item.title }),
        customerText,
        siteText,
        deletedOn === undefined ? undefined : t('workOrders.deleted.rowDeleted', { date: deletedOn }),
      ]
        .filter((part) => part !== undefined)
        .join(', '),
      cells: [
        <span key="order" className="flex flex-col">
          <span className="font-semibold tabular-nums whitespace-nowrap">{item.number}</span>
          <span className="wrap-anywhere text-text-secondary">{item.title}</span>
          {customerText === undefined ? null : <span className="expanded:hidden wrap-anywhere text-text-secondary">{customerText}</span>}
          {siteText === undefined ? null : <span className="wrap-anywhere text-text-secondary">{siteText}</span>}
        </span>,
        <span key="customer" className="wrap-anywhere text-text-secondary">
          {customerText}
        </span>,
        {
          badge: known ? (
            <StatusBadge status={keyOf(item.status)} label={status} />
          ) : (
            <StatusBadge status="unknown" label={status} hint={t('workOrders.status.unknownHint')} />
          ),
          action: (
            <Button
              variant="tertiary"
              icon={Undo2}
              aria-label={t('workOrders.deleted.restoreLabel', { number: item.number })}
              loading={pendingId === item.id}
              disabled={!online || item.version === undefined || pendingId !== null}
              {...(restoreHint === undefined ? {} : { title: restoreHint })}
              onClick={() => {
                restore(item);
              }}
            >
              {t('workOrders.deleted.restore')}
            </Button>
          ),
        },
        <span key="deleted" className="tabular-nums">
          {deletedOn}
        </span>,
      ],
    };
  });
  return (
    <div className="flex flex-col gap-stack-md">
      {failure === null ? null : <InlineAlert tone="error">{failureText(failure)}</InlineAlert>}
      <DataTable caption={t('workOrders.deleted.caption')} dense columns={columns} rows={rows} />
    </div>
  );
}

import type { WorkOrderDetails } from '@evia/contracts';
import { ActionMenu, Card, EllipsisVertical, IconButton } from '@evia/ui-web';
import { useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { formatAddress, formatSpot } from '../sites/format.ts';
import { useSession } from '../session/session.ts';
import { useOnline } from '../shell/use-online.ts';
import { useStateWord } from './edit-failure.ts';
import { formatDate } from './format.ts';
import { formatDueDate } from './procedure-format.ts';
import { OrderEditDialog } from './order-edit-dialog.tsx';
import { StatusTransitions } from './status-transitions.tsx';
import { isClosed } from './transition-actions.ts';

/**
 * The header of W-06 (EVM-018 AC1): the number as the page heading (`h1`, focused when the page opens — WCAG 2.4.3), the title,
 * the status badge (a button with the menu of transitions for the Administrator and the Editor — EVM-030; static for Tylko
 * odczyt and P-12 for a status this panel does not know), the customer, the address with the spot and the level, the keeper,
 * the planned date and the date of creation. All of it is React text; a customer, a site or a keeper that is gone is "Brak danych".
 * The menu "Akcje zlecenia" with "Edytuj dane zlecenia…" (EVM-035 AC1, AC6, AC8) is for the Administrator and the Editor: disabled
 * with a reason for a closed order and offline; Tylko odczyt gets no menu. The server decides all the same.
 */
export function WorkOrderHeader({ order, headingRef }: { readonly order: WorkOrderDetails; readonly headingRef: Ref<HTMLHeadingElement> }) {
  const { t } = useTranslation();
  const online = useOnline();
  const role = useSession().data?.user.role;
  const stateWord = useStateWord();
  const [editing, setEditing] = useState(false);
  const spot = order.site === null ? undefined : formatSpot(t, order.site);
  const address = order.site === null ? null : spot === undefined ? formatAddress(order.site) : `${formatAddress(order.site)} · ${spot}`;
  const missing = t('workOrder.header.missing');
  const rows: ReadonlyArray<readonly [string, string]> = [
    [t('workOrder.header.customer'), order.customer?.displayName ?? missing],
    [t('workOrder.header.site'), address ?? missing],
    [t('workOrder.header.coordinator'), order.coordinator?.displayName ?? missing],
    ...(order.plannedDate === undefined ? [] : [[t('workOrder.header.plannedDate'), formatDueDate(order.plannedDate)] as const]),
    ...(order.description === undefined ? [] : [[t('workOrder.header.description'), order.description] as const]),
    [t('workOrder.header.created'), formatDate(order.createdAt)],
  ];
  // The disabled item explains why (§ 3.20, § 4.13): a closed order first (the Editor learns who restores), then the connection.
  const closed = isClosed(order.status);
  const state = stateWord(order.status);
  const disabledHint = closed
    ? role === 'editor'
      ? t('workOrder.edit.closedHintEditor', { state })
      : t('workOrder.edit.closedHint', { state })
    : online
      ? undefined
      : t('workOrder.edit.offlineMenu');
  return (
    <header className="flex flex-col gap-stack-sm">
      <div className="flex flex-wrap items-start justify-between gap-inline-md">
        <h1 ref={headingRef} tabIndex={-1} className="self-start font-display text-heading-1 text-text-primary focus-visible:focus-ring">
          {order.number}
        </h1>
        {role === 'administrator' || role === 'editor' ? (
          <ActionMenu
            label={t('workOrder.edit.menuLabel', { number: order.number })}
            items={[
              {
                id: 'edit',
                label: t('workOrder.edit.trigger'),
                onSelect: () => {
                  setEditing(true);
                },
                ...(disabledHint === undefined ? {} : { disabledHint }),
              },
            ]}
            trigger={(props) => (
              <IconButton {...props} icon={EllipsisVertical} label={t('workOrder.edit.menuLabel', { number: order.number })} />
            )}
          />
        ) : null}
      </div>
      <p className="break-words text-heading-4 text-text-primary">{order.title}</p>
      <StatusTransitions order={order} />
      <Card>
        <dl className="grid grid-cols-1 gap-x-inline-md gap-y-stack-sm medium:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-stack-xs">
              <dt className="text-label text-text-secondary">{label}</dt>
              <dd className="whitespace-pre-line break-words text-body text-text-primary">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      {editing ? (
        <OrderEditDialog
          order={order}
          onClose={() => {
            setEditing(false);
          }}
        />
      ) : null}
    </header>
  );
}

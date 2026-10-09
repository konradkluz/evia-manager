import type { SiteCard as SiteCardData, SiteOrders } from '@evia/contracts';
import { ActionMenu, Button, Card, EllipsisVertical, IconButton, InlineAlert, StatusBadge } from '@evia/ui-web';
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { siteTypeLabels } from '../i18n/catalog-labels.ts';
import { EditPartyDialog } from '../parties/edit-party-dialog.tsx';
import { useSession } from '../session/session.ts';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { EditSiteDialog } from '../sites/edit-site-dialog.tsx';
import { formatAddress, formatSpot } from '../sites/format.ts';
import { LinkedText } from './linked-text.tsx';
import { WORK_ORDER_HEADER_KEY, WORK_ORDER_KEYS, WORK_ORDER_SITE_KEY } from './query-keys.ts';
import { DetailRow, SectionError, SectionLoading } from './section-states.tsx';
import { SiteOrdersSection } from './site-orders-section.tsx';
import { isNotFound } from './use-work-order.ts';

/**
 * The card "Lokalizacja" of W-06 (EVM-018 AC1, AC4; EVM-036): the type of the object, the address, the spot and the level, the OSD, the
 * manager, the connection power, the PPE and the notes. Everything is React text — the notes of a site are written by people, so
 * `<script>` stays text and only `https:`, `tel:` and `mailto:` words become links (`LinkedText`, SR-WEB-03). A type of object this
 * panel does not know is the badge of an unknown value (P-12), never the raw code.
 *
 * For the Administrator and the Editor the card has "Edytuj" (W-20 "Edytuj lokalizację") and the menu "Akcje strony" next to the OSD
 * and the manager ("Edytuj stronę…"); Tylko odczyt has none of them (the server refuses a change anyway — `403`). Offline they say they
 * work after the connection returns (AC8). Below the facts: "Inne zlecenia w tej lokalizacji (n)" — metadata only (AC5).
 */
export function SiteCard({
  query,
  orders,
  workOrderId,
}: {
  readonly query: UseQueryResult<SiteCardData>;
  readonly orders: UseQueryResult<SiteOrders>;
  readonly workOrderId: string;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const queryClient = useQueryClient();
  const toast = useToast();
  const online = useOnline();
  const role = useSession().data?.user.role;
  const canEdit = role === 'administrator' || role === 'editor';
  const [editingSite, setEditingSite] = useState(false);
  const [editingParty, setEditingParty] = useState<string | null>(null);
  const card = query.data;

  const reloadCard = () => {
    // The card (names of the parties, the address) and the header (the address) are read again; the old data stays until the new arrives.
    void queryClient.invalidateQueries({ queryKey: [WORK_ORDER_SITE_KEY, workOrderId] });
    void queryClient.invalidateQueries({ queryKey: [WORK_ORDER_HEADER_KEY, workOrderId] });
  };
  const refreshOrder = () => {
    setEditingSite(false);
    setEditingParty(null);
    for (const key of WORK_ORDER_KEYS) void queryClient.invalidateQueries({ queryKey: [key, workOrderId] });
  };

  return (
    <Card labelledBy={headingId}>
      <div className="flex items-center justify-between gap-inline-md">
        <h2 id={headingId} className="text-heading-3 text-text-primary">
          {t('workOrder.site.heading')}
        </h2>
        {card !== undefined && canEdit ? (
          <Button
            variant="tertiary"
            aria-label={t('workOrder.site.editLabel')}
            disabled={!online}
            {...(online ? {} : { title: t('workOrder.site.editOffline') })}
            onClick={() => {
              setEditingSite(true);
            }}
          >
            {t('workOrder.site.edit')}
          </Button>
        ) : null}
      </div>
      {card !== undefined ? (
        <>
          <SiteFacts
            card={card}
            canEdit={canEdit}
            online={online}
            onEditParty={(id) => {
              setEditingParty(id);
            }}
          />
          <SiteOrdersSection query={orders} />
        </>
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
      {editingSite && card !== undefined ? (
        <EditSiteDialog
          siteId={card.siteId}
          orderCount={orders.data === undefined ? undefined : orders.data.total + 1}
          onRefresh={refreshOrder}
          onClose={(saved) => {
            setEditingSite(false);
            if (saved === undefined) return;
            reloadCard();
            toast(t('siteEdit.saved'));
          }}
        />
      ) : null}
      {editingParty !== null ? (
        <EditPartyDialog
          partyId={editingParty}
          onRefresh={refreshOrder}
          onClose={(saved) => {
            setEditingParty(null);
            if (saved === undefined) return;
            reloadCard();
            toast(t('partyEdit.saved'));
          }}
        />
      ) : null}
    </Card>
  );
}

/** A party of the card with its menu "Akcje strony: Stoen Operator (OSD)" → "Edytuj stronę…" (only for those who may edit). */
function PartyLine({
  party,
  role,
  canEdit,
  online,
  onEdit,
}: {
  readonly party: { readonly id: string; readonly displayName: string };
  readonly role: string;
  readonly canEdit: boolean;
  readonly online: boolean;
  readonly onEdit: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (!canEdit) return party.displayName;
  const label = t('workOrder.site.partyMenu', { name: party.displayName, role });
  return (
    <span className="flex items-center justify-between gap-inline-md">
      <span className="min-w-0 break-words">{party.displayName}</span>
      <ActionMenu
        label={label}
        items={[
          {
            id: 'edit',
            label: t('workOrder.site.partyEdit'),
            onSelect: () => {
              onEdit(party.id);
            },
            ...(online ? {} : { disabledHint: t('workOrder.site.editOffline') }),
          },
        ]}
        trigger={(props) => <IconButton {...props} icon={EllipsisVertical} label={label} />}
      />
    </span>
  );
}

function SiteFacts({
  card,
  canEdit,
  online,
  onEditParty,
}: {
  readonly card: SiteCardData;
  readonly canEdit: boolean;
  readonly online: boolean;
  readonly onEditParty: (id: string) => void;
}) {
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
        <DetailRow label={t('workOrder.site.dso')}>
          <PartyLine
            party={card.distributionSystemOperator}
            role={t('workOrder.site.roleDso')}
            canEdit={canEdit}
            online={online}
            onEdit={onEditParty}
          />
        </DetailRow>
      )}
      {card.manager === null ? null : (
        <DetailRow label={t('workOrder.site.manager')}>
          <PartyLine party={card.manager} role={t('workOrder.site.roleManager')} canEdit={canEdit} online={online} onEdit={onEditParty} />
        </DetailRow>
      )}
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

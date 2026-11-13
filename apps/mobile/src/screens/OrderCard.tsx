import type { LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import type { OrderRow } from '../orders/order-list-model';
import {
  Ban,
  Banknote,
  Calculator,
  CircleCheck,
  CirclePause,
  CircleQuestionMark,
  Clock,
  Inbox,
  StatusBadge,
  ThumbsUp,
  Wrench,
} from '../ui';
import type { BadgeTone } from '../ui';
import { borderWidth, color, radius, space, text } from '../ui/theme';

/** Status of a work order -> icon and colours (styleguide § 4.4); a value outside the map is only the "Nieznany status" badge (§ 3.9.1). */
const STATUS: Readonly<Record<string, { icon: LucideIcon; tone: BadgeTone; label: string }>> = {
  new: { icon: Inbox, tone: color.status.order.new, label: 'shell.orders.status.new' },
  quoting: { icon: Calculator, tone: color.status.order.quoting, label: 'shell.orders.status.quoting' },
  accepted: { icon: ThumbsUp, tone: color.status.order.accepted, label: 'shell.orders.status.accepted' },
  in_progress: { icon: Wrench, tone: color.status.order.inProgress, label: 'shell.orders.status.in_progress' },
  completed: { icon: CircleCheck, tone: color.status.order.completed, label: 'shell.orders.status.completed' },
  settled: { icon: Banknote, tone: color.status.order.settled, label: 'shell.orders.status.settled' },
  on_hold: { icon: CirclePause, tone: color.status.order.onHold, label: 'shell.orders.status.on_hold' },
  cancelled: { icon: Ban, tone: color.status.order.cancelled, label: 'shell.orders.status.cancelled' },
};

/**
 * One work order of "Moje zlecenia" (EVM-103 AC1, AC3; styleguide § 3.8). Until the details exist (EVM-104) the card is not active:
 * no chevron, no pressed state, no button role (it is read as one block, starting with the status). Text only - names and addresses
 * are rendered by `Text` and never as markup (security K9).
 */
export function OrderCard({ row }: { row: OrderRow }) {
  const { t } = useTranslation();
  const known = Object.hasOwn(STATUS, row.status) ? STATUS[row.status] : undefined;
  const statusLabel = known === undefined ? t('shell.orders.unknownStatus') : t(known.label);
  const address = [row.street, row.city].filter((part) => part !== '').join(', ');
  const spot = row.spot === '' ? '' : t('shell.orders.spot', { spot: row.spot });
  const stage = row.stage === '' ? '' : t('shell.orders.stage', { stage: row.stage });
  const unsent = row.unsent && !row.awaitingNumber ? t('shell.orders.unsent') : '';
  const heading = row.awaitingNumber ? t('shell.orders.awaitingNumber') : (row.number ?? '');
  const label = [heading, row.awaitingNumber ? '' : statusLabel, row.customer, address, spot, stage, unsent]
    .filter((part) => part !== '')
    .join(', ');
  return (
    <View
      accessible
      accessibilityLabel={label}
      testID={`order-row-${row.id}`}
      style={{
        rowGap: space.stack.xs,
        padding: space.inset.md,
        backgroundColor: color.bg.surface,
        borderRadius: radius.card,
        borderWidth: borderWidth.default,
        borderColor: color.border.subtle,
      }}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space.inline.sm }}>
        {row.awaitingNumber ? (
          <StatusBadge icon={Clock} label={heading} tone={color.sync.queued} testID={`order-awaiting-${row.id}`} />
        ) : (
          <>
            <Text style={{ ...text.heading4, color: color.text.primary }}>{heading}</Text>
            <StatusBadge
              icon={known?.icon ?? CircleQuestionMark}
              label={statusLabel}
              tone={known?.tone ?? color.status.unknown}
              testID={`order-status-${row.id}`}
            />
          </>
        )}
      </View>
      {row.customer === '' ? null : <Text style={{ ...text.body, color: color.text.primary }}>{row.customer}</Text>}
      {address === '' ? null : <Text style={{ ...text.bodyLg, color: color.text.primary }}>{address}</Text>}
      {spot === '' ? null : <Text style={{ ...text.bodySm, color: color.text.secondary }}>{spot}</Text>}
      {stage === '' ? null : <Text style={{ ...text.bodySm, color: color.text.secondary }}>{stage}</Text>}
      {unsent === '' ? null : <StatusBadge icon={Clock} label={unsent} tone={color.sync.queued} testID={`order-unsent-${row.id}`} />}
    </View>
  );
}

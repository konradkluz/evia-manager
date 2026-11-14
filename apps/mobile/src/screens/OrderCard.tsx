import type { LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import type { OrderRow } from '../orders/order-list-model';
import {
  Ban,
  Banknote,
  Calculator,
  ChevronRight,
  CircleCheck,
  CirclePause,
  CircleQuestionMark,
  Clock,
  Icon,
  Inbox,
  StatusBadge,
  ThumbsUp,
  Wrench,
} from '../ui';
import type { BadgeTone } from '../ui';
import { borderWidth, color, radius, size, space, text } from '../ui/theme';

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

/** The badge of the status of a work order (list and details); a value outside the map is "Nieznany status". */
export function OrderStatusBadge({ status, testID }: { status: string; testID?: string }) {
  const { t } = useTranslation();
  const known = Object.hasOwn(STATUS, status) ? STATUS[status] : undefined;
  return (
    <StatusBadge
      icon={known?.icon ?? CircleQuestionMark}
      label={known === undefined ? t('shell.orders.unknownStatus') : t(known.label)}
      tone={known?.tone ?? color.status.unknown}
      testID={testID}
    />
  );
}

/**
 * One work order of "Moje zlecenia" (EVM-103 AC1, AC3; EVM-104 AC1; styleguide § 3.8). With `onOpen` the card is active: the role of
 * a button, a pressed state and a chevron, the name starts with the number (the whole row is the target, at least 48 dp). A row
 * A row "Oczekuje na numer" (EVM-106) opens its details from the queue like any other. Text only - names and addresses are rendered by
 * `Text` and never as markup (security K9).
 */
const box = {
  rowGap: space.stack.xs,
  padding: space.inset.md,
  backgroundColor: color.bg.surface,
  borderRadius: radius.card,
  borderWidth: borderWidth.default,
  borderColor: color.border.subtle,
} as const;

export function OrderCard({ row, onOpen }: { row: OrderRow; onOpen?: (id: string) => void }) {
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
  const active = onOpen !== undefined;
  const content = (
    <>
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
    </>
  );
  if (active) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => {
          onOpen(row.id);
        }}
        testID={`order-row-${row.id}`}
        style={({ pressed }) => ({
          ...box,
          minHeight: size.touchTarget.min,
          flexDirection: 'row',
          alignItems: 'center',
          columnGap: space.inline.sm,
          backgroundColor: pressed ? color.bg.surfacePressed : color.bg.surface,
        })}
      >
        <View style={{ flex: 1, rowGap: space.stack.xs }}>{content}</View>
        <Icon icon={ChevronRight} color={color.text.secondary} iconSize="md" />
      </Pressable>
    );
  }
  return (
    <View accessible accessibilityLabel={label} testID={`order-row-${row.id}`} style={box}>
      {content}
    </View>
  );
}

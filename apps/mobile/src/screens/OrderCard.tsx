import type { LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { formatClock, formatDate } from '../i18n/format';
import type { OrderRow } from '../orders/order-list-model';
import { expiryOf } from '../orders/site-survey-model';
import {
  Ban,
  Banknote,
  Binoculars,
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
import { SurveyTerm, surveyTermText } from './survey-term';

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

const lowerFirst = (value: string): string => value.charAt(0).toLowerCase() + value.slice(1);

/**
 * The card of a site survey (EVM-137 AC4; flow 17, M-05): number or "Oczekuje na numer", the status, the mark "Wizja lokalna", the term and
 * the date - and NEVER the address, the title or the phone of the requester (W5; the row of the model has none to print). The name for the
 * screen reader is built from the same facts, so it has no address either.
 */
function SurveyCard({ row, onOpen }: { row: OrderRow; onOpen?: (id: string) => void }) {
  const { t } = useTranslation();
  const survey = row.survey;
  if (survey === null) return null;
  const rejected = row.status === 'cancelled';
  const known = Object.hasOwn(STATUS, row.status) ? STATUS[row.status] : undefined;
  const statusLabel = known === undefined ? t('shell.orders.unknownStatus') : t(known.label);
  const expiry = expiryOf(survey.expiresAt, Date.now());
  const termText = surveyTermText(t, expiry, rejected);
  const attention = !rejected && expiry.state !== 'normal' && expiry.state !== 'overdue';
  const dateText = row.awaitingNumber
    ? t('shell.orders.surveySaved', { time: formatClock(row.createdAt) })
    : t('shell.orders.surveyCreated', { date: formatDate(row.createdAt) });
  const dateA11y = row.awaitingNumber
    ? t('shell.orders.surveyA11ySaved', { time: formatClock(row.createdAt) })
    : t('shell.orders.surveyA11yCreated', { date: formatDate(row.createdAt) });
  const unsent = row.unsent && !row.awaitingNumber ? t('shell.orders.unsent') : '';
  const label = [
    t('orderDetail.surveyBadge'),
    row.awaitingNumber ? t('shell.orders.surveyA11yPending') : (row.number ?? ''),
    row.awaitingNumber ? '' : statusLabel,
    rejected ? t('shell.orders.surveyA11yRejected') : '',
    dateA11y,
    attention ? `${lowerFirst(termText)} — ${t('shell.orders.surveyA11yAttention')}` : lowerFirst(termText),
    rejected || expiry.state === 'overdue' || attention || expiry.state === 'today'
      ? ''
      : t('shell.orders.surveyA11yOn', { date: formatDate(survey.expiresAt) }),
    unsent,
  ]
    .filter((part) => part !== '')
    .join(', ');
  const content = (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space.inline.sm }}>
        {row.awaitingNumber ? (
          <StatusBadge icon={Clock} label={t('shell.orders.awaitingNumber')} tone={color.sync.queued} testID={`order-awaiting-${row.id}`} />
        ) : (
          <>
            <Text style={{ ...text.heading4, color: color.text.primary }}>{row.number ?? ''}</Text>
            <StatusBadge
              icon={known?.icon ?? CircleQuestionMark}
              label={statusLabel}
              tone={known?.tone ?? color.status.unknown}
              testID={`order-status-${row.id}`}
            />
          </>
        )}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.inline.sm }}>
        <StatusBadge
          icon={Binoculars}
          label={t('orderDetail.surveyBadge')}
          tone={color.feedback.info}
          testID={`order-survey-mark-${row.id}`}
        />
        {rejected ? (
          <StatusBadge
            icon={Ban}
            label={t('shell.orders.surveyRejected')}
            tone={color.status.order.cancelled}
            testID={`order-survey-rejected-${row.id}`}
          />
        ) : null}
      </View>
      <SurveyTerm expiresAt={survey.expiresAt} rejected={rejected} testID={`order-survey-term-${row.id}`} />
      <Text style={{ ...text.body, color: color.text.secondary }}>{dateText}</Text>
      {unsent === '' ? null : <StatusBadge icon={Clock} label={unsent} tone={color.sync.queued} testID={`order-unsent-${row.id}`} />}
    </>
  );
  return <CardShell id={row.id} label={label} content={content} {...(onOpen === undefined ? {} : { onOpen })} />;
}

/** The shell of a card: a button with a chevron when active, a plain labelled view when not. */
function CardShell({ id, label, content, onOpen }: { id: string; label: string; content: React.ReactNode; onOpen?: (id: string) => void }) {
  if (onOpen !== undefined) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => {
          onOpen(id);
        }}
        testID={`order-row-${id}`}
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
    <View accessible accessibilityLabel={label} testID={`order-row-${id}`} style={box}>
      {content}
    </View>
  );
}

export function OrderCard({ row, onOpen }: { row: OrderRow; onOpen?: (id: string) => void }) {
  const { t } = useTranslation();
  if (row.survey !== null) return <SurveyCard row={row} {...(onOpen === undefined ? {} : { onOpen })} />;
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

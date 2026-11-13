import type { LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Text, View } from 'react-native';
import { formatDateTime } from '../i18n/format';
import type { DetailCustomerView, DetailLocationView, DetailProcessView, JournalItem, OrderDetail } from '../orders/order-detail-model';
import { Ban, Button, CircleAlert, CircleCheck, CirclePause, CircleQuestionMark, Clock, Inbox, StatusBadge, Wrench } from '../ui';
import type { BadgeTone } from '../ui';
import { borderWidth, color, radius, space, text } from '../ui/theme';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Status of a stage -> icon and colours (styleguide § 4.4); a value outside the map is only the "Nieznany status" badge (§ 3.9.1). */
const STAGE: Readonly<Record<string, { icon: LucideIcon; tone: BadgeTone; label: string }>> = {
  todo: { icon: Inbox, tone: color.status.stage.todo, label: 'orderDetail.stageStatus.todo' },
  in_progress: { icon: Wrench, tone: color.status.stage.inProgress, label: 'orderDetail.stageStatus.in_progress' },
  waiting: { icon: CirclePause, tone: color.status.stage.waiting, label: 'orderDetail.stageStatus.waiting' },
  blocked: { icon: Ban, tone: color.status.stage.blocked, label: 'orderDetail.stageStatus.blocked' },
  done: { icon: CircleCheck, tone: color.status.stage.done, label: 'orderDetail.stageStatus.done' },
  not_applicable: { icon: Ban, tone: color.status.stage.notApplicable, label: 'orderDetail.stageStatus.not_applicable' },
};

const CATEGORY: ReadonlyMap<string, string> = new Map([
  ['phone_call', 'orderDetail.category.phone_call'],
  ['meeting', 'orderDetail.category.meeting'],
  ['arrangement', 'orderDetail.category.arrangement'],
  ['site_visit', 'orderDetail.category.site_visit'],
  ['other', 'orderDetail.category.other'],
]);
const KIND: Readonly<Record<JournalItem['kind'], string>> = {
  note: 'orderDetail.kind.note',
  comment: 'orderDetail.kind.comment',
  event: 'orderDetail.kind.event',
};

/** The heading of a section: a heading for the screen reader (AC6). */
export function SectionHeading({ title, testID }: { title: string; testID?: string }) {
  return (
    <Text accessibilityRole="header" style={{ ...text.heading4, color: color.text.primary }} testID={testID}>
      {title}
    </Text>
  );
}

const card = {
  rowGap: space.stack.xs,
  padding: space.inset.md,
  backgroundColor: color.bg.surface,
  borderRadius: radius.card,
  borderWidth: borderWidth.default,
  borderColor: color.border.subtle,
} as const;

/** A label and its value; a missing value leaves no empty label (AC2). */
function Field({ label, value, testID }: { label: string; value: string | null; testID?: string }) {
  if (value === null) return null;
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} testID={testID}>
      <Text style={{ ...text.bodySm, color: color.text.secondary }}>{label}</Text>
      <Text style={{ ...text.body, color: color.text.primary }}>{value}</Text>
    </View>
  );
}

/**
 * "Zadzwoń" (AC2; security K7): hands the sanitised number to the system dialer (`ACTION_DIAL`, no permission to call). A failure
 * is a fixed message - the number and the error are never logged and never shown.
 */
function CallButton({ name, dial }: { name: string; dial: string }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  return (
    <View style={{ rowGap: space.stack.xs }}>
      <Button
        label={t('orderDetail.call')}
        accessibilityLabel={t('orderDetail.callA11y', { name })}
        variant="tertiary"
        onPress={() => {
          setFailed(false);
          Linking.openURL(`tel:${dial}`).catch(() => {
            setFailed(true);
          });
        }}
        testID="order-detail-call"
      />
      {failed ? (
        <Text accessibilityLiveRegion="polite" style={{ ...text.bodySm, color: color.text.error }} testID="order-detail-call-failed">
          {t('orderDetail.callFailed')}
        </Text>
      ) : null}
    </View>
  );
}

export function CustomerCard({ customer }: { customer: DetailCustomerView | null }) {
  const { t } = useTranslation();
  if (customer === null) return null;
  return (
    <View style={card} testID="order-detail-customer">
      <SectionHeading title={t('orderDetail.customer')} />
      <Text style={{ ...text.bodyLg, color: color.text.primary }}>{customer.name}</Text>
      <Field label={t('orderDetail.phone')} value={customer.phone} />
      {customer.dial === null ? null : <CallButton name={customer.name} dial={customer.dial} />}
    </View>
  );
}

export function LocationCard({ location }: { location: DetailLocationView | null }) {
  const { t } = useTranslation();
  if (location === null) return null;
  const address = [location.street, location.city].filter((part): part is string => part !== null).join(', ');
  return (
    <View style={card} testID="order-detail-location">
      <SectionHeading title={t('orderDetail.location')} />
      <Field label={t('orderDetail.address')} value={address === '' ? null : address} />
      <Field label={t('orderDetail.spot')} value={location.spot} />
      <Field label={t('orderDetail.level')} value={location.level} />
      <Field
        label={t('orderDetail.power')}
        value={location.powerKw === null ? null : t('orderDetail.powerValue', { kw: location.powerKw })}
      />
      <Field label={t('orderDetail.operator')} value={location.operator} />
      <Field label={t('orderDetail.manager')} value={location.manager} />
    </View>
  );
}

export function ScopeSection({ scope }: { scope: OrderDetail['scope'] }) {
  const { t } = useTranslation();
  return (
    <View style={card} testID="order-detail-scope">
      <SectionHeading title={t('orderDetail.scope')} />
      {scope.length === 0 ? (
        <Text style={{ ...text.body, color: color.text.secondary }} testID="order-detail-scope-empty">
          {t('orderDetail.scopeEmpty')}
        </Text>
      ) : (
        scope.map((item) => (
          <View key={item.id} style={{ rowGap: space.stack.xs }} accessible testID={`order-detail-scope-${item.id}`}>
            <Text style={{ ...text.body, color: color.text.primary }}>{item.name}</Text>
            {item.quantity === null || item.quantity === 1 ? null : (
              <Text style={{ ...text.bodySm, color: color.text.secondary }}>{t('orderDetail.quantity', { count: item.quantity })}</Text>
            )}
          </View>
        ))
      )}
    </View>
  );
}

function StageRow({ stage, t }: { stage: DetailProcessView['stages'][number]; t: Translate }) {
  const known = Object.hasOwn(STAGE, stage.status) ? STAGE[stage.status] : undefined;
  const label = known === undefined ? t('orderDetail.stageStatus.unknown') : t(known.label);
  const waiting = stage.waitingFor === null ? '' : t('orderDetail.waitingFor', { name: stage.waitingFor });
  return (
    <View
      accessible
      accessibilityLabel={[stage.name, label, waiting].filter((part) => part !== '').join(', ')}
      style={{ rowGap: space.stack.xs }}
      testID={`order-detail-stage-${stage.id}`}
    >
      <Text style={{ ...text.body, color: color.text.primary }}>{stage.name}</Text>
      <StatusBadge icon={known?.icon ?? CircleQuestionMark} label={label} tone={known?.tone ?? color.status.unknown} />
      {waiting === '' ? null : <Text style={{ ...text.bodySm, color: color.text.secondary }}>{waiting}</Text>}
    </View>
  );
}

export function ProcessesSection({ processes }: { processes: readonly DetailProcessView[] }) {
  const { t } = useTranslation();
  return (
    <View style={card} testID="order-detail-processes">
      <SectionHeading title={t('orderDetail.processes')} />
      {processes.length === 0 ? (
        <Text style={{ ...text.body, color: color.text.secondary }} testID="order-detail-processes-empty">
          {t('orderDetail.processesEmpty')}
        </Text>
      ) : (
        processes.map((process) => (
          <View key={process.id} style={{ rowGap: space.stack.sm }} testID={`order-detail-process-${process.id}`}>
            <Text style={{ ...text.label, color: color.text.secondary }}>{process.name}</Text>
            {process.stages.map((stage) => (
              <StageRow key={stage.id} stage={stage} t={t} />
            ))}
          </View>
        ))
      )}
    </View>
  );
}

/**
 * One entry of the journal (AC4; security K8, K9). The text is rendered by `Text` only: no markup, no link detection, not selectable.
 * A redacted entry shows the fixed message whatever the data holds. Items from the queue carry a badge ("Czeka na wysłanie", or
 * "Wymaga uwagi" with the way to the queue).
 */
export function JournalEntry({ item, onOpenQueue }: { item: JournalItem; onOpenQueue: () => void }) {
  const { t } = useTranslation();
  let author = item.author;
  if (author === null) {
    if (item.source !== 'synced') author = t('orderDetail.you');
    else if (item.kind === 'event') author = t('orderDetail.system');
  }
  const categoryKey = CATEGORY.get(String(item.category));
  const category = categoryKey === undefined ? null : t(categoryKey);
  const meta = [t(KIND[item.kind]), category, author, formatDateTime(item.at)].filter(
    (part): part is string => part !== null && part !== '',
  );
  const body = item.redacted ? t('orderDetail.redacted') : item.body;
  return (
    <View style={card} testID={`order-detail-entry-${item.id}`}>
      {item.source === 'pending' ? <StatusBadge icon={Clock} label={t('orderDetail.pending')} tone={color.sync.queued} /> : null}
      {item.source === 'attention' ? <StatusBadge icon={CircleAlert} label={t('orderDetail.attention')} tone={color.sync.error} /> : null}
      <Text style={{ ...text.bodySm, color: color.text.secondary }}>{meta.join(' · ')}</Text>
      {body === null ? null : <Text style={{ ...text.body, color: color.text.primary }}>{body}</Text>}
      {item.source === 'attention' ? (
        <Button
          label={t('orderDetail.goToQueue')}
          variant="tertiary"
          onPress={onOpenQueue}
          testID={`order-detail-entry-queue-${item.id}`}
        />
      ) : null}
    </View>
  );
}

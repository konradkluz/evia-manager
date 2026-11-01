import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import type { HiddenReason } from '../device-guard/hidden-mode';
import type { PatchBanner as PatchLevel } from '../device-guard/patch-level';
import { pluralKey } from '../i18n/plural';
import { Button, EmptyState, InlineAlert, Lock, ShieldOff } from '../ui';
import { color, space, text } from '../ui/theme';

/**
 * Hidden-data notice (EVM-101 AC1, AC2, AC4; M-05): replaces the list of orders. It carries the reason and the one action that
 * fits it; the camera and the queue stay reachable through the navigation (SR-MOB-05). No name, address or content is rendered.
 */
export function HiddenDataNotice({
  reason,
  queueCount,
  onAction,
}: {
  reason: HiddenReason;
  queueCount: number | null;
  onAction: () => void;
}) {
  const { t } = useTranslation();
  const copy = {
    screen_lock_off: {
      title: t('hidden.screenLockOff.title'),
      body: t('hidden.screenLockOff.body'),
      action: t('hidden.screenLockOff.action'),
    },
    contact_expired: {
      title: t('hidden.contactExpired.title'),
      body: t('hidden.contactExpired.body'),
      action: t('hidden.contactExpired.action'),
    },
    clock_anomaly: {
      title: t('hidden.clockAnomaly.title'),
      body: t('hidden.clockAnomaly.body'),
      action: t('hidden.clockAnomaly.action'),
    },
    wipe_in_progress: { title: t('hidden.wipe.title'), body: t('hidden.wipe.body'), action: null },
    checking: { title: t('hidden.checking.title'), body: t('hidden.checking.body'), action: null },
  }[reason];
  const count =
    queueCount === null || queueCount <= 0
      ? null
      : t(pluralKey(queueCount, { one: 'hidden.queueCount_one', few: 'hidden.queueCount_few', many: 'hidden.queueCount_many' }), {
          count: queueCount,
        });
  return (
    <EmptyState
      icon={reason === 'screen_lock_off' ? Lock : ShieldOff}
      title={copy.title}
      description={copy.body}
      testID={`hidden-${reason}`}
      action={
        copy.action === null ? undefined : (
          <Button label={copy.action} onPress={onAction} buttonSize="lg" fullWidth testID="hidden-action" />
        )
      }
    >
      {count === null ? null : (
        <Text style={{ ...text.body, color: color.text.secondary, textAlign: 'center' }} testID="hidden-queue-count">
          {count}
        </Text>
      )}
    </EmptyState>
  );
}

/** Day-5/6 warning (EVM-101 AC2): not dismissible; it disappears after a contact with the server (the guard drops it). */
export function ContactWarningBanner({ daysLeft }: { daysLeft: 1 | 2 }) {
  const { t } = useTranslation();
  return (
    <View style={{ padding: space.inset.md }}>
      <InlineAlert tone="info" body={daysLeft === 2 ? t('contactWarning.days2') : t('contactWarning.days1')} testID="contact-warning" />
    </View>
  );
}

/** Patch-level notice (EVM-101 AC6): never blocks; "Rozumiem" closes it for this session; the older variant is an error tone. */
export function PatchNotice({ level, onAck }: { level: Exclude<PatchLevel, 'none'>; onAck: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={{ padding: space.inset.md }}>
      <InlineAlert
        tone={level === 'strong' ? 'error' : 'info'}
        body={level === 'strong' ? t('patch.strong') : t('patch.notice')}
        testID={`patch-${level}`}
        action={
          <View style={{ alignSelf: 'flex-start' }}>
            <Button label={t('patch.ack')} variant="tertiary" onPress={onAck} testID="patch-ack" />
          </View>
        }
      />
    </View>
  );
}

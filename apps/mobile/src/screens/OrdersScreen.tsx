import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { useStartup } from '../startup';
import { AppBar, Button, ClipboardList, EmptyState, Skeleton } from '../ui';
import { color, space, text } from '../ui/theme';
import { ConnectionNotices } from './ConnectionNotices';
import { ContactWarningBanner, HiddenDataNotice, PatchNotice } from './DeviceNotices';
import { SyncCapsule } from './SyncCapsule';
import { useGuard, useSession } from './session-context';

/**
 * S-01 "Moje zlecenia" (EVM-009 AC1, AC2): the shell renders at once. The skeleton shows only during the first check; offline and
 * server problems never replace the content — the technician keeps working (offline-first).
 */
export function OrdersScreen({ onOpenQueue, onAdd }: { onOpenQueue: () => void; onAdd: () => void }) {
  const { t } = useTranslation();
  const { state, slow } = useStartup();
  const session = useSession();
  const guard = useGuard();
  return (
    <View style={{ flex: 1, backgroundColor: color.bg.canvas }}>
      <AppBar title={t('shell.orders.title')} right={<SyncCapsule onPress={onOpenQueue} />} />
      <ConnectionNotices />
      {guard.warning === null ? null : <ContactWarningBanner daysLeft={guard.warning.daysLeft} />}
      {guard.patch === 'none' ? null : (
        <PatchNotice
          level={guard.patch}
          onAck={() => {
            session.guard.dismissPatch();
          }}
        />
      )}
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        {guard.hidden !== null ? (
          <HiddenDataNotice
            reason={guard.hidden}
            queueCount={null}
            onAction={() => {
              if (guard.hidden === 'screen_lock_off') void session.recheckDevice();
              else void session.reSignIn();
            }}
          />
        ) : state.kind === 'checking' ? (
          <View>
            <Skeleton accessibilityLabel={t('shell.loading.label')} testID="orders-skeleton" />
            {slow ? (
              <View style={{ padding: space.inset.md, rowGap: space.stack.sm }}>
                <Text accessibilityLiveRegion="polite" style={{ ...text.body, color: color.text.secondary }}>
                  {t('shell.loading.slow')}
                </Text>
              </View>
            ) : null}
          </View>
        ) : (
          <EmptyState
            icon={ClipboardList}
            title={t('shell.orders.emptyTitle')}
            description={t('shell.orders.emptyBody')}
            testID="orders-empty"
          />
        )}
      </ScrollView>
      <View style={{ padding: space.inset.md }}>
        <Button label={t('add.open')} onPress={onAdd} buttonSize="lg" fullWidth testID="orders-add" />
      </View>
    </View>
  );
}

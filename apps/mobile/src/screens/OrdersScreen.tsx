import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { useStartup } from '../startup';
import { AppBar, ClipboardList, EmptyState, Skeleton } from '../ui';
import { color, space, text } from '../ui/theme';
import { ConnectionNotices } from './ConnectionNotices';
import { SyncCapsule } from './SyncCapsule';

/**
 * S-01 "Moje zlecenia" (EVM-009 AC1, AC2): the shell renders at once. The skeleton shows only during the first check; offline and
 * server problems never replace the content — the technician keeps working (offline-first).
 */
export function OrdersScreen({ onOpenQueue }: { onOpenQueue: () => void }) {
  const { t } = useTranslation();
  const { state, slow } = useStartup();
  return (
    <View style={{ flex: 1, backgroundColor: color.bg.canvas }}>
      <AppBar title={t('shell.orders.title')} right={<SyncCapsule onPress={onOpenQueue} />} />
      <ConnectionNotices />
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        {state.kind === 'checking' ? (
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
    </View>
  );
}

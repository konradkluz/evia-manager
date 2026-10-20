import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { AppBar, EmptyState, ListChecks } from '../ui';
import { color } from '../ui/theme';
import { ConnectionNotices } from './ConnectionNotices';
import { SyncCapsule } from './SyncCapsule';

/** "Kolejka" (EVM-009 AC1): nothing waits to be sent yet — the queue of uploads arrives with M2 (the capsule opens this screen). */
export function QueueScreen({ onOpenQueue }: { onOpenQueue: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1, backgroundColor: color.bg.canvas }}>
      <AppBar title={t('shell.queue.title')} right={<SyncCapsule onPress={onOpenQueue} />} />
      <ConnectionNotices />
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <EmptyState icon={ListChecks} title={t('shell.queue.emptyTitle')} testID="queue-empty" />
      </ScrollView>
    </View>
  );
}

import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { pluralKey } from '../i18n/plural';
import { AppBar, EmptyState, ListChecks } from '../ui';
import { borderWidth, color, size, space, text } from '../ui/theme';
import { ConnectionNotices } from './ConnectionNotices';
import { SyncCapsule } from './SyncCapsule';
import { useQueueEntries } from './session-context';

/**
 * "Kolejka" (EVM-009 AC1, EVM-101 AC8): the entries waiting to be sent. In the hidden-data mode a row shows its type and state only
 * and the list is headed by a count — never a name, an address or the text of an entry (the rows come from `useQueueEntries`, which
 * does not even request the labels then).
 */
export function QueueScreen({ onOpenQueue }: { onOpenQueue: () => void }) {
  const { t } = useTranslation();
  const { hidden, rows } = useQueueEntries();
  const types: Readonly<Record<string, string>> = {
    CreateNote: t('queue.types.CreateNote'),
    CreateWorkOrder: t('queue.types.CreateWorkOrder'),
  };
  const states: Readonly<Record<string, string>> = {
    pending: t('queue.states.pending'),
    retrying: t('queue.states.retrying'),
    blocked: t('queue.states.blocked'),
    attention: t('queue.states.attention'),
  };
  return (
    <View style={{ flex: 1, backgroundColor: color.bg.canvas }}>
      <AppBar title={t('shell.queue.title')} right={<SyncCapsule onPress={onOpenQueue} />} />
      <ConnectionNotices />
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        {rows === null || rows.length === 0 ? (
          <EmptyState icon={ListChecks} title={t('shell.queue.emptyTitle')} testID="queue-empty" />
        ) : (
          <View style={{ padding: space.inset.md, rowGap: space.stack.sm }} testID={hidden ? 'queue-list-hidden' : 'queue-list'}>
            {hidden ? (
              <Text style={{ ...text.heading4, color: color.text.primary }} testID="queue-hidden-count">
                {t(pluralKey(rows.length, { one: 'hidden.queueCount_one', few: 'hidden.queueCount_few', many: 'hidden.queueCount_many' }), {
                  count: rows.length,
                })}
              </Text>
            ) : null}
            {rows.map((row) => (
              <View
                key={row.id}
                accessible
                accessibilityLabel={[types[row.type] ?? t('queue.types.other'), states[row.state] ?? states['pending'], row.label]
                  .filter((part): part is string => part !== null && part !== undefined)
                  .join(', ')}
                style={{
                  minHeight: size.touchTarget.min,
                  padding: space.inset.sm,
                  borderBottomWidth: borderWidth.default,
                  borderBottomColor: color.border.subtle,
                }}
                testID="queue-row"
              >
                <Text style={{ ...text.labelLg, color: color.text.primary }}>{types[row.type] ?? t('queue.types.other')}</Text>
                <Text style={{ ...text.bodySm, color: color.text.secondary }}>{states[row.state] ?? states['pending']}</Text>
                {row.label === null ? null : <Text style={{ ...text.body, color: color.text.primary }}>{row.label}</Text>}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

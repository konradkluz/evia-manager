import { useTranslation } from 'react-i18next';
import { FlatList, Text, View } from 'react-native';
import type { JournalItem, OrderDetail } from '../orders/order-detail-model';
import { AppBar, Button, EmptyState, Inbox, Skeleton } from '../ui';
import { color, space, text } from '../ui/theme';
import { ConnectionNotices } from './ConnectionNotices';
import { HiddenDataNotice } from './DeviceNotices';
import { OrderStatusBadge } from './OrderCard';
import { CustomerCard, JournalEntry, LocationCard, ProcessesSection, ScopeSection, SectionHeading } from './OrderDetailSections';
import { SyncCapsule } from './SyncCapsule';
import { useOrderDetail } from './order-detail-hooks';
import { useGuard, useSession } from './session-context';

function DetailHeader({ detail }: { detail: OrderDetail }) {
  return (
    <View style={{ rowGap: space.stack.sm }}>
      <View style={{ rowGap: space.stack.xs }} accessible accessibilityRole="header" testID="order-detail-header">
        <Text style={{ ...text.heading3, color: color.text.primary }}>{detail.title}</Text>
      </View>
      <OrderStatusBadge status={detail.status} testID="order-detail-status" />
      <CustomerCard customer={detail.customer} />
      <LocationCard location={detail.location} />
      <ScopeSection scope={detail.scope} />
      <ProcessesSection processes={detail.processes} />
    </View>
  );
}

/**
 * M-03 "Szczegóły zlecenia", the phone version (EVM-104 AC1-AC6): read only, built from the local replica and the queue - never
 * from the server. The only datum in the navigation is the id of the order (held in the state of the shell, never stored).
 * - Hidden-data mode and sign-out: the hook returns `hidden` in the same render and nothing personal is rendered (AC6).
 * - Unavailable (outside the scope, deleted; also while the screen is open): the fixed message and "Wróć do listy"; the queue items
 *   of the order stay where they are (AC5).
 */
export function OrderDetailScreen({ orderId, onBack, onOpenQueue }: { orderId: string; onBack: () => void; onOpenQueue: () => void }) {
  const { t } = useTranslation();
  const session = useSession();
  const guard = useGuard();
  const { state, retry } = useOrderDetail(orderId);

  const content = () => {
    switch (state.kind) {
      case 'hidden':
        return (
          <HiddenDataNotice
            reason={guard.hidden ?? 'checking'}
            queueCount={null}
            onAction={() => {
              if (guard.hidden === 'screen_lock_off') void session.recheckDevice();
              else void session.reSignIn();
            }}
          />
        );
      case 'loading':
        return <Skeleton accessibilityLabel={t('shell.loading.label')} testID="order-detail-skeleton" />;
      case 'error':
        return (
          <EmptyState
            icon={Inbox}
            title={t('orderDetail.loadFailed')}
            testID="order-detail-error"
            action={<Button label={t('shell.retry')} onPress={retry} testID="order-detail-retry" />}
          />
        );
      case 'unavailable':
        return (
          <EmptyState
            icon={Inbox}
            title={t('orderDetail.unavailableBody')}
            testID="order-detail-unavailable"
            action={<Button label={t('orderDetail.backToList')} onPress={onBack} testID="order-detail-unavailable-back" />}
          />
        );
      case 'ready':
        return (
          <FlatList<JournalItem>
            data={state.detail.journal}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <JournalEntry item={item} onOpenQueue={onOpenQueue} />}
            ItemSeparatorComponent={() => <View style={{ height: space.stack.sm }} />}
            ListHeaderComponent={
              <View style={{ rowGap: space.stack.sm, paddingBottom: space.stack.sm }}>
                <DetailHeader detail={state.detail} />
                <SectionHeading title={t('orderDetail.journal')} testID="order-detail-journal-heading" />
              </View>
            }
            ListEmptyComponent={
              <Text style={{ ...text.body, color: color.text.secondary }} testID="order-detail-journal-empty">
                {t('orderDetail.journalEmpty')}
              </Text>
            }
            initialNumToRender={10}
            windowSize={7}
            contentContainerStyle={{ padding: space.inset.md }}
            testID="order-detail-list"
          />
        );
    }
  };

  const title = state.kind === 'ready' ? (state.detail.number ?? t('orderDetail.titleFallback')) : t('orderDetail.titleFallback');
  return (
    <View style={{ flex: 1, backgroundColor: color.bg.canvas }} testID="order-detail">
      <AppBar
        title={title}
        left={
          <Button
            label={t('orderDetail.back')}
            accessibilityLabel={t('orderDetail.backA11y')}
            variant="tertiary"
            inverse
            onPress={onBack}
            testID="order-detail-back"
          />
        }
        right={<SyncCapsule onPress={onOpenQueue} />}
      />
      <ConnectionNotices />
      <View style={{ flex: 1 }}>{content()}</View>
    </View>
  );
}

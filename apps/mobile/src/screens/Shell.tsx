import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, BackHandler, View } from 'react-native';
import { useStartup } from '../startup';
import { BottomNav, ClipboardList, ListChecks } from '../ui';
import { color } from '../ui/theme';
import { OrdersScreen } from './OrdersScreen';
import { QueueScreen } from './QueueScreen';
import { UpdateRequiredScreen } from './UpdateRequiredScreen';

type Tab = 'orders' | 'queue';

/**
 * The app shell (EVM-009 AC1–AC3): two tabs "Moje zlecenia" and "Kolejka" with the bottom navigation, or — only when the server has
 * confirmed an unsupported version — the blocking update screen. Offline and server problems never block (offline-first).
 * Navigation is two tabs of state; a router arrives with the first screens of M2 that need a stack.
 */
export function Shell() {
  const { t } = useTranslation();
  const { state } = useStartup();
  const [tab, setTab] = useState<Tab>('orders');
  const previous = useRef(state.kind);

  // The system "back" from the queue returns to the orders; from the orders it leaves the app (default behaviour).
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (tab === 'queue') {
        setTab('orders');
        return true;
      }
      return false;
    });
    return () => {
      subscription.remove();
    };
  }, [tab]);

  // One polite announcement when the server is reachable again after a problem (styleguide § 5.4, no spam).
  useEffect(() => {
    if (state.kind === 'online' && (previous.current === 'offline' || previous.current === 'serverUnavailable')) {
      AccessibilityInfo.announceForAccessibility(t('shell.reconnected'));
    }
    previous.current = state.kind;
  }, [state.kind, t]);

  if (state.kind === 'updateRequired') {
    return <UpdateRequiredScreen currentVersion={state.currentVersion} requiredVersion={state.requiredVersion} />;
  }
  const openQueue = () => {
    setTab('queue');
  };
  return (
    <View style={{ flex: 1, backgroundColor: color.bg.canvas }}>
      <View style={{ flex: 1 }}>
        {tab === 'orders' ? <OrdersScreen onOpenQueue={openQueue} /> : <QueueScreen onOpenQueue={openQueue} />}
      </View>
      <BottomNav
        accessibilityLabel={t('shell.nav.label')}
        items={[
          {
            key: 'orders',
            label: t('shell.orders.title'),
            icon: ClipboardList,
            selected: tab === 'orders',
            onPress: () => {
              setTab('orders');
            },
            testID: 'nav-orders',
          },
          {
            key: 'queue',
            label: t('shell.queue.title'),
            icon: ListChecks,
            selected: tab === 'queue',
            onPress: openQueue,
            testID: 'nav-queue',
          },
        ]}
      />
    </View>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, BackHandler, View } from 'react-native';
import { useStartup } from '../startup';
import { BottomNav, ClipboardList, Ellipsis, ListChecks } from '../ui';
import { color } from '../ui/theme';
import { MoreScreen, useSignOutFlow } from './MoreScreen';
import { OrdersScreen } from './OrdersScreen';
import { QueueScreen } from './QueueScreen';
import { UpdateRequiredScreen } from './UpdateRequiredScreen';

type Tab = 'orders' | 'queue' | 'more';

/**
 * The app shell (EVM-009 AC1–AC3, EVM-100 AC7): the tabs "Moje zlecenia", "Kolejka" and "Więcej" with the bottom navigation, or —
 * only when the server has confirmed an unsupported version — the blocking update screen. Offline and server problems never block
 * (offline-first). Navigation is tabs of state; a router arrives with the first screens of M2 that need a stack. The sign-out dialog
 * covers the whole window, the navigation included.
 */
export function Shell() {
  const { t } = useTranslation();
  const { state } = useStartup();
  const [tab, setTab] = useState<Tab>('orders');
  const previous = useRef(state.kind);
  const openQueue = useCallback(() => {
    setTab('queue');
  }, []);
  const signOut = useSignOutFlow(openQueue);

  // The system "back" from the queue returns to the orders; from the orders it leaves the app (default behaviour).
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (tab !== 'orders') {
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
  const covered = signOut.dialog !== null;
  return (
    <View style={{ flex: 1, backgroundColor: color.bg.canvas }}>
      {/* while the dialog is open the content behind it is hidden from the screen reader and cannot be touched */}
      <View
        style={{ flex: 1 }}
        accessibilityElementsHidden={covered}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
        pointerEvents={covered ? 'none' : 'auto'}
      >
        <View style={{ flex: 1 }}>
          {tab === 'orders' ? (
            <OrdersScreen onOpenQueue={openQueue} />
          ) : tab === 'queue' ? (
            <QueueScreen onOpenQueue={openQueue} />
          ) : (
            <MoreScreen onOpenQueue={openQueue} onSignOut={signOut.ask} />
          )}
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
            {
              key: 'more',
              label: t('shell.more.title'),
              icon: Ellipsis,
              selected: tab === 'more',
              onPress: () => {
                setTab('more');
              },
              testID: 'nav-more',
            },
          ]}
        />
      </View>
      {signOut.dialog}
    </View>
  );
}

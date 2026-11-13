import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, BackHandler, View } from 'react-native';
import { useStartup } from '../startup';
import { BottomNav, ClipboardList, Ellipsis, ListChecks } from '../ui';
import { color } from '../ui/theme';
import { AddSheet } from './AddSheet';
import { MoreScreen, useSignOutFlow } from './MoreScreen';
import { OrderDetailScreen } from './OrderDetailScreen';
import { OrdersScreen } from './OrdersScreen';
import { QueueScreen } from './QueueScreen';
import { UpdateRequiredScreen } from './UpdateRequiredScreen';
import { WipeDialog } from './WipeDialogs';
import { useGuard, useSession } from './session-context';

type Tab = 'orders' | 'queue' | 'more';

/** "Wyczyść dane firmowe" (EVM-101 AC4): the number of unsent items is read when the dialog opens; the wipe runs after the confirmation. */
function useWipeFlow() {
  const session = useSession();
  const [unsent, setUnsent] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ask = useCallback(() => {
    setFailed(false);
    void session.unsentItemCount().then(setUnsent, () => {
      setUnsent(0);
    });
  }, [session]);
  const dialog =
    unsent === null ? null : (
      <WipeDialog
        unsentItems={unsent}
        busy={busy}
        failed={failed}
        onConfirm={() => {
          setBusy(true);
          void session
            .wipeCompanyData()
            .then((done) => {
              setFailed(!done);
              if (done) setUnsent(null);
            })
            .finally(() => {
              setBusy(false);
            });
        }}
        onCancel={() => {
          setUnsent(null);
        }}
      />
    );
  return { ask, dialog };
}

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
  // The order that is open (EVM-104): the id is the only datum of the navigation; it lives in this state only - never stored, never
  // restored after the process dies (security K6). The list stays mounted under the details (its query and position are kept).
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const closeOrder = useCallback(() => {
    setOpenOrderId(null);
  }, []);
  const openQueue = useCallback(() => {
    setOpenOrderId(null);
    setTab('queue');
  }, []);
  const wipe = useWipeFlow();
  const signOut = useSignOutFlow(openQueue, wipe.ask);
  const session = useSession();
  const guard = useGuard();
  const [adding, setAdding] = useState(false);

  // The system "back" from the queue returns to the orders; from the orders it leaves the app (default behaviour).
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (openOrderId !== null) {
        setOpenOrderId(null);
        return true;
      }
      if (tab !== 'orders') {
        setTab('orders');
        return true;
      }
      return false;
    });
    return () => {
      subscription.remove();
    };
  }, [tab, openOrderId]);

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
  const dialog = wipe.dialog ?? signOut.dialog;
  const covered = dialog !== null || adding;
  const detailOpen = openOrderId !== null;
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
            <View style={{ flex: 1 }}>
              {/* the list stays mounted under the details: its query and position are kept; the screen reader and touch skip it */}
              <View
                style={{ flex: 1 }}
                accessibilityElementsHidden={detailOpen}
                importantForAccessibility={detailOpen ? 'no-hide-descendants' : 'auto'}
                pointerEvents={detailOpen ? 'none' : 'auto'}
              >
                <OrdersScreen
                  onOpenQueue={openQueue}
                  onOpen={setOpenOrderId}
                  onAdd={() => {
                    setAdding(true);
                  }}
                />
              </View>
              {openOrderId !== null ? (
                <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
                  <OrderDetailScreen orderId={openOrderId} onBack={closeOrder} onOpenQueue={openQueue} />
                </View>
              ) : null}
            </View>
          ) : tab === 'queue' ? (
            <QueueScreen onOpenQueue={openQueue} />
          ) : (
            <MoreScreen onOpenQueue={openQueue} onSignOut={signOut.ask} onWipe={wipe.ask} />
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
                setOpenOrderId(null);
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
                setOpenOrderId(null);
                setTab('more');
              },
              testID: 'nav-more',
            },
          ]}
        />
      </View>
      {dialog}
      {adding ? (
        <AddSheet
          hidden={guard.hidden !== null}
          onPick={(target) => {
            setAdding(false);
            session.openAddTarget(target);
          }}
          onClose={() => {
            setAdding(false);
          }}
        />
      ) : null}
    </View>
  );
}

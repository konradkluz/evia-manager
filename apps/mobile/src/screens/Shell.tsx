import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, BackHandler, View } from 'react-native';
import { useStartup } from '../startup';
import { BottomNav, ClipboardList, Ellipsis, ListChecks, Toast } from '../ui';
import { color } from '../ui/theme';
import { AddSheet } from './AddSheet';
import { EntryFormScreen } from './EntryFormScreen';
import { EntryTargetPicker } from './EntryTargetPicker';
import { MoreScreen, useSignOutFlow } from './MoreScreen';
import { OrderDetailScreen } from './OrderDetailScreen';
import { OrdersScreen } from './OrdersScreen';
import { QuickOrderScreen } from './QuickOrderScreen';
import { QueueScreen } from './QueueScreen';
import { UpdateRequiredScreen } from './UpdateRequiredScreen';
import { WipeDialog } from './WipeDialogs';
import { useGuard, useSession } from './session-context';

type Tab = 'orders' | 'queue' | 'more';

/**
 * The forms opened over the shell: the picker of the order and the entry form (EVM-105; the only datum is the id of the order, never the
 * text) and the quick work order form (EVM-106; no datum at all - the typed data live in the state of the form).
 */
type Entry = { readonly stage: 'pick' } | { readonly stage: 'form'; readonly orderId: string } | { readonly stage: 'quick' };

/** The text of the toast hosted by the shell (fixed texts; no data of the user): the key of the catalogue. */
type ToastKey = 'entryForm.saved' | 'quickOrder.saved';

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
  // The entry form (EVM-105): the text lives in the state of the form only, so closing this state drops it (no draft, nothing stored)
  const [entry, setEntry] = useState<Entry | null>(null);
  const [toast, setToast] = useState<ToastKey | null>(null);
  const hidden = guard.hidden !== null;
  const closeEntry = useCallback(() => {
    setEntry(null);
  }, []);
  const dismissSaved = useCallback(() => {
    setToast(null);
  }, []);
  const entrySaved = useCallback(() => {
    setEntry(null);
    setToast('entryForm.saved');
    // a fixed text: no content of the entry and no number of the order (security plan, check 1)
    AccessibilityInfo.announceForAccessibility(t('entryForm.saved'));
  }, [t]);
  // the quick order is saved in the queue: the form closes, the new order opens in its details (the id is the only datum; the number
  // comes after the synchronization); fixed text again - no name, phone or address
  const quickSaved = useCallback(
    (workOrderId: string) => {
      setEntry(null);
      setToast('quickOrder.saved');
      AccessibilityInfo.announceForAccessibility(t('quickOrder.saved'));
      setTab('orders');
      setOpenOrderId(workOrderId);
    },
    [t],
  );
  // the hidden-data mode closes the form and the picker and so drops the typed text (AC4); the render below does not draw them in the
  // same pass either (fail-closed)
  useEffect(() => {
    if (hidden) setEntry(null);
  }, [hidden]);

  // The system "back" from the queue returns to the orders; from the orders it leaves the app (default behaviour).
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // the open entry form handles "back" itself (it asks before dropping a typed text); its handler is registered later, so it is asked first
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
  const shownEntry = hidden ? null : entry;
  const covered = dialog !== null || adding || shownEntry !== null;
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
                  <OrderDetailScreen
                    orderId={openOrderId}
                    onBack={closeOrder}
                    onOpenQueue={openQueue}
                    onAddEntry={() => {
                      setEntry({ stage: 'form', orderId: openOrderId });
                    }}
                  />
                </View>
              ) : null}
            </View>
          ) : tab === 'queue' ? (
            <QueueScreen onOpenQueue={openQueue} />
          ) : (
            <MoreScreen onOpenQueue={openQueue} onSignOut={signOut.ask} onWipe={wipe.ask} />
          )}
          {/* the toast sits at the bottom of the content, right above the navigation; the overlay has the real size of the content
              (a zero-height host would put the toast outside its parent, where Android drops it from the accessibility tree) */}
          {toast !== null ? (
            <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} pointerEvents="none">
              <Toast
                message={t(toast)}
                onDismiss={dismissSaved}
                testID={toast === 'quickOrder.saved' ? 'quick-order-toast' : 'entry-toast'}
              />
            </View>
          ) : null}
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
      {shownEntry?.stage === 'form' ? (
        <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
          <EntryFormScreen orderId={shownEntry.orderId} onClose={closeEntry} onSaved={entrySaved} />
        </View>
      ) : null}
      {shownEntry?.stage === 'quick' ? (
        <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
          <QuickOrderScreen onClose={closeEntry} onSaved={quickSaved} />
        </View>
      ) : null}
      {shownEntry?.stage === 'pick' ? (
        <EntryTargetPicker
          onPick={(orderId) => {
            setEntry({ stage: 'form', orderId });
          }}
          onCancel={closeEntry}
        />
      ) : null}
      {dialog}
      {adding ? (
        <AddSheet
          hidden={guard.hidden !== null}
          onPick={(target) => {
            setAdding(false);
            // defence in depth: the sheet already disables these in the hidden-data mode; no form state is set here either
            if (guard.hidden !== null && (target === 'entry' || target === 'newOrder')) return;
            if (target === 'entry') setEntry({ stage: 'pick' });
            else if (target === 'newOrder') setEntry({ stage: 'quick' });
            else session.openAddTarget(target);
          }}
          onClose={() => {
            setAdding(false);
          }}
        />
      ) : null}
    </View>
  );
}

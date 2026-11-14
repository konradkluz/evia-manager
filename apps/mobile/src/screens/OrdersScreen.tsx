import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Text, View } from 'react-native';
import { formatClock, formatDateTime, sameDay } from '../i18n/format';
import { pluralKey } from '../i18n/plural';
import { filterOrders, unsentCount, type OrderChip, type OrderRow } from '../orders/order-list-model';
import { useStartup } from '../startup';
import { AppBar, Button, ClipboardList, EmptyState, FilterChip, Search, Skeleton, TextField } from '../ui';
import { color, space, text } from '../ui/theme';
import { ConnectionNotices } from './ConnectionNotices';
import { ContactWarningBanner, HiddenDataNotice, PatchNotice } from './DeviceNotices';
import { OrderCard } from './OrderCard';
import { SyncCapsule } from './SyncCapsule';
import { SyncNotices } from './SyncNotices';
import { useOrderList } from './orders-hooks';
import { useGuard, useSession, useSyncSnapshot } from './session-context';

/** The query is limited: it protects the work budget of the search (EVM-103 AC7; security K3). */
export const SEARCH_MAX_LENGTH = 100;
/** The count of the results is announced when the typing has stopped. */
export const ANNOUNCE_AFTER_MS = 700;
/** Data older than this get the time of the last synchronization in the "no results" state. */
const STALE_AFTER_MS = 60 * 60_000;

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "dziś, 14:05" or "02.11.2026, 9:12". */
const syncTime = (at: number, now: number, t: Translate): string =>
  sameDay(at, now) ? t('shell.orders.today', { time: formatClock(at) }) : formatDateTime(at);

const withState = (label: string, selected: boolean, selectedText: string): string => (selected ? `${label}, ${selectedText}` : label);

/** "12 wyników" / "Brak wyników", only while a query is active and after the typing has stopped (the live region of AC2). */
function useAnnouncement(query: string, count: number, t: Translate): string | null {
  const [announced, setAnnounced] = useState<string | null>(null);
  useEffect(() => {
    if (query.trim() === '') {
      setAnnounced(null);
      return undefined;
    }
    const timer = setTimeout(() => {
      setAnnounced(
        count === 0
          ? t('shell.orders.noResults')
          : t(
              pluralKey(count, {
                one: 'shell.orders.resultsCount_one',
                few: 'shell.orders.resultsCount_few',
                many: 'shell.orders.resultsCount_many',
              }),
              {
                count,
              },
            ),
      );
    }, ANNOUNCE_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [query, count, t]);
  return announced;
}

/**
 * S-01 / M-05 "Moje zlecenia" (EVM-009 AC1, AC2; EVM-103 AC1-AC6): the list of the work orders of the phone from the local database
 * (replica and queue; no request to the server), search from one character, the chips "Wszystkie" and "Niewysłane (n)", the empty
 * states of flow 16. The shell renders at once; offline and server problems never replace the content (offline-first).
 * - The query lives only in `useState` of this screen: not in navigation, not in a store, not in a log, not in the restored state
 *   (security K4); it is cleared when the hidden-data mode starts and when the screen goes away.
 * - The hidden-data mode (`guard.hidden !== null`, also while it is being checked) shows no field, no chips and no rows (AC5).
 */
export function OrdersScreen({
  onOpenQueue,
  onAdd,
  onOpen,
  now = Date.now,
}: {
  onOpenQueue: () => void;
  onAdd: () => void;
  /** Opens the details of a work order (EVM-104 AC1); only the id travels. */
  onOpen?: (orderId: string) => void;
  now?: () => number;
}) {
  const { t } = useTranslation();
  const { state, slow } = useStartup();
  const session = useSession();
  const guard = useGuard();
  const snapshot = useSyncSnapshot();
  const rows = useOrderList();
  const hiddenReason = guard.hidden;
  const hidden = hiddenReason !== null;
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<OrderChip>('all');
  // typing is never blocked by the filter: the list follows the field with a deferred value
  const shownQuery = useDeferredValue(query);
  useEffect(() => {
    if (hidden) {
      setQuery('');
      setChip('all');
    }
  }, [hidden]);

  const visible = useMemo(() => (hidden || rows === null ? [] : filterOrders(rows, shownQuery, chip)), [hidden, rows, shownQuery, chip]);
  const unsent = rows === null ? 0 : unsentCount(rows);
  const total = rows?.length ?? 0;
  const searching = shownQuery.trim() !== '';
  const announced = useAnnouncement(hidden ? '' : shownQuery, visible.length, t);

  const offline = state.kind === 'offline' || !snapshot.online;
  const stale = snapshot.lastSuccessAt !== null && now() - snapshot.lastSuccessAt > STALE_AFTER_MS;

  const clear = (): void => {
    setQuery('');
  };

  const noMatch = (
    <EmptyState
      icon={Search}
      title={`${t('shell.orders.noMatchTitle')} „${shownQuery.trim()}”`}
      description={t('shell.orders.noMatchBody')}
      testID="orders-no-match"
      action={<Button label={t('shell.orders.clearSearch')} variant="tertiary" onPress={clear} testID="orders-clear-search" />}
    >
      {offline || stale ? (
        <View style={{ rowGap: space.stack.sm, alignItems: 'center' }} testID="orders-last-sync">
          <Text style={{ ...text.body, color: color.text.secondary, textAlign: 'center' }}>
            {snapshot.lastSuccessAt === null
              ? t('shell.orders.lastSyncUnknown')
              : t('shell.orders.lastSync', { time: syncTime(snapshot.lastSuccessAt, now(), t) })}
          </Text>
          <Button
            label={t('shell.orders.syncNow')}
            variant="tertiary"
            disabled={offline}
            onPress={() => {
              session.sync.trigger();
            }}
            testID="orders-sync-now"
          />
          {offline ? (
            <Text style={{ ...text.bodySm, color: color.text.secondary }} testID="orders-sync-needs-connection">
              {t('shell.orders.needsConnection')}
            </Text>
          ) : null}
        </View>
      ) : null}
    </EmptyState>
  );

  const emptyList =
    chip === 'unsent' && !searching ? (
      <EmptyState icon={ClipboardList} title={t('shell.orders.allSent')} testID="orders-all-sent" />
    ) : (
      noMatch
    );

  const content = () => {
    if (hiddenReason !== null) {
      return (
        <HiddenDataNotice
          reason={hiddenReason}
          queueCount={null}
          onAction={() => {
            if (hiddenReason === 'screen_lock_off') void session.recheckDevice();
            else void session.reSignIn();
          }}
        />
      );
    }
    if (rows === null || (state.kind === 'checking' && total === 0)) {
      return (
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
      );
    }
    if (total === 0) {
      return (
        <EmptyState
          icon={ClipboardList}
          title={t('shell.orders.emptyTitle')}
          description={`${offline ? `${t('shell.orders.offlineNote')} ` : ''}${t('shell.orders.emptyBody')}`}
          testID="orders-empty"
          action={<Button label={t('shell.orders.newOrder')} onPress={onAdd} testID="orders-empty-new" />}
        />
      );
    }
    return (
      <>
        {state.kind === 'checking' && slow ? (
          <View style={{ paddingHorizontal: space.inset.md, paddingTop: space.inset.sm }}>
            <Text accessibilityLiveRegion="polite" style={{ ...text.body, color: color.text.secondary }} testID="orders-slow">
              {t('shell.loading.slow')}
            </Text>
          </View>
        ) : null}
        <View style={{ paddingHorizontal: space.inset.md, paddingTop: space.inset.sm, rowGap: space.stack.sm }}>
          <TextField
            label={t('shell.orders.searchLabel')}
            placeholder={t('shell.orders.searchPlaceholder')}
            value={query}
            onChangeText={setQuery}
            maxLength={SEARCH_MAX_LENGTH}
            search={{ clearLabel: t('shell.orders.clearSearch'), onClear: clear }}
            testID="orders-search"
          />
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={t('shell.orders.filterLabel')}
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.inline.sm }}
          >
            <FilterChip
              label={t('shell.orders.chipAll')}
              accessibilityLabel={withState(t('shell.orders.chipAllA11y'), chip === 'all', t('shell.orders.chipSelected'))}
              selected={chip === 'all'}
              onPress={() => {
                setChip('all');
              }}
              testID="orders-chip-all"
            />
            <FilterChip
              label={t('shell.orders.chipUnsent', { count: unsent })}
              accessibilityLabel={withState(
                t(
                  pluralKey(unsent, {
                    one: 'shell.orders.chipUnsentA11y_one',
                    few: 'shell.orders.chipUnsentA11y_few',
                    many: 'shell.orders.chipUnsentA11y_many',
                  }),
                  { count: unsent },
                ),
                chip === 'unsent',
                t('shell.orders.chipSelected'),
              )}
              selected={chip === 'unsent'}
              onPress={() => {
                setChip('unsent');
              }}
              testID="orders-chip-unsent"
            />
          </View>
          {announced === null ? null : (
            <Text accessibilityLiveRegion="polite" style={{ ...text.bodySm, color: color.text.secondary }} testID="orders-results-count">
              {announced}
            </Text>
          )}
        </View>
        <FlatList<OrderRow>
          data={visible}
          keyExtractor={(row) => row.id}
          renderItem={({ item }) => <OrderCard row={item} onOpen={onOpen} />}
          ItemSeparatorComponent={() => <View style={{ height: space.stack.sm }} />}
          ListEmptyComponent={emptyList}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={10}
          windowSize={7}
          contentContainerStyle={{ flexGrow: 1, padding: space.inset.md }}
          testID="orders-list"
        />
      </>
    );
  };

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
      {hidden ? null : <SyncNotices now={now} />}
      <View style={{ flex: 1 }}>{content()}</View>
      <View style={{ padding: space.inset.md }}>
        <Button label={t('add.open')} onPress={onAdd} buttonSize="lg" fullWidth testID="orders-add" />
      </View>
    </View>
  );
}

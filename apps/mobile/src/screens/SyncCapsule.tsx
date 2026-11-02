import { useTranslation } from 'react-i18next';
import { formatClock } from '../i18n/format';
import { useStartup } from '../startup';
import { SyncIndicator, type SyncState } from '../ui';
import { useSession, useSyncSnapshot } from './session-context';

/**
 * The global sync capsule of the app bar (styleguide § 5.4; EVM-107 AC3, AC8). Stages, strongest first: `Offline · N`, `Błąd · Ponów`,
 * `Synchronizacja…`, `Wymaga uwagi · N`, `Zsynchr. HH:MM` (before the first success: `Połączono`). The accessible name carries the
 * state and the number. A tap starts a cycle (it joins a running one and never skips the wait after a 429) and opens "Kolejka".
 * Hidden while the first check runs.
 */
export function SyncCapsule({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const { state, retry } = useStartup();
  const { sync } = useSession();
  const snapshot = useSyncSnapshot();
  if (state.kind === 'checking') return null;
  const online = state.kind === 'online';
  const { unsent, attention } = snapshot.counts;
  let look: { state: SyncState; label: string; name: string };
  if (!online) {
    look =
      unsent > 0
        ? { state: 'offline', label: t('sync.offlineCount', { count: unsent }), name: t('sync.a11y.offlineCount', { count: unsent }) }
        : { state: 'offline', label: t('shell.sync.offline'), name: t('shell.sync.offlineOpenQueue') };
  } else if (snapshot.failure !== null) {
    look = { state: 'error', label: t('sync.error'), name: t('sync.a11y.error') };
  } else if (snapshot.syncing) {
    look = { state: 'syncing', label: t('sync.syncing'), name: t('sync.a11y.syncing') };
  } else if (attention > 0) {
    look = { state: 'attention', label: t('sync.attention', { count: attention }), name: t('sync.a11y.attention', { count: attention }) };
  } else if (snapshot.lastSuccessAt !== null) {
    const time = formatClock(snapshot.lastSuccessAt);
    look = { state: 'online', label: t('sync.synced', { time }), name: t('sync.a11y.synced', { time }) };
  } else {
    look = { state: 'online', label: t('shell.sync.online'), name: t('shell.sync.onlineOpenQueue') };
  }
  return (
    <SyncIndicator
      state={look.state}
      label={look.label}
      accessibilityLabel={look.name}
      onPress={() => {
        // offline: the tap asks again whether the network is back (the cycle then starts by itself on the state change)
        if (online) sync.trigger();
        else retry();
        onPress();
      }}
      testID="sync-indicator"
    />
  );
}

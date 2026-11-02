import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, View } from 'react-native';
import type { SyncSnapshot } from '../sync/types';
import { useStartup } from '../startup';
import { color } from '../ui/theme';
import { UpdateRequiredScreen } from './UpdateRequiredScreen';
import { FirstPullScreen } from './FirstPullScreen';

/**
 * The gate between the sign-in and the shell (EVM-107 AC1): until the first download has ended the app shows M-12, never a partial
 * list. An account without work orders passes the gate like any other (an empty list is a correct result). While the service starts
 * (a few milliseconds on a restored session) the canvas is empty. The end of the download is announced once.
 */
export function SyncGate({
  snapshot,
  onRetry,
  onHelp,
  children,
}: {
  snapshot: SyncSnapshot;
  onRetry: () => void;
  onHelp: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { state } = useStartup();
  const wasLoading = useRef(false);
  const done = snapshot.initialLoad === 'done';
  const loading = snapshot.active && snapshot.initialLoad !== 'done' && snapshot.initialLoad !== 'pending';
  useEffect(() => {
    if (loading) wasLoading.current = true;
    else if (done && wasLoading.current) {
      wasLoading.current = false;
      AccessibilityInfo.announceForAccessibility(t('firstPull.done'));
    }
  }, [loading, done, t]);
  if (done) return <>{children}</>;
  // a version the server no longer supports is told first: on a fresh install the first download could never start (nothing is lost)
  if (state.kind === 'updateRequired') {
    return <UpdateRequiredScreen currentVersion={state.currentVersion} requiredVersion={state.requiredVersion} />;
  }
  if (!snapshot.active && snapshot.initialLoad === 'pending')
    return <View style={{ flex: 1, backgroundColor: color.bg.canvas }} testID="sync-starting" />;
  return <FirstPullScreen snapshot={snapshot} onRetry={onRetry} onHelp={onHelp} />;
}

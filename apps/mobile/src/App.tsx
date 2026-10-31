import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { E2eHooks } from './e2e-hooks';
import './i18n';
import { LocalDataGate } from './screens/LocalDataScreens';
import type { WipePreparer } from './screens/LocalDataScreens';
import { SessionRoot, type SessionPorts } from './screens/SessionRoot';
import { Shell } from './screens/Shell';
import { sessionPorts } from './session';
import { StartupProvider } from './startup';
import type { StartupChecker } from './startup';
import { localData } from './storage';

/**
 * Root component (EVM-009 AC1, EVM-100). `checker`, `storage` and `session` are injected by tests; the app uses the real health check,
 * the local store and the session of `src/session.ts`. Order: the local-data gate first (an interrupted wipe is finished before any
 * screen with data, EVM-093 AC6), then the startup check, then the session gate (M-01 / M-02 / the shell).
 */
export function App({
  checker,
  storage = localData,
  session = sessionPorts,
}: {
  checker?: StartupChecker;
  storage?: () => WipePreparer;
  session?: () => SessionPorts;
}) {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <LocalDataGate storage={storage}>
        <StartupProvider {...(checker === undefined ? {} : { checker })}>
          <SessionRoot ports={session()}>
            <Shell />
          </SessionRoot>
        </StartupProvider>
      </LocalDataGate>
      {/* empty in every bundle but the e2e variant (Metro resolver, EVM-093) */}
      <E2eHooks />
    </SafeAreaProvider>
  );
}

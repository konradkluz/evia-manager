import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import './i18n';
import { LocalDataGate } from './screens/LocalDataScreens';
import type { WipePreparer } from './screens/LocalDataScreens';
import { Shell } from './screens/Shell';
import { StartupProvider } from './startup';
import type { StartupChecker } from './startup';
import { localData } from './storage';

/**
 * Root component (EVM-009 AC1). `checker` and `storage` are injected by tests; the app uses the real health check and the local store.
 * The local-data gate goes first: an interrupted wipe is finished before any screen with data (EVM-093 AC6).
 */
export function App({ checker, storage = localData }: { checker?: StartupChecker; storage?: () => WipePreparer }) {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <LocalDataGate storage={storage}>
        <StartupProvider {...(checker === undefined ? {} : { checker })}>
          <Shell />
        </StartupProvider>
      </LocalDataGate>
    </SafeAreaProvider>
  );
}

import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import './i18n';
import { Shell } from './screens/Shell';
import { StartupProvider } from './startup';
import type { StartupChecker } from './startup';

/** Root component (EVM-009 AC1). `checker` is injected by tests; the app uses the real health check. */
export function App({ checker }: { checker?: StartupChecker }) {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <StartupProvider {...(checker === undefined ? {} : { checker })}>
        <Shell />
      </StartupProvider>
    </SafeAreaProvider>
  );
}

import { useTranslation } from 'react-i18next';
import { useStartup } from '../startup';
import { SyncIndicator } from '../ui';

/** The global sync capsule of the app bar (styleguide § 5.4); a tap opens "Kolejka". Hidden while the first check runs. */
export function SyncCapsule({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const { state } = useStartup();
  if (state.kind === 'checking') return null;
  const online = state.kind === 'online';
  return (
    <SyncIndicator
      state={online ? 'online' : 'offline'}
      label={online ? t('shell.sync.online') : t('shell.sync.offline')}
      accessibilityLabel={online ? t('shell.sync.onlineOpenQueue') : t('shell.sync.offlineOpenQueue')}
      onPress={onPress}
      testID="sync-indicator"
    />
  );
}

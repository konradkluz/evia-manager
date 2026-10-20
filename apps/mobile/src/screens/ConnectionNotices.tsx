import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useStartup } from '../startup';
import { Button, InlineAlert } from '../ui';
import { space } from '../ui/theme';

/**
 * Connection notices under the app bar (styleguide § 5.4, § 4.9; story UX):
 * - no connection of the device: the offline banner, the work goes on;
 * - a network exists but the server does not answer correctly: "Brak połączenia z serwerem" with "Spróbuj ponownie".
 * Both are polite live regions, announced once when they appear. Nothing is shown while online or checking.
 */
export function ConnectionNotices() {
  const { t } = useTranslation();
  const { state, checking, retry } = useStartup();
  if (state.kind === 'offline') {
    return (
      <View style={{ padding: space.inset.md }}>
        <InlineAlert tone="info" body={t('shell.offlineBanner')} testID="offline-banner" />
      </View>
    );
  }
  if (state.kind === 'serverUnavailable') {
    return (
      <View style={{ padding: space.inset.md }}>
        <InlineAlert
          tone="error"
          title={t('shell.serverUnavailable.title')}
          body={t('shell.serverUnavailable.body')}
          code={state.problem === 'invalid' ? t('shell.errorCode', { code: 'health_invalid' }) : undefined}
          action={<Button variant="tertiary" label={t('shell.retry')} onPress={retry} disabled={checking} testID="retry-server" />}
          testID="server-alert"
        />
      </View>
    );
  }
  return null;
}

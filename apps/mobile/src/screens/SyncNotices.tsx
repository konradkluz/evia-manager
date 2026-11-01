import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { formatClock } from '../i18n/format';
import { pluralKey } from '../i18n/plural';
import { Button, InlineAlert } from '../ui';
import { space } from '../ui/theme';
import { useSession, useSyncSnapshot } from './session-context';

/**
 * Synchronization banners under the connection notices (EVM-107 AC8; flow 16 "SyncIndicator - stany błędów"): a failed push with
 * "nic nie jest tracone" and "Ponów", a failed pull with the time of the data shown, the background refresh ("Lista działa dalej") and
 * the busy server (429). Polite live regions, announced once when they appear. Nothing while offline (the offline banner speaks) or
 * while the first download runs (M-12 speaks).
 */
export function SyncNotices({ now = Date.now }: { now?: () => number }) {
  const { t } = useTranslation();
  const { sync } = useSession();
  const snapshot = useSyncSnapshot();
  if (!snapshot.active || !snapshot.online || snapshot.initialLoad !== 'done' || snapshot.paused !== null) return null;
  const retry = (key: 'sync.notices.retry' | 'sync.notices.retryPull') => (
    <View style={{ alignSelf: 'flex-start' }}>
      <Button
        variant="tertiary"
        label={t(key)}
        onPress={() => {
          sync.trigger();
        }}
        disabled={snapshot.syncing}
        testID="sync-retry"
      />
    </View>
  );
  const notices = [];
  if (snapshot.failure === 'rate_limited') {
    const seconds = Math.max(1, Math.ceil(((snapshot.retryAt ?? now()) - now()) / 1000));
    notices.push(
      <InlineAlert key="rate" tone="error" body={t('sync.notices.rateLimited', { seconds })} testID="sync-notice-rate-limited" />,
    );
  } else if (snapshot.failure === 'push') {
    const count = snapshot.counts.unsent;
    notices.push(
      <InlineAlert
        key="push"
        tone="error"
        body={t(
          pluralKey(count, {
            one: 'sync.notices.pushFailed_one',
            few: 'sync.notices.pushFailed_few',
            many: 'sync.notices.pushFailed_many',
          }),
          { count },
        )}
        action={retry('sync.notices.retry')}
        testID="sync-notice-push"
      />,
    );
  } else if (snapshot.failure === 'pull') {
    notices.push(
      <InlineAlert
        key="pull"
        tone="error"
        body={
          snapshot.lastSuccessAt === null
            ? t('sync.notices.pullFailedNoTime')
            : t('sync.notices.pullFailed', { time: formatClock(snapshot.lastSuccessAt) })
        }
        action={retry('sync.notices.retryPull')}
        testID="sync-notice-pull"
      />,
    );
  }
  if (snapshot.resyncing) {
    notices.push(<InlineAlert key="resync" tone="info" body={t('sync.notices.resync')} testID="sync-notice-resync" />);
  }
  if (notices.length === 0) return null;
  return <View style={{ padding: space.inset.md, rowGap: space.stack.sm }}>{notices}</View>;
}

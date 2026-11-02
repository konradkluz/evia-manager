import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pluralKey } from '../i18n/plural';
import type { FirstPullFailure, SyncSnapshot } from '../sync/types';
import { BottomBar, Button, InlineAlert, ProgressBar, Skeleton } from '../ui';
import { color, space, text } from '../ui/theme';
import { QueuePreviewScreen, useBlockBack, useTitleFocus } from './DeviceStateScreen';

/** After this many failed attempts "Pomoc" appears next to "Spróbuj ponownie" (flow 16, M-12). */
export const HELP_AFTER_ATTEMPTS = 3;

/**
 * M-12 "Przygotowujemy dane" (EVM-107 AC1): the first download after the sign-in. Step and progress (the server announces no total, so
 * the bar is indeterminate), a skeleton instead of a partial list, the weak-signal notice after 30 s, an error with "Spróbuj ponownie"
 * (and "Pomoc" from the third attempt), the queue as a number only. The list is shown only after the download has ended; the system
 * "back" does not leave. The reader is told about a step, a slow connection, an error and the end - never about every page.
 */
export function FirstPullScreen({ snapshot, onRetry, onHelp }: { snapshot: SyncSnapshot; onRetry: () => void; onHelp: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const titleRef = useTitleFocus();
  useBlockBack();
  const errorText: Record<FirstPullFailure, string> = {
    network: t('firstPull.errors.network'),
    rate_limited: t('firstPull.errors.rate_limited'),
    disk_full: t('firstPull.errors.disk_full'),
    storage: t('firstPull.errors.storage'),
    server: t('firstPull.errors.server'),
  };
  const [showQueue, setShowQueue] = useState(false);
  const { firstPull, counts } = snapshot;
  const failed = snapshot.initialLoad === 'failed' && firstPull.failure !== null;
  const lastAnnounced = useRef('');
  const key = failed ? `e:${firstPull.failure}:${String(firstPull.attempts)}` : `s:${String(firstPull.step)}`;
  useEffect(() => {
    if (lastAnnounced.current === key) return;
    lastAnnounced.current = key;
    const message = failed ? errorText[firstPull.failure] : firstPull.step === 1 ? t('firstPull.step1') : t('firstPull.step2');
    AccessibilityInfo.announceForAccessibility(message);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- announced once per key (a step or a failed attempt), not per page
  }, [key]);
  useEffect(() => {
    if (firstPull.slow) AccessibilityInfo.announceForAccessibility(t('firstPull.slow'));
  }, [firstPull.slow, t]);

  if (showQueue) {
    return (
      <QueuePreviewScreen
        unsentItems={counts.unsent}
        onBack={() => {
          setShowQueue(false);
        }}
      />
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: color.bg.canvas, paddingTop: insets.top }} testID="first-pull">
      <StatusBar style="dark" />
      <Text style={{ ...text.labelLg, color: color.text.secondary, padding: space.inset.md }}>{t('shell.appName')}</Text>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space.inset.md, rowGap: space.stack.lg }}>
        <Text ref={titleRef} accessibilityRole="header" style={{ ...text.heading2, color: color.text.primary }} testID="first-pull-title">
          {t('firstPull.title')}
        </Text>
        <View style={{ rowGap: space.stack.sm }}>
          <Text style={{ ...text.labelLg, color: color.text.secondary }}>{t('firstPull.stepLabel', { step: firstPull.step })}</Text>
          <Text style={{ ...text.heading4, color: color.text.primary }} testID="first-pull-step">
            {firstPull.step === 1 ? t('firstPull.step1') : t('firstPull.step2')}
          </Text>
          <ProgressBar
            value={null}
            tone={failed ? 'error' : 'progress'}
            accessibilityLabel={t('firstPull.progressLabel', { count: firstPull.received })}
            testID="first-pull-progress"
          />
          <Text style={{ ...text.body, color: color.text.secondary }} testID="first-pull-received">
            {t('firstPull.received', { count: firstPull.received })}
          </Text>
        </View>
        {failed ? <InlineAlert tone="error" body={errorText[firstPull.failure]} testID="first-pull-error" /> : null}
        {!snapshot.online && !failed ? <InlineAlert tone="info" body={t('firstPull.offline')} testID="first-pull-offline" /> : null}
        {firstPull.slow && !failed ? <InlineAlert tone="info" body={t('firstPull.slow')} testID="first-pull-slow" /> : null}
        <Skeleton accessibilityLabel={t('shell.loading.label')} testID="first-pull-skeleton" />
        {counts.unsent > 0 ? (
          <Button
            variant="tertiary"
            label={t(
              pluralKey(counts.unsent, {
                one: 'firstPull.queueLink_one',
                few: 'firstPull.queueLink_few',
                many: 'firstPull.queueLink_many',
              }),
              { count: counts.unsent },
            )}
            onPress={() => {
              setShowQueue(true);
            }}
            testID="first-pull-queue"
          />
        ) : null}
      </ScrollView>
      {failed ? (
        <BottomBar>
          <Button label={t('firstPull.retry')} onPress={onRetry} buttonSize="lg" fullWidth testID="first-pull-retry" />
          {firstPull.attempts >= HELP_AFTER_ATTEMPTS ? (
            <Button label={t('firstPull.help')} onPress={onHelp} variant="tertiary" fullWidth testID="first-pull-help" />
          ) : null}
        </BottomBar>
      ) : null}
    </View>
  );
}

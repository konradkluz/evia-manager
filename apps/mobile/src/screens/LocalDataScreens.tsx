import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import type { ComponentRef, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, CircleAlert, EmptyState, ListChecks } from '../ui';
import { color, space, text } from '../ui/theme';

function BlockingFrame({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: color.bg.canvas, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <StatusBar style="dark" />
      <Text style={{ ...text.labelLg, color: color.text.secondary, padding: space.inset.md }}>{t('shell.appName')}</Text>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>{children}</ScrollView>
    </View>
  );
}

function useFocus() {
  const ref = useRef<ComponentRef<typeof Text>>(null);
  useEffect(() => {
    if (ref.current !== null) AccessibilityInfo.sendAccessibilityEvent(ref.current, 'focus');
  }, []);
  return ref;
}

/**
 * The one blocking message of EVM-093 AC5 (key lost, key not matching, file damaged): no cause, no number, no content is shown, and the
 * single action "Rozumiem" starts the reset. The cause stays in the diagnostic code only.
 */
export function LocalDataLostScreen({ onAcknowledge }: { onAcknowledge: () => void }) {
  const { t } = useTranslation();
  const titleRef = useFocus();
  return (
    <BlockingFrame>
      <EmptyState
        blocking
        icon={CircleAlert}
        title={t('localData.lostTitle')}
        description={t('localData.lostBody')}
        titleRef={titleRef}
        testID="local-data-lost"
        action={<Button label={t('localData.acknowledge')} onPress={onAcknowledge} buttonSize="lg" testID="local-data-lost-ack" />}
      />
    </BlockingFrame>
  );
}

/** EVM-093 AC6: an interrupted wipe is finished before anything else is shown ("Kończymy czyszczenie…"). */
export function WipingScreen({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation();
  const titleRef = useFocus();
  return (
    <BlockingFrame>
      <EmptyState
        blocking
        icon={ListChecks}
        title={t('localData.wiping')}
        titleRef={titleRef}
        testID="local-data-wiping"
        {...(onRetry === undefined
          ? {}
          : {
              action: (
                <Button
                  label={t('localData.wipingRetry')}
                  onPress={onRetry}
                  variant="tertiary"
                  buttonSize="lg"
                  testID="local-data-wiping-retry"
                />
              ),
            })}
      />
    </BlockingFrame>
  );
}

export interface WipePreparer {
  prepare(onResume?: () => void): Promise<'ready' | 'wipe_incomplete'>;
}

/**
 * Start of the app before sign-in (EVM-093 AC6): finishes an interrupted wipe of company data before any screen with data appears.
 * Without a marker this is one read of a small file and nothing else (no database is created or read before sign-in).
 */
export function LocalDataGate({ storage, children }: { storage: () => WipePreparer; children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'wiping' | 'incomplete' | 'ready'>('checking');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void storage()
      .prepare(() => {
        if (active) setState('wiping');
      })
      .then((result) => {
        if (active) setState(result === 'ready' ? 'ready' : 'incomplete');
      });
    return () => {
      active = false;
    };
  }, [storage, attempt]);
  if (state === 'ready') return <>{children}</>;
  if (state === 'checking') return null;
  return (
    <WipingScreen
      {...(state === 'incomplete'
        ? {
            onRetry: () => {
              setState('wiping');
              setAttempt((n) => n + 1);
            },
          }
        : {})}
    />
  );
}

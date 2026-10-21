import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import type { ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Download, EmptyState } from '../ui';
import { color, space, text } from '../ui/theme';

/**
 * S-02 "Aktualizacja wymagana" (EVM-009 AC3): a blocking empty state (styleguide § 3.15.1) shown only after the server confirmed that
 * this version is no longer supported. No data of work orders is rendered or fetched here; BottomNav and sync capsule are absent.
 * The app is distributed by sideload, so the screen carries no download link and opens no address (phishing, SR-MOB-07): it tells
 * the technician to ask the administrator. The reader focus moves to the title on arrival.
 */
export function UpdateRequiredScreen({ currentVersion, requiredVersion }: { currentVersion: string; requiredVersion: string }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const titleRef = useRef<ComponentRef<typeof Text>>(null);
  useEffect(() => {
    if (titleRef.current !== null) AccessibilityInfo.sendAccessibilityEvent(titleRef.current, 'focus');
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: color.bg.canvas, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <StatusBar style="dark" />
      <Text style={{ ...text.labelLg, color: color.text.secondary, padding: space.inset.md }}>{t('shell.appName')}</Text>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <EmptyState
          blocking
          icon={Download}
          title={t('update.title')}
          description={t('update.body')}
          titleRef={titleRef}
          testID="update-required"
        >
          <Text style={{ ...text.body, color: color.text.primary, textAlign: 'center' }}>{t('update.contact')}</Text>
          <Text style={{ ...text.bodySm, color: color.text.secondary, textAlign: 'center' }} testID="update-versions">
            {t('update.versions', { current: currentVersion, required: requiredVersion })}
          </Text>
        </EmptyState>
      </ScrollView>
    </View>
  );
}

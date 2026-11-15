import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler, View } from 'react-native';
import type { CameraPermissionState } from '../capture/camera-permission';
import { Button, Camera, EmptyState } from '../ui';
import { color, space } from '../ui/theme';

/**
 * The explaining screen of the camera permission (EVM-108 AC3; mock-up 09, table "Uprawnienia systemowe"): shown BEFORE the system prompt and
 * after a refusal; after a permanent refusal only the settings of the phone help ("Otwórz ustawienia"). "Nie teraz" returns to the order; the
 * system "back" does the same. The app asks for the camera only: never the microphone, the location or the storage.
 */
export function CameraPermissionScreen({
  state,
  onAllow,
  onLater,
  onOpenSettings,
}: {
  state: Exclude<CameraPermissionState, 'granted'>;
  onAllow: () => void;
  onLater: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onLater();
      return true;
    });
    return () => {
      subscription.remove();
    };
  }, [onLater]);
  const blocked = state === 'denied_blocked';
  return (
    <View style={{ flex: 1, backgroundColor: color.bg.canvas }} testID="camera-permission">
      {/* a light screen over the dark bar of the app: the icons of the system must be dark here */}
      <StatusBar style="dark" />
      <EmptyState
        icon={Camera}
        title={blocked ? t('camera.permission.blocked') : t('camera.permission.title')}
        description={blocked ? undefined : t('camera.permission.body')}
        blocking
        action={
          <View style={{ alignSelf: 'stretch', rowGap: space.stack.sm }}>
            {blocked ? (
              <Button
                label={t('camera.permission.openSettings')}
                onPress={onOpenSettings}
                buttonSize="lg"
                fullWidth
                testID="camera-open-settings"
              />
            ) : (
              <Button label={t('camera.permission.allow')} onPress={onAllow} buttonSize="lg" fullWidth testID="camera-allow" />
            )}
            <Button label={t('camera.permission.later')} onPress={onLater} variant="tertiary" fullWidth testID="camera-later" />
          </View>
        }
      />
    </View>
  );
}

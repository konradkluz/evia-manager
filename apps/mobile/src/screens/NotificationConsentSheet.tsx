import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import { AlertDialog, Button } from '../ui';
import { color, text } from '../ui/theme';

/**
 * "Powiadomienia o wysyłaniu" (EVM-130 AC6, mock-up 09): the explanation that comes BEFORE the system prompt for notifications
 * (Android 13+). It is shown after the first "Gotowe" with an element in the queue — never in the middle of a series of photos; the
 * caller is EVM-108 (this story only makes it ready to call). "Włącz powiadomienia" leads to the system prompt, "Nie teraz" closes it
 * (the Banner of the Queue stays until the notifications are on). Rendered inside the window like every dialog (FLAG_SECURE).
 */
export function NotificationConsentSheet({ onAllow, onLater }: { onAllow: () => void; onLater: () => void }) {
  const { t } = useTranslation();
  return (
    <AlertDialog
      title={t('upload.notifications.consentTitle')}
      onCancel={onLater}
      testID="notification-consent"
      actions={
        <>
          <Button label={t('upload.notifications.enable')} onPress={onAllow} fullWidth testID="notification-consent-allow" />
          <Button
            label={t('upload.notifications.consentLater')}
            onPress={onLater}
            variant="tertiary"
            fullWidth
            testID="notification-consent-later"
          />
        </>
      }
    >
      <Text style={{ ...text.body, color: color.text.primary }}>{t('upload.notifications.consentBody')}</Text>
    </AlertDialog>
  );
}

import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import { AlertDialog, Button } from '../ui';
import { color, text } from '../ui/theme';

/**
 * The confirmation of "Usuń z telefonu" of a file (EVM-108 AC6): the same dialog in "Kolejka" and in "Pliki zlecenia" (EVM-111 AC4). It says what goes (the
 * picture or film of the phone, never delivered to the office) and nothing about the file or the order.
 */
export function FileDiscardDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <AlertDialog
      title={t('attention.discard.title')}
      onCancel={onCancel}
      actions={
        <>
          <Button variant="danger" label={t('attention.discard.confirm')} onPress={onConfirm} testID="file-discard-confirm" />
          <Button variant="tertiary" label={t('attention.discard.cancel')} onPress={onCancel} testID="file-discard-cancel" />
        </>
      }
      testID="file-discard-dialog"
    >
      <Text style={{ ...text.body, color: color.text.primary }}>{t('upload.discardBody')}</Text>
    </AlertDialog>
  );
}

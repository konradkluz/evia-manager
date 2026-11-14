import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import { AlertDialog, Button } from '../ui';
import { color, text } from '../ui/theme';

export type AddTarget = 'entry' | 'newOrder' | 'media';

/**
 * Sheet "Dodaj" (EVM-101 AC8; M-05): in the hidden-data mode "Wpis" and "Nowe zlecenie" are disabled with a visible reason; "Zdjęcie
 * lub film" stays active (SR-MOB-05). Rendered inside the window like every dialog (FLAG_SECURE).
 */
export function AddSheet({ hidden, onPick, onClose }: { hidden: boolean; onPick: (target: AddTarget) => void; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <AlertDialog
      title={t('add.title')}
      onCancel={onClose}
      testID="add-sheet"
      actions={
        <>
          <Button
            label={t('add.entry')}
            onPress={() => {
              onPick('entry');
            }}
            disabled={hidden}
            fullWidth
            testID="add-entry"
          />
          <Button
            label={t('add.newOrder')}
            onPress={() => {
              onPick('newOrder');
            }}
            disabled={hidden}
            fullWidth
            testID="add-new-order"
          />
          <Button
            label={t('add.media')}
            onPress={() => {
              onPick('media');
            }}
            fullWidth
            testID="add-media"
          />
          <Button label={t('add.close')} onPress={onClose} variant="tertiary" fullWidth testID="add-close" />
        </>
      }
    >
      {hidden ? (
        <>
          <Text style={{ ...text.body, color: color.text.secondary }} testID="add-hidden-reason">
            {t('add.hiddenReason')}
          </Text>
          {/* EVM-106 AC6: the new order form is unavailable in the mode - and what still works */}
          <Text style={{ ...text.body, color: color.text.secondary }} testID="add-hidden-quick">
            {t('quickOrder.hidden')}
          </Text>
        </>
      ) : null}
    </AlertDialog>
  );
}

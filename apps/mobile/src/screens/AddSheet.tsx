import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { AlertDialog, Button } from '../ui';
import { color, space, text } from '../ui/theme';

export type AddTarget = 'siteSurvey' | 'entry' | 'newOrder' | 'media';

/**
 * Sheet "Dodaj" (EVM-101 AC8; M-05): in the hidden-data mode "Wpis" and "Nowe zlecenie" are disabled with a visible reason; "Zdjęcie
 * lub film" stays active (SR-MOB-05). Rendered inside the window like every dialog (FLAG_SECURE).
 */
export function AddSheet({
  hidden,
  surveys,
  onPick,
  onClose,
}: {
  hidden: boolean;
  /** The server allows new site surveys (`features.siteSurveys`; EVM-137 AC1): without it the row is not offered at all. */
  surveys: boolean;
  onPick: (target: AddTarget) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog
      title={t('add.title')}
      onCancel={onClose}
      testID="add-sheet"
      actions={
        <>
          {/* EVM-137 AC1: "Wizja lokalna" is the FIRST action; in the hidden-data mode it stays (it opens the notice of the form) */}
          {surveys ? (
            <View style={{ rowGap: space.stack.xs }}>
              <Button
                label={t('add.siteSurvey')}
                onPress={() => {
                  onPick('siteSurvey');
                }}
                fullWidth
                testID="add-site-survey"
              />
              <Text style={{ ...text.bodySm, color: color.text.secondary }} testID="add-site-survey-hint">
                {t('add.siteSurveyHint')}
              </Text>
            </View>
          ) : null}
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

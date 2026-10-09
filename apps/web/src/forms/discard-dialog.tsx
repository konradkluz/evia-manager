import { Button, Dialog } from '@evia/ui-web';
import { useTranslation } from 'react-i18next';

/** "Odrzucić zmiany?" (README makiet, zasada wspólna 17): asked before a dismissal drops what was typed; "Wróć do edycji" has the focus. */
export function DiscardDialog({
  open,
  onConfirm,
  onBack,
}: {
  readonly open: boolean;
  readonly onConfirm: () => void;
  readonly onBack: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      title={t('forms.discard.title')}
      closeLabel={t('forms.closeDialog')}
      onDismiss={onBack}
      actions={
        <>
          <Button variant="tertiary" onClick={onConfirm}>
            {t('forms.discard.confirm')}
          </Button>
          <Button data-initial-focus onClick={onBack}>
            {t('forms.discard.back')}
          </Button>
        </>
      }
    >
      <p>{t('forms.discard.description')}</p>
    </Dialog>
  );
}

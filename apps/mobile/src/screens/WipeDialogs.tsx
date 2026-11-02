import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import { pluralKey } from '../i18n/plural';
import { AlertDialog, Button } from '../ui';
import { color, text } from '../ui/theme';

/** "Wyczyść dane firmowe" (EVM-101 AC4, M-09): the number of unsent items is the only data shown; the wipe cannot be undone. */
export function WipeDialog({
  unsentItems,
  busy,
  failed,
  onConfirm,
  onCancel,
}: {
  unsentItems: number;
  busy: boolean;
  failed: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const body =
    unsentItems <= 0
      ? t('wipe.none')
      : t(pluralKey(unsentItems, { one: 'wipe.one', few: 'wipe.few', many: 'wipe.many' }), { count: unsentItems });
  return (
    <AlertDialog
      title={t('wipe.title')}
      onCancel={busy ? () => undefined : onCancel}
      testID="wipe-dialog"
      actions={
        <>
          <Button
            label={failed ? t('wipe.retry') : t('wipe.confirm')}
            onPress={onConfirm}
            variant="danger"
            busy={busy}
            fullWidth
            testID="wipe-confirm"
          />
          <Button label={t('wipe.cancel')} onPress={onCancel} variant="tertiary" disabled={busy} fullWidth testID="wipe-cancel" />
        </>
      }
    >
      <Text style={{ ...text.body, color: color.text.primary }} testID="wipe-body">
        {busy ? t('wipe.running') : failed ? t('wipe.failed') : body}
      </Text>
    </AlertDialog>
  );
}

/**
 * Another account's data on the phone (EVM-101 AC5, SR-MOB-13): shows the number of unsent items; "Usuń i zaloguj" is the only way
 * on, "Anuluj" removes nothing.
 */
export function OwnerMismatchDialog({
  unsentItems,
  onConfirm,
  onCancel,
}: {
  unsentItems: number;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const body =
    unsentItems <= 0
      ? t('ownerMismatch.none')
      : t(pluralKey(unsentItems, { one: 'ownerMismatch.one', few: 'ownerMismatch.few', many: 'ownerMismatch.many' }), {
          count: unsentItems,
        });
  return (
    <AlertDialog
      title={t('ownerMismatch.title')}
      onCancel={busy ? () => undefined : onCancel}
      testID="owner-mismatch-dialog"
      actions={
        <>
          <Button
            label={t('ownerMismatch.confirm')}
            onPress={() => {
              setBusy(true);
              void onConfirm().finally(() => {
                setBusy(false);
              });
            }}
            variant="danger"
            busy={busy}
            fullWidth
            testID="owner-mismatch-confirm"
          />
          <Button
            label={t('ownerMismatch.cancel')}
            onPress={onCancel}
            variant="tertiary"
            disabled={busy}
            fullWidth
            testID="owner-mismatch-cancel"
          />
        </>
      }
    >
      <Text style={{ ...text.body, color: color.text.primary }} testID="owner-mismatch-body">
        {body}
      </Text>
    </AlertDialog>
  );
}

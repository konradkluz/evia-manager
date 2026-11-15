import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import type { TargetOption } from '../sync/types';
import { AlertDialog, Button } from '../ui';
import { color, text } from '../ui/theme';
import { useSession } from './session-context';
import { TargetOptionList } from './TargetOptionList';

/** The orders of the dialog are limited like in the move of a rejected entry (a list, not a search; the local search is M-02). */
const MAX_OPTIONS = 20;

/**
 * "Do którego zlecenia?" (EVM-105 AC4): the orders kept on the phone - number and title only, no customer, phone or address - the same
 * read as "Dodaj do innego zlecenia" (`retargetOptions(null)`: the replica of the signed-in user). The id that leaves this component
 * comes from that read and from nowhere else. Not rendered in the hidden-data mode (the shell does not mount it).
 */
export function EntryTargetPicker({ onPick, onCancel }: { onPick: (orderId: string) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const { sync } = useSession();
  const [options, setOptions] = useState<readonly TargetOption[] | null>(null);
  useEffect(() => {
    let active = true;
    sync.retargetOptions(null).then(
      (loaded) => {
        if (active) setOptions(loaded);
      },
      () => {
        if (active) setOptions([]);
      },
    );
    return () => {
      active = false;
    };
  }, [sync]);
  return (
    <AlertDialog
      title={t('entryForm.picker.title')}
      onCancel={onCancel}
      testID="entry-picker"
      actions={<Button variant="tertiary" label={t('entryForm.picker.cancel')} onPress={onCancel} fullWidth testID="entry-picker-cancel" />}
    >
      {options === null ? null : options.length === 0 ? (
        <Text style={{ ...text.body, color: color.text.primary }} testID="entry-picker-empty">
          {t('entryForm.picker.empty')}
        </Text>
      ) : (
        <TargetOptionList options={options.slice(0, MAX_OPTIONS)} onPick={onPick} testIDPrefix="entry-picker" />
      )}
    </AlertDialog>
  );
}

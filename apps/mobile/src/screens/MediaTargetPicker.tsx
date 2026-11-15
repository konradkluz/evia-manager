import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { normalizeSearch } from '../orders/normalize';
import { AlertDialog, Button, TextField } from '../ui';
import { color, space, text } from '../ui/theme';
import { SEARCH_MAX_LENGTH } from './OrdersScreen';
import { TargetOptionList, type OrderChoice } from './TargetOptionList';
import { useGuard, useSession } from './session-context';

/** The list is limited like in the picker of an entry (a list and a search, not a catalogue). */
const MAX_OPTIONS = 20;

/** What was read, and in which mode: a list read in one mode is never shown in the other (fail closed). */
interface Loaded {
  readonly hidden: boolean;
  readonly options: readonly OrderChoice[];
}

/**
 * "Do którego zlecenia?" of the camera (EVM-108 AC5; sheet "Dodaj" -> "Zdjęcie lub film"): the orders of the phone - "Ostatnio otwierane" first, the
 * rest below, a search from one character. The only datum that leaves it is the id of the chosen order (to `session.openCamera`).
 * - Visible data: the number and the title, searched by both (like EVM-105: no customer, no address).
 * - The hidden-data mode (security 17): the list comes from `SyncControl.orderNumbers()` - an id and a number, the title never leaves the data layer -
 *   and the search looks at the number only. When the mode starts while the picker is open, the list read before is dropped in the same render
 *   (the picker draws only a list read in the current mode) and the typed text is cleared; a new list without titles is read.
 * - `recent` are ids of the orders opened in this process (the shell holds them in memory only); an id that is no longer on the phone is not shown.
 */
export function MediaTargetPicker({
  recent,
  onPick,
  onCancel,
}: {
  recent: readonly string[];
  onPick: (orderId: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { sync } = useSession();
  const hidden = useGuard().hidden !== null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let active = true;
    const read: Promise<readonly OrderChoice[]> = hidden ? sync.orderNumbers() : sync.retargetOptions(null);
    read.then(
      (options) => {
        if (active) setLoaded({ hidden, options });
      },
      () => {
        if (active) setLoaded({ hidden, options: [] });
      },
    );
    return () => {
      active = false;
    };
  }, [sync, hidden]);
  // the text typed in the visible mode may be a title: it goes with the mode
  useEffect(() => {
    if (hidden) setQuery('');
  }, [hidden]);

  // defence in depth: even a list that carried titles is cut down to an id and a number in the hidden-data mode
  const options =
    loaded === null || loaded.hidden !== hidden
      ? null
      : hidden
        ? loaded.options.map((option): OrderChoice => ({ id: option.id, number: option.number }))
        : loaded.options;
  const key = normalizeSearch(query).trim();
  const searching = key !== '';
  const matches = (option: OrderChoice): boolean =>
    normalizeSearch(option.number).includes(key) || (!hidden && option.title !== undefined && normalizeSearch(option.title).includes(key));

  const body = () => {
    if (options === null) return null;
    if (options.length === 0) {
      return (
        <Text style={{ ...text.body, color: color.text.primary }} testID="media-picker-empty">
          {t('entryForm.picker.empty')}
        </Text>
      );
    }
    if (searching) {
      const found = options.filter(matches).slice(0, MAX_OPTIONS);
      return found.length === 0 ? (
        <Text style={{ ...text.body, color: color.text.primary }} testID="media-picker-no-match">
          {t('mediaTarget.noMatch')}
        </Text>
      ) : (
        <TargetOptionList options={found} onPick={onPick} testIDPrefix="media-picker" />
      );
    }
    const known = new Map(options.map((option) => [option.id, option]));
    const recently = recent.flatMap((id) => {
      const option = known.get(id);
      return option === undefined ? [] : [option];
    });
    const others = options.filter((option) => !recent.includes(option.id)).slice(0, MAX_OPTIONS);
    return (
      <View style={{ rowGap: space.stack.md }}>
        {recently.length === 0 ? null : (
          <View style={{ rowGap: space.stack.xs }} testID="media-picker-recent">
            <Text accessibilityRole="header" style={{ ...text.heading4, color: color.text.primary }}>
              {t('mediaTarget.recent')}
            </Text>
            <TargetOptionList options={recently} onPick={onPick} testIDPrefix="media-picker" />
          </View>
        )}
        {others.length === 0 ? null : (
          <View style={{ rowGap: space.stack.xs }} testID="media-picker-all">
            {recently.length === 0 ? null : (
              <Text accessibilityRole="header" style={{ ...text.heading4, color: color.text.primary }}>
                {t('mediaTarget.all')}
              </Text>
            )}
            <TargetOptionList options={others} onPick={onPick} testIDPrefix="media-picker" />
          </View>
        )}
      </View>
    );
  };

  return (
    <AlertDialog
      title={t('mediaTarget.title')}
      onCancel={onCancel}
      testID="media-picker"
      actions={<Button variant="tertiary" label={t('mediaTarget.cancel')} onPress={onCancel} fullWidth testID="media-picker-cancel" />}
    >
      {hidden ? (
        <Text style={{ ...text.body, color: color.text.secondary }} testID="media-picker-hidden">
          {t('mediaTarget.hiddenReason')}
        </Text>
      ) : null}
      <TextField
        label={t('mediaTarget.searchLabel')}
        placeholder={hidden ? t('mediaTarget.searchPlaceholderHidden') : t('mediaTarget.searchPlaceholder')}
        value={query}
        onChangeText={setQuery}
        maxLength={SEARCH_MAX_LENGTH}
        search={{
          clearLabel: t('shell.orders.clearSearch'),
          onClear: () => {
            setQuery('');
          },
        }}
        testID="media-picker-search"
      />
      {body()}
    </AlertDialog>
  );
}

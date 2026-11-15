import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '../ui';
import { space } from '../ui/theme';

/** An order a picker offers. The title is OPTIONAL on purpose: the picker of the hidden-data mode never gets one (EVM-108, security 17). */
export interface OrderChoice {
  readonly id: string;
  readonly number: string;
  readonly title?: string;
}

/**
 * The buttons of the orders in a picker ("Do którego zlecenia?" of an entry - EVM-105 - and of the camera - EVM-108): the number and, when there
 * is one, the title; never a customer, a phone or an address. One list for both pickers.
 */
export function TargetOptionList({
  options,
  onPick,
  testIDPrefix,
}: {
  options: readonly OrderChoice[];
  onPick: (orderId: string) => void;
  testIDPrefix: string;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ rowGap: space.stack.xs }}>
      {options.map((option) => (
        <Button
          key={option.id}
          variant="tertiary"
          label={option.title === undefined ? option.number : t('entryForm.picker.option', { number: option.number, title: option.title })}
          onPress={() => {
            onPick(option.id);
          }}
          fullWidth
          testID={`${testIDPrefix}-${option.id}`}
        />
      ))}
    </View>
  );
}

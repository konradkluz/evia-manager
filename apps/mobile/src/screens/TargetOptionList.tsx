import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { formatDate } from '../i18n/format';
import { Button } from '../ui';
import { space } from '../ui/theme';

/** An order a picker offers. The title is OPTIONAL on purpose: the picker of the hidden-data mode never gets one (EVM-108, security 17). */
export interface OrderChoice {
  readonly id: string;
  /** `''` with `survey.awaitingNumber` / `awaitingNumber`: a survey that waits for its number. */
  readonly number: string;
  readonly title?: string;
  /** A site survey (EVM-137), visible mode only: the picker shows the mark and the date instead of a title. */
  readonly survey?: { readonly createdAt: number | null; readonly awaitingNumber: boolean };
  /** The hidden-data mode: only "Oczekuje na numer" is known of a survey that waits. */
  readonly awaitingNumber?: boolean;
}

/** The text of a button of a picker: number and title; a survey: number or "Oczekuje na numer", the mark and the date (never an address or a title). */
function labelOf(option: OrderChoice, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (option.survey !== undefined) {
    return [
      option.survey.awaitingNumber ? t('shell.orders.awaitingNumber') : option.number,
      t('orderDetail.surveyBadge'),
      option.survey.createdAt === null ? '' : t('shell.orders.surveyCreated', { date: formatDate(option.survey.createdAt) }),
    ]
      .filter((part) => part !== '')
      .join(' · ');
  }
  if (option.awaitingNumber === true) return t('shell.orders.awaitingNumber');
  return option.title === undefined ? option.number : t('entryForm.picker.option', { number: option.number, title: option.title });
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
          label={labelOf(option, t)}
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

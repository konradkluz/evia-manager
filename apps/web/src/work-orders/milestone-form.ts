import type { PaymentMilestone } from '@evia/contracts';
import type { PaymentStatusKey } from '@evia/ui-web';
import { useTranslation } from 'react-i18next';
import type { ParsedAmount } from './money.ts';

/** The limit of instalments of one order (EVM-053 AC4, AC8): the 21st is `422 limit_exceeded`; cancelled ones count too. */
export const MILESTONES_MAX = 20;
/** The longest name of an instalment the API accepts (EVM-053 AC4, P5): code points after NFC and trimming. */
export const MILESTONE_NAME_MAX = 120;

/** Control characters and invisible formatting characters are refused by the API (`invalid_characters`); one line only. */
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** The name as the API stores it: NFC and trimmed. */
export const normalizeName = (text: string): string => text.normalize('NFC').trim();

/** What is wrong with a typed name, in the codes of the API — or `undefined` when it may be sent. */
export function nameProblem(text: string): 'required' | 'too_long' | 'invalid_characters' | undefined {
  const name = normalizeName(text);
  if (name === '') return 'required';
  if (CONTROL_CHARACTERS.test(name)) return 'invalid_characters';
  if ((name.match(/./gsu) ?? []).length > MILESTONE_NAME_MAX) return 'too_long';
  return undefined;
}

/** The badge of an instalment (styleguide § 4.4): "Po terminie" replaces "Wystawiona" when the server says so; `undefined` — unknown (P-12). */
export function paymentBadgeKey(milestone: Pick<PaymentMilestone, 'status' | 'isOverdue'>): PaymentStatusKey | undefined {
  switch (milestone.status) {
    case 'planned':
    case 'paid':
    case 'cancelled':
      return milestone.status;
    case 'invoiced':
      return milestone.isOverdue ? 'overdue' : 'invoiced';
    default:
      return undefined;
  }
}

/** The `ETag` of a version for `If-Match`. */
export const etagOf = (version: number): string => `"${String(version)}"`;

/** The message under an amount field for what the parser refused (flows/08 → "Pola i walidacja"); `undefined` — nothing wrong. */
export function useAmountError(): (parsed: ParsedAmount, required: boolean) => string | undefined {
  const { t } = useTranslation();
  return (parsed, required) => {
    switch (parsed.kind) {
      case 'amount':
        return undefined;
      case 'empty':
        return required ? t('workOrder.paymentDialog.amountRequired') : undefined;
      case 'precision':
        return t('workOrder.paymentDialog.amountPrecision');
      case 'tooLarge':
        return t('workOrder.paymentDialog.amountTooLarge');
      case 'invalid':
      case 'notPositive':
        return t('workOrder.paymentDialog.amountRequired');
    }
  };
}

/** The name of an instalment as the table and the dialogs show it: "Zaliczka (20%)", or the name alone without a share. */
export function useMilestoneName(): (milestone: Pick<PaymentMilestone, 'name' | 'sharePercent'>) => string {
  const { t } = useTranslation();
  return (milestone) =>
    milestone.sharePercent === null
      ? milestone.name
      : t('workOrder.payments.nameWithShare', { name: milestone.name, share: milestone.sharePercent });
}

import { Button, Dialog } from '@evia/ui-web';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useOnline } from '../shell/use-online.ts';
import type { PickedCustomer } from './customer-picker.tsx';
import { useCustomerForm } from './use-customer-form.tsx';

export interface AddCustomerDialogProps {
  readonly open: boolean;
  /** Esc, `x`, "Anuluj" and a saved customer; what was typed stays in the memory of the tab unless `discard` is set. */
  readonly onClose: (discard: boolean) => void;
  readonly onCreated: (customer: PickedCustomer) => void;
  /** "Wybierz tego klienta" in the hint "Podobny klient". */
  readonly onPick: (customer: PickedCustomer) => void;
}

/**
 * Dialog "Dodaj klienta" (EVM-020 AC2–AC4, AC8; W-05): the form of `useCustomerForm` in a dialog with "Anuluj" and "Dodaj klienta".
 * What is typed lives in this component only — not in the address, the storage of the browser or a log.
 */
export function AddCustomerDialog({ open, onClose, onCreated, onPick }: AddCustomerDialogProps) {
  const { t } = useTranslation();
  const online = useOnline();
  const formId = useId();
  const form = useCustomerForm({ formId, active: open, onCreated, onPick });
  return (
    <Dialog
      open={open}
      title={t('customers.dialog.title')}
      closeLabel={t('customers.dialog.close')}
      onDismiss={() => {
        onClose(false);
      }}
      actions={
        <>
          <Button
            variant="tertiary"
            onClick={() => {
              form.reset();
              onClose(true);
            }}
          >
            {t('customers.dialog.cancel')}
          </Button>
          <Button type="submit" form={formId} loading={form.pending} disabled={!online}>
            {t('customers.dialog.submit')}
          </Button>
        </>
      }
    >
      {form.element}
    </Dialog>
  );
}

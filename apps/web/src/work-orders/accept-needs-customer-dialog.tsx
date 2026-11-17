import { AlertDialog, Button } from '@evia/ui-web';
import { acceptText } from './site-survey-labels.ts';

/**
 * "Aby zaakceptować, przypisz klienta" (EVM-138 AC4; flows/17): opened by "Zaakceptuj" on a survey without a customer and by the answer
 * `409 customer_required` of the server — one wording for both. "Przypisz klienta" closes this dialog and opens the assignment (one dialog
 * at a time, § 3.13); the focus starts on it.
 */
export function AcceptNeedsCustomerDialog({ onAssign, onClose }: { readonly onAssign: () => void; readonly onClose: () => void }) {
  return (
    <AlertDialog
      open
      title={acceptText.title}
      onDismiss={onClose}
      actions={
        <>
          <Button variant="tertiary" onClick={onClose}>
            {acceptText.cancel}
          </Button>
          <Button data-initial-focus onClick={onAssign}>
            {acceptText.assign}
          </Button>
        </>
      }
    >
      <p>{acceptText.body}</p>
    </AlertDialog>
  );
}

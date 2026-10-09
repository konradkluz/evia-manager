import { Button, Dialog, InlineAlert, Skeleton } from '@evia/ui-web';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The dialog while what it edits is not there yet (EVM-036; W-20 "Stany"): a skeleton of the fields with a status for assistive
 * technology while the current version is read, an alert with "Spróbuj ponownie" when it could not be read, and the alert "Nie
 * znaleziono …" with the way out when it is gone (`404`). Closing (Esc, `x`, "Anuluj") never asks anything: nothing was typed.
 */
export function StateDialog({
  title,
  onClose,
  state,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly state:
    | { readonly kind: 'loading'; readonly text: string }
    | { readonly kind: 'error'; readonly text: string; readonly retryLabel: string; readonly onRetry: () => void }
    | { readonly kind: 'gone'; readonly text: string; readonly actionLabel: string; readonly onAction: () => void };
}) {
  const { t } = useTranslation();
  let body: ReactNode;
  if (state.kind === 'loading') {
    body = (
      <div aria-busy="true" className="flex flex-col gap-stack-sm">
        <p role="status" className="sr-only">
          {state.text}
        </p>
        <Skeleton shape="field" />
        <Skeleton shape="field" />
        <Skeleton />
      </div>
    );
  } else {
    const action = state.kind === 'error' ? state.onRetry : state.onAction;
    body = (
      <InlineAlert
        tone="error"
        action={
          <Button variant="secondary" onClick={action}>
            {state.kind === 'error' ? state.retryLabel : state.actionLabel}
          </Button>
        }
      >
        {state.text}
      </InlineAlert>
    );
  }
  return (
    <Dialog
      open
      title={title}
      closeLabel={t('forms.closeDialog')}
      onDismiss={onClose}
      actions={
        <Button variant="tertiary" onClick={onClose}>
          {t('forms.cancel')}
        </Button>
      }
    >
      {body}
    </Dialog>
  );
}

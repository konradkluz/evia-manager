import { useEffect, useId, useRef, type ReactNode } from 'react';

export interface AlertDialogProps {
  readonly open: boolean;
  readonly title: string;
  /** The content with the time or the reason; announced politely when it changes (`aria-live="polite"`). */
  readonly children: ReactNode;
  /** Buttons of the footer; the one with `data-initial-focus` gets the focus on opening (§ 3.13, § 4.17). */
  readonly actions: ReactNode;
  /** Esc: closes without any other effect (the parent decides what "dismissed" means). */
  readonly onDismiss: () => void;
}

/**
 * AlertDialog (styleguide § 3.13, § 4.17; `size.dialog.width.sm`): a native modal <dialog> with `role="alertdialog"`,
 * so the page behind is inert, focus is trapped inside and returns to the opener on closing. Title and content are tied
 * with `aria-labelledby` / `aria-describedby`. Not animated and without injected styles (CSP `style-src 'self'`).
 */
export function AlertDialog({ open, title, children, actions, onDismiss }: AlertDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const element = dialog.current;
    if (element === null || !open) return;
    element.showModal();
    (element.querySelector<HTMLElement>('[data-initial-focus]') ?? element.querySelector<HTMLElement>('button'))?.focus();
    return () => {
      element.close();
    };
  }, [open]);

  if (!open) return null;
  return (
    <dialog
      ref={dialog}
      role="alertdialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-content`}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      className="m-auto p-inset-lg w-full max-w-dialog-width-sm rounded-dialog shadow-dialog bg-bg-surface text-text-primary backdrop:bg-bg-scrim"
    >
      <div className="flex flex-col gap-stack-md">
        <h2 id={`${id}-title`} className="text-heading-3">
          {title}
        </h2>
        <div id={`${id}-content`} aria-live="polite" className="flex flex-col gap-stack-sm text-body">
          {children}
        </div>
        <div className="flex flex-wrap justify-end gap-inline-sm">{actions}</div>
      </div>
    </dialog>
  );
}

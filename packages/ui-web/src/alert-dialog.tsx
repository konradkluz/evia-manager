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
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    (element.querySelector<HTMLElement>('[data-initial-focus]') ?? element.querySelector<HTMLElement>('button'))?.focus();
    return () => {
      element.close();
      // Browsers differ in when `close()` returns the focus (the focused button of the dialog is already gone): when the
      // focus is not on a real element of the page, put it back where it was before the dialog (WCAG 2.4.3).
      const active = document.activeElement;
      if (opener?.isConnected === true && (active === null || active === document.body || element.contains(active))) opener.focus();
    };
  }, [open]);

  // The <dialog> stays in the DOM while closed: `close()` must run on an attached element, otherwise the browser does not
  // return the focus to the element that had it before `showModal()` (WCAG 2.4.3). Closed, it is not rendered (display none).
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
      {open ? (
        <div className="flex flex-col gap-stack-md">
          <h2 id={`${id}-title`} className="text-heading-3">
            {title}
          </h2>
          <div id={`${id}-content`} aria-live="polite" className="flex flex-col gap-stack-sm text-body">
            {children}
          </div>
          <div className="flex flex-wrap justify-end gap-inline-sm">{actions}</div>
        </div>
      ) : null}
    </dialog>
  );
}

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconButton } from './button.tsx';
import { X } from './icons.ts';

export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  /** Accessible name of the close button `x` (§ 3.13). */
  readonly closeLabel: string;
  readonly children: ReactNode;
  /** Buttons of the footer. */
  readonly actions: ReactNode;
  /** Esc and `x`: the parent decides what dismissing means (closing, or asking "Odrzucić zmiany?"). */
  readonly onDismiss: () => void;
}

const FIRST_FIELD =
  '[data-initial-focus], input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)';

/**
 * Form dialog (styleguide § 3.13; `size.dialog.width.md`): a native modal <dialog>, so the page behind is inert, focus is
 * trapped inside and returns to the opener on closing; the title is its name (`aria-labelledby`). Focus lands on the element
 * marked `data-initial-focus` or on the first text field (a group of radios before it does not take the focus — typing is
 * the next step). Not animated and without injected styles (CSP `style-src 'self'`).
 * The content is rendered only while open — the state of a form lives in the parent, so closing never loses it by itself.
 */
export function Dialog({ open, title, closeLabel, children, actions, onDismiss }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const element = dialog.current;
    if (element === null || !open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    (element.querySelector<HTMLElement>(FIRST_FIELD) ?? element.querySelector<HTMLElement>('button'))?.focus();
    return () => {
      element.close();
      // The focus of the closed dialog may be on an element that is gone: put it back where it was (WCAG 2.4.3).
      const active = document.activeElement;
      if (opener?.isConnected === true && (active === null || active === document.body || element.contains(active))) opener.focus();
    };
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      className="m-auto p-inset-lg w-full max-w-dialog-width-md overflow-hidden open:flex open:flex-col rounded-dialog shadow-dialog bg-bg-surface text-text-primary backdrop:bg-bg-scrim"
    >
      {open ? (
        <div className="flex min-h-0 flex-1 flex-col gap-stack-md">
          <div className="flex items-start justify-between gap-inline-md">
            <h2 id={`${id}-title`} className="text-heading-3">
              {title}
            </h2>
            <IconButton icon={X} label={closeLabel} onClick={onDismiss} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-stack-md overflow-y-auto text-body">{children}</div>
          <div className="flex flex-wrap justify-end gap-inline-sm">{actions}</div>
        </div>
      ) : null}
    </dialog>
  );
}

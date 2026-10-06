import { useEffect, useRef, type MouseEvent } from 'react';
import { X } from './icons.ts';
import { IconButton } from './button.tsx';
import { NavigationList, type LinkComponent, type NavigationItem } from './navigation.tsx';

export interface NavigationDrawerProps {
  readonly open: boolean;
  readonly label: string;
  readonly closeLabel: string;
  readonly items: readonly NavigationItem[];
  readonly link: LinkComponent;
  readonly onClose: () => void;
}

/**
 * Navigation drawer below breakpoint.medium (styleguide 1.3.0 proposal for § 3.17): a native modal <dialog> — the
 * rest of the page is inert, focus moves inside (close button first) and Esc closes it. No animation, so
 * prefers-reduced-motion needs nothing extra; no injected styles (CSP style-src 'self').
 */
export function NavigationDrawer({ open, label, closeLabel, items, link, onClose }: NavigationDrawerProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element === null || !open) return;
    element.showModal();
    element.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      element.close();
    };
  }, [open]);

  if (!open) return null;
  const close = () => {
    dialog.current?.close();
  };
  // A click on the dialog element itself (not on its content) is a click on the backdrop.
  const onBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) close();
  };

  return (
    <dialog
      ref={dialog}
      aria-label={label}
      onClose={onClose}
      onClick={onBackdropClick}
      className="m-0 p-0 border-0 h-full max-h-full w-sidebar-width-expanded max-w-full bg-bg-brand-strong text-text-on-brand backdrop:bg-bg-scrim"
    >
      <div className="flex flex-col">
        <div className="flex justify-end p-inset-sm">
          <IconButton icon={X} label={closeLabel} tone="brand" onClick={close} />
        </div>
        <nav aria-label={label}>
          <NavigationList items={items} link={link} collapsible={false} onNavigate={close} />
        </nav>
      </div>
    </dialog>
  );
}

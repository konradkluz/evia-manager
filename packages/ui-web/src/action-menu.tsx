import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';

export interface ActionMenuItem {
  readonly id: string;
  /** Verb + object; "…" at the end when the item opens a dialog (§ 3.20). */
  readonly label: string;
  readonly onSelect: () => void;
  /** A disabled item stays reachable (`aria-disabled`) and says why (§ 3.20, § 4.13); it does nothing when chosen. */
  readonly disabledHint?: string;
}

/** What the trigger must carry for the menu to work (§ 3.20: `aria-haspopup`, `aria-expanded`, `aria-controls`). */
export interface ActionMenuTriggerProps {
  readonly ref: Ref<HTMLButtonElement>;
  readonly 'aria-haspopup': 'menu';
  readonly 'aria-expanded': boolean;
  readonly 'aria-controls': string | undefined;
  readonly onClick: () => void;
}

export interface ActionMenuProps {
  /** Name of the list, with the object ("Zmień status zlecenia ZL-2026-0042"). */
  readonly label: string;
  readonly items: readonly ActionMenuItem[];
  /** Renders the trigger (an IconButton `⋮` or the StatusBadge as a button) with the props above. */
  readonly trigger: (props: ActionMenuTriggerProps) => ReactNode;
}

/**
 * ActionMenu (styleguide § 3.20, web): the list opens under the trigger; focus goes to the first available item, arrows
 * (with wrap), Home / End and a typed letter move, Enter and Space run an item, Esc and Tab close and return focus to the
 * trigger. A disabled item is announced as unavailable with its reason. The item that was chosen closes the menu and the
 * focus is already on the trigger when `onSelect` runs, so a dialog it opens returns the focus there.
 */
export function ActionMenu({ label, items, trigger }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const entries = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    const first = items.findIndex((item) => item.disabledHint === undefined);
    entries.current[first === -1 ? 0 : first]?.focus();
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
    };
    // The items may change while the menu is open (a refreshed order): the focus is placed only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const focusAt = (index: number) => {
    entries.current[(index + items.length) % items.length]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const current = entries.current.findIndex((entry) => entry === document.activeElement);
    switch (event.key) {
      case 'ArrowDown':
        focusAt(current + 1);
        break;
      case 'ArrowUp':
        focusAt(current - 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(items.length - 1);
        break;
      case 'Escape':
        close();
        break;
      case 'Tab':
        // Focus returns to the trigger and the browser then moves it on to the next element.
        close();
        return;
      default: {
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
        const letter = event.key.toLocaleLowerCase('pl');
        const order = [...items.keys()].map((index) => (current + 1 + index) % items.length);
        const match = order.find((index) => items[index]?.label.toLocaleLowerCase('pl').startsWith(letter));
        if (match === undefined) return;
        focusAt(match);
      }
    }
    event.preventDefault();
  };

  return (
    <div ref={root} className="relative inline-block">
      {trigger({
        ref: button,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? menuId : undefined,
        onClick: () => {
          setOpen((current) => !current);
        },
      })}
      {open ? (
        <ul
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="absolute start-0 top-full z-dropdown w-max max-w-toast-max-width bg-bg-surface border-w-default border-border-default rounded-control shadow-dropdown"
        >
          {items.map((item, index) => (
            <li key={item.id} role="none">
              <button
                ref={(element) => {
                  entries.current[index] = element;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                title={item.disabledHint}
                aria-disabled={item.disabledHint === undefined ? undefined : true}
                aria-describedby={item.disabledHint === undefined ? undefined : `${menuId}-${item.id}-hint`}
                onClick={() => {
                  if (item.disabledHint !== undefined) return;
                  close();
                  item.onSelect();
                }}
                className={
                  item.disabledHint === undefined
                    ? 'flex items-center w-full min-h-control-height-web-md px-inset-sm text-body-sm text-text-primary text-start hover:bg-bg-surface-hover active:bg-bg-surface-pressed focus-visible:focus-ring-inner'
                    : 'flex flex-col items-start justify-center w-full min-h-control-height-web-md px-inset-sm text-body-sm text-text-disabled text-start cursor-not-allowed hover:bg-bg-surface-hover focus-visible:focus-ring-inner'
                }
              >
                {item.label}
                {item.disabledHint === undefined ? null : (
                  <span id={`${menuId}-${item.id}-hint`} className="text-body-sm text-text-secondary">
                    {item.disabledHint}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

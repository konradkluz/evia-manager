import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from './button.tsx';
import { ChevronDown } from './icons.ts';

export interface AccountMenuItem {
  readonly id: string;
  readonly label: string;
  readonly onSelect: () => void;
}

export interface AccountMenuProps {
  /** Text of the trigger (the account's display name). */
  readonly triggerText: string;
  /** Accessible name of the trigger, with the object ("Menu konta: Anna Testowa"). */
  readonly triggerLabel: string;
  readonly items: readonly AccountMenuItem[];
}

/**
 * Account menu of the TopBar (styleguide § 3.17, ActionMenu pattern § 3.20): trigger with `aria-haspopup="menu"` and
 * `aria-expanded`, list `role="menu"`; on open focus goes to the first item, arrows (with wrap), Home / End and typing a
 * letter move, Enter and Space run an item, Esc and Tab close and return focus to the trigger.
 */
export function AccountMenu({ triggerText, triggerLabel, items }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const entries = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    entries.current[0]?.focus();
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
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
        setOpen(false);
        trigger.current?.focus();
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
    <div ref={root} className="relative">
      <Button
        ref={trigger}
        variant="tertiary"
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        {triggerText}
        <ChevronDown aria-hidden="true" className="size-icon-md shrink-0" />
      </Button>
      {open ? (
        <ul
          id={menuId}
          role="menu"
          aria-label={triggerLabel}
          onKeyDown={onKeyDown}
          className="absolute end-0 top-full z-dropdown w-max max-w-toast-max-width bg-bg-surface border-w-default border-border-default rounded-control shadow-dropdown"
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
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className="flex items-center w-full h-control-height-web-md px-inset-sm text-body-sm text-text-primary text-start hover:bg-bg-surface-hover active:bg-bg-surface-pressed focus-visible:focus-ring-inner"
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

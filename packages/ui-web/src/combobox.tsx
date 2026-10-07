import { useId, useState, type ReactNode, type Ref } from 'react';
import { classNames } from './class-names.ts';
import { ChevronDown } from './icons.ts';
import { Skeleton } from './skeleton.tsx';

export interface ComboboxOption {
  readonly id: string;
  readonly label: string;
  /** Second line of the option (e.g. a phone number); rendered as text. */
  readonly description?: string;
}

export interface ComboboxProps {
  /** Always visible (§ 3.3). */
  readonly label: string;
  readonly placeholder?: string;
  /** The text typed into the field; the page decides when it starts a search (the library has no search logic). */
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly options: readonly ComboboxOption[];
  readonly onSelect: (option: ComboboxOption) => void;
  /** Accessible name of the list of options. */
  readonly listLabel: string;
  /** Loading: the popup shows a skeleton of 3 rows (§ 3.3). */
  readonly loading?: boolean;
  /** Content of the popup when there is nothing to choose: "Brak wyników …" with an action, a message about a limit or no connection. */
  readonly notice?: ReactNode;
  /** The text announced politely after a change ("Znaleziono: 2", "Szukamy…"); the field value itself is never announced. */
  readonly announcement?: string;
  readonly hint?: string;
  readonly disabled?: boolean;
  /** Lets the page move the focus into the field (e.g. after "Zmień klienta"). */
  readonly inputRef?: Ref<HTMLInputElement>;
}

/**
 * Combobox with search (styleguide § 3.3; ARIA 1.2 pattern with `aria-activedescendant`): the focus stays in the field,
 * arrows move the active option, Enter chooses it, Esc closes, typing narrows. The popup holds the options, a skeleton of
 * 3 rows while loading, or a `notice` whose buttons are reached with Tab (the popup follows the field in the DOM). It closes
 * when the focus leaves the whole control.
 */
export function Combobox({
  label,
  placeholder,
  value,
  onValueChange,
  options,
  onSelect,
  listLabel,
  loading = false,
  notice,
  announcement,
  hint,
  disabled = false,
  inputRef,
}: ComboboxProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const hasNotice = notice !== undefined && notice !== null && notice !== false;
  const hasList = !loading && options.length > 0;
  const visible = open && !disabled && (loading || hasList || hasNotice);
  const activeId = visible && hasList && active >= 0 && active < options.length ? `${id}-option-${String(active)}` : undefined;

  const choose = (option: ComboboxOption) => {
    setOpen(false);
    setActive(-1);
    onSelect(option);
  };

  return (
    <div
      className="relative flex flex-col gap-stack-xs"
      onBlur={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <label htmlFor={id} className="text-label text-text-primary">
        {label}
      </label>
      <div className="relative flex items-center">
        <input
          id={id}
          ref={inputRef}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          aria-expanded={visible}
          aria-controls={`${id}-popup`}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-describedby={hint === undefined ? undefined : `${id}-hint`}
          onChange={(event) => {
            onValueChange(event.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onFocus={() => {
            if (value !== '') setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              if (visible) {
                event.preventDefault();
                setOpen(false);
                setActive(-1);
              }
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              if (options.length === 0) return;
              const step = event.key === 'ArrowDown' ? 1 : -1;
              setActive((current) =>
                current < 0 ? (step === 1 ? 0 : options.length - 1) : (current + step + options.length) % options.length,
              );
            } else if (event.key === 'Enter' && visible && hasList) {
              const option = options[active];
              if (option !== undefined) {
                event.preventDefault();
                choose(option);
              }
            }
          }}
          className={classNames(
            'w-full h-control-height-web-md ps-inset-sm pe-inset-lg rounded-control text-body text-text-primary placeholder:text-control-placeholder',
            'border-w-default border-border-strong hover:border-border-strong-hover focus-visible:border-border-selected focus-visible:focus-ring',
            'bg-control-bg disabled:bg-control-bg-disabled disabled:border-control-border-disabled disabled:text-text-disabled',
          )}
        />
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute end-inset-sm size-icon-md text-icon-secondary" />
      </div>
      {hint === undefined ? null : (
        <p id={`${id}-hint`} className="text-body-sm text-text-tertiary">
          {hint}
        </p>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {visible ? (
        <div
          id={`${id}-popup`}
          aria-busy={loading || undefined}
          className="absolute inset-x-0 top-full z-dropdown mt-stack-xs flex flex-col bg-bg-surface border-w-default border-border-default rounded-control shadow-dropdown"
        >
          {loading ? (
            <div className="flex flex-col gap-stack-sm p-inset-sm">
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} shape="field" />
              ))}
            </div>
          ) : hasList ? (
            <ul role="listbox" aria-label={listLabel} className="flex flex-col">
              {options.map((option, index) => (
                // Pointer choice; the keyboard works through the focused field (aria-activedescendant).
                <li
                  key={option.id}
                  id={`${id}-option-${String(index)}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => {
                    choose(option);
                  }}
                  className={classNames(
                    'flex min-h-control-height-web-md cursor-pointer flex-col justify-center px-inset-sm text-body text-text-primary hover:bg-bg-surface-hover',
                    index === active ? 'bg-bg-selected' : undefined,
                  )}
                >
                  <span>{option.label}</span>
                  {option.description === undefined ? null : <span className="text-body-sm text-text-secondary">{option.description}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-start gap-stack-sm p-inset-sm text-body text-text-primary">{notice}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

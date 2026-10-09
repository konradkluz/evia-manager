import { useId, type ChangeEventHandler, type Ref } from 'react';
import { IconButton } from './button.tsx';
import { classNames } from './class-names.ts';
import { Search, X } from './icons.ts';

export interface SearchFieldProps {
  /** Always visible (§ 3.7): a placeholder never replaces it. */
  readonly label: string;
  readonly value: string;
  /** Under the field, tied with `aria-describedby`; a disabled field says why here. */
  readonly hint?: string;
  /** Accessible name of the clearing `x` ("Wyczyść frazę"); the `x` is shown only while there is something to clear. */
  readonly clearLabel: string;
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
  readonly inputRef?: Ref<HTMLInputElement>;
}

/**
 * SearchField (styleguide § 3.7): a visible label, the `search` icon, the field and an `x` that clears the phrase and puts
 * the focus back in the field. The phrase is kept by the caller — in the memory of the tab, never in the address (§ 3.7).
 * A disabled field stays focusable (`aria-disabled`) so that the hint can explain the reason (§ 3.1).
 */
export function SearchField({ label, value, hint, clearLabel, disabled = false, onChange, inputRef }: SearchFieldProps) {
  const id = useId();
  const handle: ChangeEventHandler<HTMLInputElement> = (event) => {
    if (!disabled) onChange(event.target.value);
  };
  return (
    <div className="flex flex-col gap-stack-xs">
      <label htmlFor={id} className="text-label text-text-primary">
        {label}
      </label>
      <div
        className={classNames(
          'flex items-center gap-inline-sm min-h-control-height-web-md px-inset-sm rounded-control border-w-default border-border-strong',
          'hover:border-border-strong-hover has-focus-visible:border-border-selected has-focus-visible:focus-ring',
          disabled ? 'bg-control-bg-disabled' : 'bg-control-bg',
        )}
      >
        <Search aria-hidden="true" className="size-icon-md shrink-0 text-icon-secondary" />
        <input
          id={id}
          ref={inputRef}
          type="search"
          value={value}
          autoComplete="off"
          aria-disabled={disabled || undefined}
          aria-describedby={hint === undefined ? undefined : `${id}-hint`}
          onChange={handle}
          className={classNames(
            'min-w-0 flex-1 bg-transparent text-body focus-visible:outline-none',
            '[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden',
            disabled ? 'text-text-disabled' : 'text-text-primary',
          )}
        />
        {value === '' || disabled ? null : (
          <IconButton
            icon={X}
            label={clearLabel}
            onClick={() => {
              onChange('');
              document.getElementById(id)?.focus();
            }}
          />
        )}
      </div>
      {hint === undefined ? null : (
        <p id={`${id}-hint`} className="text-body-sm text-text-tertiary">
          {hint}
        </p>
      )}
    </div>
  );
}

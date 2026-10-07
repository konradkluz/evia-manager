import { useId } from 'react';
import { classNames } from './class-names.ts';
import { ChevronDown } from './icons.ts';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectGroup {
  readonly label: string;
  readonly options: readonly SelectOption[];
}

export interface SelectProps {
  /** Always visible (§ 3.3). */
  readonly label: string;
  readonly value: string;
  /** Plain options and groups (`<optgroup>`); the first plain option is usually "Wszystkie …". */
  readonly options: ReadonlyArray<SelectOption | SelectGroup>;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  /** Explains why the field is disabled (§ 4.13) — tied with `aria-describedby`. */
  readonly hint?: string;
}

const isGroup = (entry: SelectOption | SelectGroup): entry is SelectGroup => 'options' in entry;

/**
 * Select (styleguide § 3.3): the native `<select>` (keyboard, screen readers and touch for free) with a visible label,
 * the control tokens of the text field and a decorative chevron. Groups are `<optgroup>`s.
 */
export function Select({ label, value, options, onChange, disabled = false, hint }: SelectProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-stack-xs">
      <label htmlFor={id} className="text-label text-text-primary">
        {label}
      </label>
      <div className="relative flex items-center">
        <select
          id={id}
          value={value}
          disabled={disabled}
          aria-describedby={hint === undefined ? undefined : `${id}-hint`}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          className={classNames(
            'w-full appearance-none h-control-height-web-md ps-inset-sm pe-inset-lg rounded-control text-body text-text-primary',
            'border-w-default border-border-strong hover:border-border-strong-hover focus-visible:border-border-selected focus-visible:focus-ring',
            'bg-control-bg disabled:bg-control-bg-disabled disabled:border-control-border-disabled disabled:text-text-disabled',
          )}
        >
          {options.map((entry) =>
            isGroup(entry) ? (
              <optgroup key={entry.label} label={entry.label}>
                {entry.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ) : (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ),
          )}
        </select>
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute end-inset-sm size-icon-md text-icon-secondary" />
      </div>
      {hint === undefined ? null : (
        <p id={`${id}-hint`} className="text-body-sm text-text-tertiary">
          {hint}
        </p>
      )}
    </div>
  );
}

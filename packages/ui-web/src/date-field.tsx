import { useId } from 'react';
import { classNames } from './class-names.ts';
import { CircleAlert } from './icons.ts';

export interface DateFieldProps {
  readonly label: string;
  /** `YYYY-MM-DD` (the value of the native date input) or an empty string; the browser shows it in the language of the system. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly min?: string;
  readonly max?: string;
  readonly disabled?: boolean;
  /** Help under the field ("Nie później niż dziś."), tied to the input; replaced by the error. */
  readonly hint?: string;
  /** Error under the field (`circle-alert` + `color.text.error`, announced as an alert). */
  readonly error?: string;
}

/**
 * Date field (styleguide § 3.5, variant "data"): the native date input — typing and the calendar of the platform, tied
 * to a visible label. A range is two of them ("Od", "Do"); the page validates the order and the length of the range.
 */
export function DateField({ label, value, onChange, min, max, disabled = false, hint, error }: DateFieldProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-stack-xs">
      <label htmlFor={id} className="text-label text-text-primary">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? (hint === undefined ? undefined : `${id}-hint`) : `${id}-error`}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className={classNames(
          'w-full h-control-height-web-md px-inset-sm rounded-control text-body text-text-primary bg-control-bg focus-visible:focus-ring',
          'disabled:bg-control-bg-disabled disabled:border-control-border-disabled disabled:text-text-disabled',
          error === undefined
            ? 'border-w-default border-border-strong hover:border-border-strong-hover focus-visible:border-border-selected'
            : 'border-w-strong border-border-error',
        )}
      />
      {error === undefined ? (
        hint === undefined ? null : (
          <p id={`${id}-hint`} className="text-body-sm text-text-tertiary">
            {hint}
          </p>
        )
      ) : (
        <p id={`${id}-error`} role="alert" className="flex items-start gap-inline-sm text-body-sm text-text-error">
          <CircleAlert aria-hidden="true" className="size-icon-sm shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

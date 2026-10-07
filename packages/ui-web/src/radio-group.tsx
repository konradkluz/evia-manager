import { useId } from 'react';
import { CircleAlert } from './icons.ts';

export interface RadioOption {
  readonly value: string;
  readonly label: string;
}

export interface RadioGroupProps {
  /** The legend of the `fieldset` (§ 3.4: a group always has one). */
  readonly legend: string;
  readonly options: readonly RadioOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  /** Message under the group (`color.text.error` + `circle-alert`). */
  readonly error?: string;
}

/**
 * Radio group (styleguide § 3.4): a `fieldset` with a legend, native radios (arrows move the choice), the label on the right
 * and the whole row clickable (min. `size.touch-target.min` high). The checked colour is `color.control.checked`.
 */
export function RadioGroup({ legend, options, value, onChange, disabled = false, error }: RadioGroupProps) {
  const name = useId();
  return (
    <fieldset
      className="flex flex-col gap-stack-xs"
      disabled={disabled}
      aria-describedby={error === undefined ? undefined : `${name}-error`}
    >
      <legend className="text-label text-text-primary">{legend}</legend>
      <div className="flex flex-wrap gap-x-inline-md">
        {options.map((option) => (
          <label key={option.value} className="flex min-h-touch-target-min items-center gap-inline-sm text-body text-text-primary">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => {
                onChange(option.value);
              }}
              className="size-icon-md accent-control-checked focus-visible:focus-ring"
            />
            {option.label}
          </label>
        ))}
      </div>
      {error === undefined ? null : (
        <p id={`${name}-error`} role="alert" className="flex items-start gap-inline-sm text-body-sm text-text-error">
          <CircleAlert aria-hidden="true" className="size-icon-sm shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </fieldset>
  );
}

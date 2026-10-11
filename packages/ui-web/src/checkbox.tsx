import { useId, type ReactNode } from 'react';

export interface CheckboxProps {
  /** The label on the right; the whole row is clickable (§ 3.4). May carry a second line of text (e.g. a count). */
  readonly label: ReactNode;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  /** Extra line under the label, tied with `aria-describedby`. */
  readonly description?: string;
}

/**
 * Checkbox (styleguide § 3.4): a native `<input type="checkbox">` with the label on the right and the whole row clickable
 * (min. `size.touch-target.min` high). A group of checkboxes sits in a `fieldset` with a legend, written by the page. The checked
 * colour is `color.control.checked`; the state is never carried by colour only (the native mark).
 */
export function Checkbox({ label, checked, onChange, disabled = false, description }: CheckboxProps) {
  const id = useId();
  return (
    <label className="flex min-h-touch-target-min items-start gap-inline-sm py-stack-xs text-body text-text-primary">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={description === undefined ? undefined : `${id}-description`}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        className="mt-stack-xs size-icon-md shrink-0 accent-control-checked focus-visible:focus-ring"
      />
      <span className="flex flex-col">
        <span>{label}</span>
        {description === undefined ? null : (
          <span id={`${id}-description`} className="text-body-sm text-text-secondary">
            {description}
          </span>
        )}
      </span>
    </label>
  );
}

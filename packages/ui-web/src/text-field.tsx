import { useId, useState, type ChangeEventHandler, type FocusEventHandler, type Ref } from 'react';
import { Button } from './button.tsx';
import { classNames } from './class-names.ts';
import { CircleAlert } from './icons.ts';

export interface TextFieldProps {
  /** Always visible; a placeholder never replaces it (§ 3.2). */
  readonly label: string;
  readonly value: string;
  readonly type?: 'text' | 'email' | 'password' | 'tel';
  readonly name?: string;
  readonly autoComplete?: string;
  /** Read-only: no outline, primary text; the value stays in the form (password managers pair it with the password). */
  readonly readOnly?: boolean;
  readonly hint?: string;
  /** Error under the field (`circle-alert` + `color.text.error`, announced as an alert); replaces the hint. */
  readonly error?: string;
  /** Texts of the show/hide button of a password field. */
  readonly reveal?: { readonly show: string; readonly hide: string };
  readonly disabled?: boolean;
  /** Unit after the field ("kW", "zł"; § 3.2 numeric variant): visible text read as a part of the description of the field. */
  readonly suffix?: string;
  /** Keyboard of a touch device for numbers (`decimal`) without changing the field into `type="number"`. */
  readonly inputMode?: 'decimal' | 'numeric' | 'tel' | 'email';
  readonly onChange?: ChangeEventHandler<HTMLInputElement>;
  readonly onBlur?: FocusEventHandler<HTMLInputElement>;
  readonly inputRef?: Ref<HTMLInputElement>;
}

/**
 * Text field (styleguide § 3.2): label above, field, hint or error below; password variant with show/hide; read-only
 * variant. Colour is never the only signal of an error (icon + text), the hint and the error are tied with `aria-describedby`.
 */
export function TextField({
  label,
  value,
  type = 'text',
  name,
  autoComplete,
  readOnly = false,
  hint,
  error,
  reveal,
  disabled = false,
  suffix,
  inputMode,
  onChange,
  onBlur,
  inputRef,
}: TextFieldProps) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  const message = error === undefined ? (hint === undefined ? undefined : `${id}-hint`) : `${id}-error`;
  const describedBy =
    [suffix === undefined ? undefined : `${id}-suffix`, message].filter((part) => part !== undefined).join(' ') || undefined;
  const isPassword = type === 'password';
  const border = readOnly
    ? 'border-0 px-0'
    : error === undefined
      ? 'border-w-default border-border-strong hover:border-border-strong-hover focus-visible:border-border-selected px-inset-sm'
      : 'border-w-strong border-border-error px-inset-sm';
  return (
    <div className="flex flex-col gap-stack-xs">
      <label htmlFor={id} className="text-label text-text-primary">
        {label}
      </label>
      <div className="flex items-center gap-inline-sm">
        <input
          id={id}
          ref={inputRef}
          name={name}
          type={isPassword && revealed ? 'text' : type}
          value={value}
          autoComplete={autoComplete}
          inputMode={inputMode}
          readOnly={readOnly}
          disabled={disabled}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy}
          onChange={onChange}
          onBlur={onBlur}
          className={classNames(
            'min-w-0 flex-1 h-control-height-web-md rounded-control text-body text-text-primary placeholder:text-control-placeholder focus-visible:focus-ring',
            readOnly
              ? 'bg-transparent'
              : 'bg-control-bg disabled:bg-control-bg-disabled disabled:border-control-border-disabled disabled:text-text-disabled',
            border,
          )}
        />
        {suffix === undefined ? null : (
          <span id={`${id}-suffix`} className="text-body text-text-secondary">
            {suffix}
          </span>
        )}
        {isPassword && reveal ? (
          <Button
            variant="tertiary"
            onClick={() => {
              setRevealed((current) => !current);
            }}
          >
            {revealed ? reveal.hide : reveal.show}
          </Button>
        ) : null}
      </div>
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

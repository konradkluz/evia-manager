import { useId, type ChangeEventHandler, type FocusEventHandler, type Ref } from 'react';
import { classNames } from './class-names.ts';
import { CircleAlert } from './icons.ts';

export interface TextAreaProps {
  /** Always visible (§ 3.2). */
  readonly label: string;
  readonly value: string;
  readonly name?: string;
  readonly rows?: number;
  readonly hint?: string;
  /** Error under the field (`circle-alert` + `color.text.error`, announced as an alert); replaces the hint. */
  readonly error?: string;
  readonly disabled?: boolean;
  readonly onChange?: ChangeEventHandler<HTMLTextAreaElement>;
  readonly onBlur?: FocusEventHandler<HTMLTextAreaElement>;
  readonly inputRef?: Ref<HTMLTextAreaElement>;
}

/**
 * Multi-line text field (styleguide § 3.2): the same label, hint and error as `TextField`, the tokens of the control.
 * The height follows `rows`; the field does not grow by itself (the longest note has a fixed limit on the server).
 */
export function TextArea({ label, value, name, rows = 3, hint, error, disabled = false, onChange, onBlur, inputRef }: TextAreaProps) {
  const id = useId();
  const describedBy = error === undefined ? (hint === undefined ? undefined : `${id}-hint`) : `${id}-error`;
  return (
    <div className="flex flex-col gap-stack-xs">
      <label htmlFor={id} className="text-label text-text-primary">
        {label}
      </label>
      <textarea
        id={id}
        ref={inputRef}
        name={name}
        rows={rows}
        value={value}
        disabled={disabled}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy}
        onChange={onChange}
        onBlur={onBlur}
        className={classNames(
          'w-full min-w-0 py-inset-sm px-inset-sm rounded-control text-body text-text-primary placeholder:text-control-placeholder focus-visible:focus-ring',
          'bg-control-bg disabled:bg-control-bg-disabled disabled:border-control-border-disabled disabled:text-text-disabled',
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

import { useId, type Ref } from 'react';
import { classNames } from './class-names.ts';
import { CircleAlert } from './icons.ts';

export interface SelectableCardOption {
  readonly value: string;
  /** Title of the option (`text.label-lg`). */
  readonly title: string;
  /** Description under the title (counts, § 3.22); an option without one is a plain radio row ("Puste zlecenie"). */
  readonly description?: string;
}

export interface SelectableCardGroupProps {
  /** The legend of the `fieldset` (§ 3.22: a group always has one). */
  readonly legend: string;
  readonly options: readonly SelectableCardOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Message under the group (`color.text.error` + `circle-alert`), announced as an alert. */
  readonly error?: string;
  /** Lets the page move the focus into the group (the first radio), e.g. from the error summary. */
  readonly firstRadioRef?: Ref<HTMLInputElement>;
}

/**
 * Selectable card group (styleguide § 3.22, P-3): a `fieldset` with a legend, every option a native radio whose label
 * is the whole card (title and description are the name of the radio); arrows move the choice like in any radio group.
 * The chosen card has the outline `border-width.indicator` in `color.border.selected`, the checked radio and the
 * `color.bg.selected` background — the state is never carried by the background alone. The focus ring surrounds the card.
 */
export function SelectableCardGroup({ legend, options, value, onChange, error, firstRadioRef }: SelectableCardGroupProps) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-stack-sm" aria-describedby={error === undefined ? undefined : `${name}-error`}>
      <legend className="mb-stack-xs text-label text-text-primary">{legend}</legend>
      {options.map((option, index) => {
        const checked = option.value === value;
        const radio = (
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={checked}
            ref={index === 0 ? firstRadioRef : undefined}
            onChange={() => {
              onChange(option.value);
            }}
            className="mt-stack-xs size-icon-md shrink-0 accent-control-checked"
          />
        );
        if (option.description === undefined) {
          return (
            <label key={option.value} className="flex min-h-touch-target-min items-center gap-inline-sm text-body text-text-primary">
              {radio}
              {option.title}
            </label>
          );
        }
        return (
          <label
            key={option.value}
            className={classNames(
              'flex cursor-pointer items-start gap-inline-md p-inset-md rounded-card text-text-primary',
              'has-focus-visible:focus-ring hover:shadow-card active:bg-bg-surface-pressed',
              checked ? 'bg-bg-selected border-w-indicator border-border-selected' : 'bg-bg-surface border-w-default border-border-default',
            )}
          >
            {radio}
            <span className="flex flex-col gap-stack-xs">
              <span className="text-label-lg">{option.title}</span>{' '}
              <span className="text-body-sm text-text-secondary">{option.description}</span>
            </span>
          </label>
        );
      })}
      {error === undefined ? null : <FieldError id={`${name}-error`}>{error}</FieldError>}
    </fieldset>
  );
}

/** The error line of a field or a group (§ 3.2): `circle-alert` + `color.text.error`, announced as an alert. */
export function FieldError({ id, children }: { readonly id?: string; readonly children: string }) {
  return (
    <p id={id} role="alert" className="flex items-start gap-inline-sm text-body-sm text-text-error">
      <CircleAlert aria-hidden="true" className="size-icon-sm shrink-0" />
      <span>{children}</span>
    </p>
  );
}

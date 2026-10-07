import { classNames } from './class-names.ts';
import { Check, X } from './icons.ts';

export interface FilterChipProps {
  readonly label: string;
  /** `choice`: a toggle button (a quick range; selected = `aria-pressed`). `active`: a filter in force with an `x`. */
  readonly variant: 'choice' | 'active';
  readonly selected?: boolean;
  readonly disabled?: boolean;
  /** Accessible name of the remove button of an `active` chip ("Usuń filtr …"). */
  readonly removeLabel?: string;
  readonly onClick: () => void;
}

const BASE =
  'inline-flex items-center gap-inline-sm h-control-height-web-sm px-inset-sm rounded-pill text-label text-text-primary border-w-default focus-visible:focus-ring aria-disabled:text-text-disabled';

/**
 * FilterChip (styleguide § 3.7): the chip of a filter — `choice` (default outline, selected: `color.bg.selected` +
 * `color.border.selected` + the `check` icon, so the selection is not carried by colour alone) and `active` (a filter
 * in force with an `x` that removes it). Disabled stays focusable (`aria-disabled`).
 */
export function FilterChip({ label, variant, selected = false, disabled = false, removeLabel, onClick }: FilterChipProps) {
  const handle = () => {
    if (!disabled) onClick();
  };
  if (variant === 'active') {
    return (
      <button
        type="button"
        aria-label={removeLabel}
        aria-disabled={disabled || undefined}
        onClick={handle}
        className={classNames(BASE, 'border-border-selected bg-bg-selected')}
      >
        <span>{label}</span>
        <X aria-hidden="true" className="size-icon-sm shrink-0" />
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-disabled={disabled || undefined}
      onClick={handle}
      className={classNames(BASE, selected ? 'border-border-selected bg-bg-selected' : 'border-border-strong hover:bg-bg-surface-hover')}
    >
      {selected ? <Check aria-hidden="true" className="size-icon-sm shrink-0" /> : null}
      {label}
    </button>
  );
}

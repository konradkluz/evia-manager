import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react';
import { classNames } from './class-names.ts';
import { LoaderCircle, type Icon } from './icons.ts';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'disabled'> {
  readonly children: ReactNode;
  /** Variants of styleguide § 3.1 used so far: primary (one per view), secondary (outline), tertiary (text). */
  readonly variant?: 'primary' | 'secondary' | 'tertiary';
  /** md is the default, lg is the main action of a card form (W-13). */
  readonly size?: 'md' | 'lg';
  /** Leading icon; replaced by the loading icon while `loading`. */
  readonly icon?: Icon;
  /** Loading: loader-circle instead of the leading icon, the label stays, clicks are blocked, `aria-busy`. */
  readonly loading?: boolean;
  /** Disabled stays focusable (`aria-disabled`), so that a hint can explain the reason (§ 3.1). */
  readonly disabled?: boolean;
  readonly ref?: Ref<HTMLButtonElement>;
}

const VARIANTS = {
  primary:
    'bg-action-primary-bg text-action-primary-text hover:bg-action-primary-bg-hover active:bg-action-primary-bg-pressed aria-disabled:bg-action-primary-bg-disabled aria-disabled:text-action-primary-text-disabled',
  secondary:
    'border-w-strong border-action-secondary-border bg-action-secondary-bg text-action-secondary-text hover:bg-action-secondary-bg-hover active:bg-action-secondary-bg-pressed aria-disabled:border-action-secondary-border-disabled aria-disabled:text-action-secondary-text-disabled',
  tertiary:
    'text-action-tertiary-text hover:bg-action-tertiary-bg-hover active:bg-action-tertiary-bg-pressed aria-disabled:text-action-tertiary-text-disabled',
} as const;

/** Button (styleguide § 3.1): primary, secondary and tertiary, md and lg, with loading and disabled states. */
export function Button({
  children,
  className,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  onClick,
  ...rest
}: ButtonProps) {
  const Leading = loading ? LoaderCircle : icon;
  const inactive = loading || disabled;
  const block = (event: MouseEvent<HTMLButtonElement>) => {
    if (inactive) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return (
    <button
      type="button"
      {...rest}
      aria-disabled={inactive || undefined}
      aria-busy={loading || undefined}
      onClick={block}
      className={classNames(
        'inline-flex items-center justify-center gap-inline-sm px-inset-md rounded-control text-button focus-visible:focus-ring',
        size === 'lg' ? 'h-control-height-web-lg' : 'h-control-height-web-md',
        VARIANTS[variant],
        className,
      )}
    >
      {Leading ? <Leading aria-hidden="true" className="size-icon-md shrink-0" /> : null}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  readonly icon: Icon;
  /** Accessible name (styleguide § 2.10: an icon button always has one). */
  readonly label: string;
  /** `brand` on dark surfaces (Sidebar, drawer): inverse focus ring and on-brand colours. */
  readonly tone?: 'surface' | 'brand';
  readonly ref?: Ref<HTMLButtonElement>;
}

/** Icon button with a touch target of at least size.touch-target.min (styleguide § 3.1). */
export function IconButton({ icon: IconComponent, label, tone = 'surface', className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      aria-label={label}
      className={classNames(
        'inline-flex items-center justify-center size-touch-target-min rounded-control',
        tone === 'surface'
          ? 'text-icon-primary hover:bg-action-tertiary-bg-hover active:bg-action-tertiary-bg-pressed focus-visible:focus-ring '
          : 'text-icon-inverse hover:bg-bg-brand focus-visible:focus-ring-inverse',
        className,
      )}
    >
      <IconComponent aria-hidden="true" className="size-icon-md" />
    </button>
  );
}

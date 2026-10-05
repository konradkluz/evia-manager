import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { classNames } from './class-names.ts';
import type { Icon } from './icons.ts';

/** Primary button, size md (styleguide § 3.1). One primary action per view. */
export function Button({ children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      type="button"
      {...rest}
      className={classNames(
        'inline-flex items-center justify-center gap-inline-sm h-control-height-web-md px-inset-md rounded-control',
        'text-button bg-action-primary-bg text-action-primary-text hover:bg-action-primary-bg-hover active:bg-action-primary-bg-pressed',
        'focus-visible:focus-ring',
        className,
      )}
    >
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

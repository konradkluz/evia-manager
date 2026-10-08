import type { ReactNode } from 'react';
import { classNames } from './class-names.ts';
import type { Icon } from './icons.ts';

export interface BannerProps {
  readonly icon: Icon;
  readonly children: ReactNode;
  /** `warning` (default) is the state of the connection and the like; `info` is a state of the object (a closed work order). */
  readonly tone?: 'warning' | 'info';
  /** With a name the banner is a region of the page (`role="region"`) and is read with the page, not announced as a change. */
  readonly label?: string;
}

/**
 * Banner (styleguide § 3.19, § 4.10): icon + text (colour is not the only signal). A warning banner is announced politely
 * through role="status" (role="alert" is reserved for errors); a banner with a `label` is a named region (W-06 (b)).
 */
export function Banner({ icon: IconComponent, children, tone = 'warning', label }: BannerProps) {
  const info = tone === 'info';
  return (
    <div
      role={label === undefined ? 'status' : 'region'}
      aria-label={label}
      className={classNames(
        'flex items-start gap-inline-md px-inset-md py-inset-sm text-text-primary text-body',
        info ? 'bg-feedback-info-bg border-s-indicator-info' : 'bg-feedback-warning-bg border-s-indicator',
      )}
    >
      <IconComponent
        aria-hidden="true"
        className={classNames('size-icon-md shrink-0', info ? 'text-feedback-info-icon' : 'text-feedback-warning-icon')}
      />
      <div className="flex flex-col gap-stack-xs">{children}</div>
    </div>
  );
}

import type { ReactNode } from 'react';
import type { Icon } from './icons.ts';

/**
 * Banner, warning tone (styleguide § 3.19, § 4.10): icon + text (colour is not the only signal), announced politely
 * through role="status" (role="alert" is reserved for errors).
 */
export function Banner({ icon: IconComponent, children }: { readonly icon: Icon; readonly children: ReactNode }) {
  return (
    <div
      role="status"
      className="flex items-center gap-inline-md px-inset-md py-inset-sm bg-feedback-warning-bg text-text-primary text-body border-s-indicator"
    >
      <IconComponent aria-hidden="true" className="size-icon-md shrink-0 text-feedback-warning-icon" />
      <span>{children}</span>
    </div>
  );
}

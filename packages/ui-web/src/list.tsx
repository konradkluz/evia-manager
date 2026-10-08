import type { ReactNode } from 'react';

/**
 * List (styleguide § 3.6, "lista prosta"): a semantic list whose items are separated by `color.border.subtle`
 * (`border-width.default`). Pass the name of the list as `label` when no heading names it. Items are `ListItem`.
 */
export function List({
  children,
  label,
  labelledBy,
}: {
  readonly children: ReactNode;
  readonly label?: string;
  readonly labelledBy?: string;
}) {
  return (
    <ul aria-label={label} aria-labelledby={labelledBy} className="flex flex-col">
      {children}
    </ul>
  );
}

/** One item of a `List`: `text.body` on `color.bg.surface`, the separator above it, `space.inset.sm` of padding. */
export function ListItem({ children }: { readonly children: ReactNode }) {
  return (
    <li className="flex flex-col gap-stack-xs py-inset-sm text-body text-text-primary border-t-default first:border-t-0">{children}</li>
  );
}

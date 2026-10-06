import type { ReactNode } from 'react';

/** Information card (styleguide § 3.8): surface, outline and `radius.card`, web padding `space.inset.lg`. */
export function Card({ children, labelledBy }: { readonly children: ReactNode; readonly labelledBy?: string }) {
  return (
    <section
      aria-labelledby={labelledBy}
      className="flex flex-col gap-stack-md p-inset-lg bg-bg-surface text-text-primary border-w-default border-border-default rounded-card"
    >
      {children}
    </section>
  );
}

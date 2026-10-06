import type { ReactNode } from 'react';
import type { Icon } from './icons.ts';

export interface EmptyStateProps {
  readonly icon: Icon;
  readonly title: string;
  readonly description: string;
  /** Optional action (styleguide § 3.15); the variant without action is used before a feature exists (1.3.0 proposal). */
  readonly action?: ReactNode;
  /** The title is a level-2 heading under the page h1; a whole-screen state (error boundary) uses level 1. */
  readonly headingLevel?: 1 | 2;
}

/** Empty state (styleguide § 3.15, § 4.8): decorative icon, title, description and an optional action. */
export function EmptyState({ icon: IconComponent, title, description, action, headingLevel = 2 }: EmptyStateProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <section className="flex flex-col items-center text-center gap-stack-md py-stack-2xl">
      <IconComponent aria-hidden="true" className="size-icon-2xl text-icon-secondary" />
      <Heading className="text-heading-3 text-text-primary">{title}</Heading>
      <p className="text-body text-text-secondary">{description}</p>
      {action}
    </section>
  );
}

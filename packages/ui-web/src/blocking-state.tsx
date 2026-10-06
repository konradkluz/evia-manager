import type { ReactNode, Ref } from 'react';
import type { Icon } from './icons.ts';

export interface BlockingStateProps {
  /** Product name at the top (§ 3.15.1). */
  readonly brand: string;
  readonly icon: Icon;
  readonly title: string;
  readonly description: string;
  /** The one primary action. */
  readonly action?: ReactNode;
  /** The optional tertiary action in the top right corner ("Wyloguj"). */
  readonly topAction?: ReactNode;
  /** Alerts under the description (errors and info). */
  readonly children?: ReactNode;
  /** After entering, focus goes to the title (§ 3.15.1 accessibility). */
  readonly titleRef?: Ref<HTMLHeadingElement>;
}

/**
 * Blocking empty state of a whole screen (styleguide § 3.15.1, P-5): no Sidebar and no TopBar, the product name on
 * top, the title as the level-1 heading, one primary action; the screen renders and fetches no data.
 */
export function BlockingState({
  brand,
  icon: IconComponent,
  title,
  description,
  action,
  topAction,
  children,
  titleRef,
}: BlockingStateProps) {
  return (
    <div className="flex flex-col min-h-screen bg-bg-canvas text-text-primary">
      <header className="flex items-center justify-between gap-inline-md px-grid-compact-margin medium:px-grid-medium-margin py-inset-sm">
        <p className="text-label-lg font-semibold">{brand}</p>
        {topAction}
      </header>
      <main className="flex flex-col items-center flex-1 px-grid-compact-margin medium:px-grid-medium-margin py-stack-2xl">
        <div className="flex flex-col items-start w-full max-w-form-max-width gap-stack-md">
          <IconComponent aria-hidden="true" className="size-icon-2xl text-icon-secondary" />
          <h1 ref={titleRef} tabIndex={-1} className="text-heading-2 text-text-primary focus-visible:focus-ring">
            {title}
          </h1>
          <p className="text-body text-text-secondary">{description}</p>
          {children}
          {action}
        </div>
      </main>
    </div>
  );
}

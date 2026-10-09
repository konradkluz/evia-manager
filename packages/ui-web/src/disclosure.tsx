import { useId, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from './icons.ts';

export interface DisclosureProps {
  /** Title of the header (`text.heading-4`). */
  readonly title: string;
  /** Summary next to the title; it stays visible when the section is open (§ 3.21). */
  readonly summary?: ReactNode;
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
  /** Level of the heading that holds the button (3 on W-06; a dialog section under its h2 uses 3 as well). */
  readonly headingLevel?: 2 | 3 | 4;
  readonly children: ReactNode;
}

/**
 * Disclosure (styleguide § 3.21): the header is a `button` inside a heading, with `aria-expanded` and `aria-controls`;
 * Enter and Space toggle it and the focus stays on the header. The content stays in the DOM while closed (`hidden`), so a
 * form keeps what was typed in it. A collapsed section is not an access control — only content the role may see goes in.
 */
export function Disclosure({ title, summary, expanded, onExpandedChange, headingLevel = 3, children }: DisclosureProps) {
  const id = useId();
  const Heading = `h${String(headingLevel)}` as 'h2' | 'h3' | 'h4';
  const Chevron = expanded ? ChevronUp : ChevronDown;
  return (
    <section className="flex flex-col gap-stack-sm border-t-default">
      <Heading className="text-heading-4 text-text-primary">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={`${id}-content`}
          onClick={() => {
            onExpandedChange(!expanded);
          }}
          className="flex min-h-control-height-web-md w-full items-center gap-inline-md text-start hover:bg-bg-surface-hover active:bg-bg-surface-pressed focus-visible:focus-ring"
        >
          <span>{title}</span>
          {summary === undefined ? null : (
            <span className="flex min-w-0 flex-1 items-center text-body-sm text-text-secondary">{summary}</span>
          )}
          <Chevron aria-hidden="true" className="ms-auto size-icon-md shrink-0 text-icon-secondary" />
        </button>
      </Heading>
      <div id={`${id}-content`} hidden={!expanded} className="flex flex-col gap-stack-md">
        {children}
      </div>
    </section>
  );
}

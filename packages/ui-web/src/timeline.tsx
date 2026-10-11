import { useId, type ReactNode, type Ref } from 'react';
import type { Icon } from './icons.ts';

export interface TimelineProps {
  readonly children: ReactNode;
}

/** The timeline (styleguide § 3.10): the days, each a `TimelineDay`, from the newest. */
export function Timeline({ children }: TimelineProps) {
  return <div className="flex flex-col gap-stack-lg">{children}</div>;
}

export interface TimelineDayProps {
  /** "Dziś", "Wczoraj" or `02.10.2026` — the heading of the day (`text.label-lg`), a heading so a screen reader can jump between days. */
  readonly heading: string;
  readonly headingLevel?: 3 | 4;
  /** The entries of the day, `TimelineEntry` each. */
  readonly children: ReactNode;
}

/** One day of the timeline: a heading and an ordered list of its entries (§ 3.10, § 6.3). */
export function TimelineDay({ heading, headingLevel = 3, children }: TimelineDayProps) {
  const id = useId();
  const Heading = `h${String(headingLevel)}` as 'h3' | 'h4';
  return (
    <section aria-labelledby={id} className="flex flex-col gap-stack-md">
      <Heading id={id} className="border-b-default pb-inset-xs text-label-lg text-text-secondary">
        {heading}
      </Heading>
      <ol className="flex flex-col">{children}</ol>
    </section>
  );
}

export interface TimelineEntryProps {
  /** The marker (§ 3.10): `pencil` for a note, `message-square-text` for a comment, `eye-off` for a redacted entry. Decorative. */
  readonly icon: Icon;
  /** Accessible name of the entry: the kind, the author and the full date (§ 6.3) — the marker itself is hidden from assistive technology. */
  readonly label: string;
  /** Author of the entry (`text.label`) — React text. */
  readonly author: string;
  /** The time of the entry (`text.caption`, `color.text.secondary`): a `<time>` element built by the caller. */
  readonly time: ReactNode;
  /** After the time: the category, the stage, "z telefonu …" (`text.caption`). */
  readonly meta?: ReactNode;
  /** The menu of the entry, at the end of the header. */
  readonly actions?: ReactNode;
  /** The content (`text.body`); passed as React text or a node built from React text. */
  readonly children: ReactNode;
  /** Identifier kept as `data-entry-id` so a page can move the focus to an entry (e.g. the first one loaded by "Pokaż starsze"). */
  readonly entryId?: string;
  readonly itemRef?: Ref<HTMLLIElement>;
}

/**
 * One entry of the timeline (§ 3.10): the marker on the line (`size.timeline-marker`, `color.border.default`,
 * `border-width.strong`), the header — the author, the time and the details — and the content. A list item that can take
 * the focus programmatically (`tabIndex -1`) and has its own name.
 */
export function TimelineEntry({ icon: Marker, label, author, time, meta, actions, children, entryId, itemRef }: TimelineEntryProps) {
  return (
    <li
      ref={itemRef}
      tabIndex={-1}
      aria-label={label}
      data-entry-id={entryId}
      className="group flex gap-inline-md focus-visible:focus-ring"
    >
      <div className="flex flex-col items-center self-stretch">
        <span className="flex size-timeline-marker shrink-0 items-center justify-center rounded-pill bg-bg-surface-subtle">
          <Marker aria-hidden="true" className="size-icon-sm text-icon-secondary" />
        </span>
        <span aria-hidden="true" className="flex-1 border-s-timeline group-last:hidden" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-stack-xs pb-stack-md">
        <div className="flex flex-wrap items-center justify-between gap-inline-sm">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-inline-sm gap-y-stack-xs">
            <span className="break-words text-label text-text-primary">{author}</span>
            <span className="text-caption text-text-secondary">{time}</span>
            {meta === undefined ? null : <span className="text-caption text-text-secondary">{meta}</span>}
          </div>
          {actions}
        </div>
        <div className="text-body text-text-primary">{children}</div>
      </div>
    </li>
  );
}

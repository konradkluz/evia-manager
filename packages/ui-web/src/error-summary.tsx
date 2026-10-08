import type { Ref } from 'react';
import { CircleAlert } from './icons.ts';

export interface ErrorSummaryItem {
  /** Stable key of the field the message belongs to. */
  readonly field: string;
  readonly message: string;
}

export interface ErrorSummaryProps {
  /** One sentence over the list ("Popraw zaznaczone pola…"). */
  readonly title: string;
  readonly items: readonly ErrorSummaryItem[];
  /** The page moves the focus into the field of the chosen item (the link is a convenience, the field keeps its own message). */
  readonly onSelect: (field: string) => void;
  /** Lets the page put the focus on the summary after a failed submit (§ 4.1). */
  readonly summaryRef?: Ref<HTMLDivElement>;
}

/**
 * Error summary of a form (styleguide § 4.1): shown at the top after the primary button is pressed, a list of links to the
 * fields with their messages; the page puts the focus on it. Icon and text, never colour alone; announced as an alert.
 */
export function ErrorSummary({ title, items, onSelect, summaryRef }: ErrorSummaryProps) {
  return (
    <div
      ref={summaryRef}
      tabIndex={-1}
      role="alert"
      className="flex items-start gap-inline-md px-inset-md py-inset-sm text-body text-text-primary bg-feedback-error-bg border-s-indicator-error rounded-control focus-visible:focus-ring"
    >
      <CircleAlert aria-hidden="true" className="size-icon-md shrink-0 text-feedback-error-icon" />
      <div className="flex flex-col gap-stack-xs">
        <p className="font-semibold">{title}</p>
        <ul className="flex flex-col gap-stack-xs">
          {items.map((item) => (
            <li key={item.field}>
              <a
                href={`#${item.field}`}
                onClick={(event) => {
                  event.preventDefault();
                  onSelect(item.field);
                }}
                className="underline text-text-link focus-visible:focus-ring"
              >
                {item.message}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

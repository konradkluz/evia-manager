import { CircleCheck, CircleMinus } from './icons.ts';

export interface ProcedureProgressProps {
  /** Stages "Zakończony". */
  readonly done: number;
  /** Stages of the process without "Nie dotyczy" (styleguide § 3.23); 0 means nothing is left to do. */
  readonly total: number;
  /** The text the person reads: "2 z 7 etapów", or "Nie dotyczy" when `total` is 0. */
  readonly text: string;
  /** Shown next to the check mark when every stage is done ("Wszystkie zakończone"). */
  readonly completeText: string;
  /** `compact` is the text alone (a column of a table); the default adds the bar. */
  readonly variant?: 'full' | 'compact';
}

/**
 * ProcedureProgress (styleguide § 3.23, P-6): "n z m etapów" and a bar — the track `color.progress.track`, the fill
 * `color.progress.fill`, `size.progress-bar.height`. `n = m > 0` is "Wszystkie zakończone" with `circle-check`; `m = 0` is
 * "Nie dotyczy" with `circle-minus`, without the bar. Not a control: it is made of spans (it sits in the header of a
 * Disclosure), the bar is decorative (`aria-hidden`, not a `progressbar` — it is not the progress of an operation) and
 * the text is the information. The width of the bar comes from its container.
 */
export function ProcedureProgress({ done, total, text, completeText, variant = 'full' }: ProcedureProgressProps) {
  const finished = total > 0 && done >= total;
  const nothing = total === 0;
  const percent = total === 0 ? 0 : Math.min(100, Math.round((done / total) * 100));
  return (
    <span className="inline-flex min-w-0 flex-1 items-center gap-inline-sm text-body-sm text-text-secondary">
      {nothing ? <CircleMinus aria-hidden="true" className="size-icon-sm shrink-0 text-icon-secondary" /> : null}
      {finished ? <CircleCheck aria-hidden="true" className="size-icon-sm shrink-0 text-icon-success" /> : null}
      <span>{text}</span>
      {finished ? <span>{completeText}</span> : null}
      {variant === 'full' && !nothing ? (
        <span aria-hidden="true" className="h-progress-bar-height min-w-icon-2xl flex-1 overflow-hidden rounded-pill bg-progress-track">
          {/* The fill is an SVG rectangle: the width is data, and an inline style is not allowed (styleguide § 7.2). */}
          <svg className="block size-full" viewBox="0 0 100 1" preserveAspectRatio="none" focusable="false">
            <rect width={percent} height="1" className="fill-progress-fill" />
          </svg>
        </span>
      ) : null}
    </span>
  );
}

import type { ReactNode } from 'react';
import { classNames } from './class-names.ts';
import { Clock, CloudAlert, CloudCheck, CloudUpload, ScanSearch, TriangleAlert, type Icon } from './icons.ts';

/**
 * States of one file in the upload queue (styleguide § 3.12, § 4.14, § 4.16): waiting, being sent, waiting for the connection
 * or paused by the person, checked by the server ("Sprawdzanie pliku"), done, failed ("Nie wysłano" with "Ponów") and
 * held by the scan ("Wymaga uwagi").
 */
export type UploadQueueItemState = 'queued' | 'uploading' | 'paused' | 'checking' | 'done' | 'failed' | 'attention';

export interface UploadQueueItemProps {
  /** The name of the file — free text, rendered as text only (SR-WEB-03). */
  readonly name: string;
  readonly state: UploadQueueItemState;
  /** The label of the state ("Wysłano", "Nie wysłano — plik uszkodzony w transmisji"): the state is never colour or icon alone. */
  readonly statusLabel: string;
  /** 0 … 100, only for `uploading`: the bar and the accessible value. */
  readonly percent?: number;
  /** Accessible name of the progress bar ("Postęp wysyłania pliku IMG_0412.jpg"). */
  readonly progressLabel?: string;
  /** Visible buttons of the row ("Wstrzymaj", "Ponów") — never a gesture (§ 3.12). */
  readonly actions?: ReactNode;
  /** An extra line under the state (what to do next, the reason). */
  readonly detail?: string;
}

interface Look {
  readonly icon: Icon;
  readonly classes: string;
  readonly iconClasses: string;
}

/** Complete class names (Tailwind reads them statically): `color.sync.*` of § 5.4. */
const LOOKS: Readonly<Record<UploadQueueItemState, Look>> = {
  queued: { icon: Clock, classes: 'bg-sync-queued-bg text-sync-queued-text', iconClasses: 'text-sync-queued-icon' },
  paused: { icon: Clock, classes: 'bg-sync-queued-bg text-sync-queued-text', iconClasses: 'text-sync-queued-icon' },
  checking: { icon: ScanSearch, classes: 'bg-sync-queued-bg text-sync-queued-text', iconClasses: 'text-sync-queued-icon' },
  uploading: {
    icon: CloudUpload,
    classes: 'bg-sync-in-progress-bg text-sync-in-progress-text',
    iconClasses: 'text-sync-in-progress-icon',
  },
  done: { icon: CloudCheck, classes: 'bg-sync-done-bg text-sync-done-text', iconClasses: 'text-sync-done-icon' },
  failed: { icon: CloudAlert, classes: 'bg-sync-error-bg text-sync-error-text', iconClasses: 'text-sync-error-icon' },
  attention: { icon: TriangleAlert, classes: 'bg-sync-error-bg text-sync-error-text', iconClasses: 'text-sync-error-icon' },
};

/**
 * UploadQueueItem (styleguide § 3.12): the name of the file, the state as an icon AND a label on the `color.sync.*` tone, the
 * progress bar of a file being sent (`size.progress-bar.height`, `color.sync.progress.*`) and the visible buttons of the row.
 * A list item: put it in a `<ul>`.
 */
export function UploadQueueItem({ name, state, statusLabel, percent, progressLabel, actions, detail }: UploadQueueItemProps) {
  const { icon: IconComponent, classes, iconClasses } = LOOKS[state];
  const value = percent === undefined ? undefined : Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <li className="flex flex-col gap-stack-xs py-inset-sm min-h-touch-target-min">
      <div className="flex flex-wrap items-center justify-between gap-inline-md">
        <span className="min-w-0 break-words text-body text-text-primary">{name}</span>
        {actions === undefined ? null : <span className="flex flex-wrap gap-inline-sm">{actions}</span>}
      </div>
      <span
        className={classNames(
          'inline-flex w-fit max-w-full items-start gap-inline-xs rounded-pill px-inset-sm py-inset-xs text-label',
          classes,
        )}
      >
        <IconComponent aria-hidden="true" className={classNames('size-icon-sm shrink-0', iconClasses)} />
        <span>{statusLabel}</span>
      </span>
      {detail === undefined ? null : <span className="text-body-sm text-text-secondary">{detail}</span>}
      {value === undefined ? null : (
        <span
          role="progressbar"
          aria-label={progressLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value}
          className="block h-progress-bar-height overflow-hidden rounded-pill bg-sync-progress-track"
        >
          {/* The fill is an SVG rectangle: the width is data, and an inline style is not allowed (styleguide § 7.2). */}
          <svg className="block size-full" viewBox="0 0 100 1" preserveAspectRatio="none" focusable="false" aria-hidden="true">
            <rect width={value} height="1" className="fill-sync-progress-fill" />
          </svg>
        </span>
      )}
    </li>
  );
}

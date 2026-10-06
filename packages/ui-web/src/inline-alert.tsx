import type { ReactNode, Ref } from 'react';
import { classNames } from './class-names.ts';
import { CircleAlert, Info } from './icons.ts';

export interface InlineAlertProps {
  readonly tone: 'error' | 'info';
  readonly children: ReactNode;
  /** Optional exit action (§ 4.9: "Spróbuj ponownie", "Przejdź do …"). */
  readonly action?: ReactNode;
  /** Makes the alert focusable programmatically: after a failed submit focus moves to the message (§ 4.1, W-01). */
  readonly alertRef?: Ref<HTMLDivElement>;
}

/**
 * InlineAlert (styleguide § 3.19): tone icon + text on the tone's background with a leading indicator; `role="alert"`
 * only for errors (an info alert is plain content).
 */
export function InlineAlert({ tone, children, action, alertRef }: InlineAlertProps) {
  const Icon = tone === 'error' ? CircleAlert : Info;
  return (
    <div
      ref={alertRef}
      tabIndex={alertRef === undefined ? undefined : -1}
      role={tone === 'error' ? 'alert' : undefined}
      className={classNames(
        'flex flex-col items-start gap-stack-sm px-inset-md py-inset-sm text-body text-text-primary rounded-control focus-visible:focus-ring',
        tone === 'error' ? 'bg-feedback-error-bg border-s-indicator-error' : 'bg-feedback-info-bg border-s-indicator-info',
      )}
    >
      <div className="flex items-start gap-inline-md">
        <Icon
          aria-hidden="true"
          className={classNames('size-icon-md shrink-0', tone === 'error' ? 'text-feedback-error-icon' : 'text-feedback-info-icon')}
        />
        <p>{children}</p>
      </div>
      {action}
    </div>
  );
}

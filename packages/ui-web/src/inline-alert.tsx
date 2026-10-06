import type { ReactNode } from 'react';
import { classNames } from './class-names.ts';
import { CircleAlert, Info } from './icons.ts';

export interface InlineAlertProps {
  readonly tone: 'error' | 'info';
  readonly children: ReactNode;
  /** Optional exit action (§ 4.9: "Spróbuj ponownie", "Przejdź do …"). */
  readonly action?: ReactNode;
}

/**
 * InlineAlert (styleguide § 3.19): tone icon + text on the tone's background with a leading indicator; `role="alert"`
 * only for errors (an info alert is plain content).
 */
export function InlineAlert({ tone, children, action }: InlineAlertProps) {
  const Icon = tone === 'error' ? CircleAlert : Info;
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={classNames(
        'flex flex-col items-start gap-stack-sm px-inset-md py-inset-sm text-body text-text-primary rounded-control',
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

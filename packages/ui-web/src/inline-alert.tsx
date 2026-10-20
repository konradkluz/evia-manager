import type { ReactNode, Ref } from 'react';
import { classNames } from './class-names.ts';
import { CircleAlert, CircleCheck, Info } from './icons.ts';

export interface InlineAlertProps {
  readonly tone: 'error' | 'info' | 'success';
  readonly children: ReactNode;
  /** Optional exit action (§ 4.9: "Spróbuj ponownie", "Przejdź do …"). */
  readonly action?: ReactNode;
  /** Makes the alert focusable programmatically: after a failed submit focus moves to the message (§ 4.1, W-01). */
  readonly alertRef?: Ref<HTMLDivElement>;
}

const TONES = {
  error: { Icon: CircleAlert, role: 'alert', box: 'bg-feedback-error-bg border-s-indicator-error', icon: 'text-feedback-error-icon' },
  info: { Icon: Info, role: undefined, box: 'bg-feedback-info-bg border-s-indicator-info', icon: 'text-feedback-info-icon' },
  success: {
    Icon: CircleCheck,
    role: 'status',
    box: 'bg-feedback-success-bg border-s-indicator-success',
    icon: 'text-feedback-success-icon',
  },
} as const;

/**
 * InlineAlert (styleguide § 3.19): tone icon + text on the tone's background with a leading indicator; `role="alert"`
 * only for errors, `role="status"` for success (announced politely), an info alert is plain content.
 */
export function InlineAlert({ tone, children, action, alertRef }: InlineAlertProps) {
  const { Icon, role, box, icon } = TONES[tone];
  return (
    <div
      ref={alertRef}
      tabIndex={alertRef === undefined ? undefined : -1}
      role={role}
      className={classNames(
        'flex flex-col items-start gap-stack-sm px-inset-md py-inset-sm text-body text-text-primary rounded-control focus-visible:focus-ring',
        box,
      )}
    >
      <div className="flex items-start gap-inline-md">
        <Icon aria-hidden="true" className={classNames('size-icon-md shrink-0', icon)} />
        <p>{children}</p>
      </div>
      {action}
    </div>
  );
}

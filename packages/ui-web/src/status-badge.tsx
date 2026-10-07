import { useId } from 'react';
import { classNames } from './class-names.ts';
import { Ban, Banknote, Calculator, CircleCheck, CircleHelp, CirclePause, Inbox, ThumbsUp, Wrench, type Icon } from './icons.ts';

/** Token key of a work order status (`color.status.order.*`; styleguide § 4.4: the model code in kebab-case) or `unknown` (§ 3.9.1). */
export type OrderStatusKey = 'new' | 'quoting' | 'accepted' | 'in-progress' | 'completed' | 'settled' | 'on-hold' | 'cancelled' | 'unknown';

interface Look {
  readonly icon: Icon;
  readonly classes: string;
  readonly iconClasses: string;
}

/** Complete class names (Tailwind reads them statically): background, text and icon colour of each status. */
const LOOKS: Readonly<Record<OrderStatusKey, Look>> = {
  new: { icon: Inbox, classes: 'bg-status-order-new-bg text-status-order-new-text', iconClasses: 'text-status-order-new-icon' },
  quoting: {
    icon: Calculator,
    classes: 'bg-status-order-quoting-bg text-status-order-quoting-text',
    iconClasses: 'text-status-order-quoting-icon',
  },
  accepted: {
    icon: ThumbsUp,
    classes: 'bg-status-order-accepted-bg text-status-order-accepted-text',
    iconClasses: 'text-status-order-accepted-icon',
  },
  'in-progress': {
    icon: Wrench,
    classes: 'bg-status-order-in-progress-bg text-status-order-in-progress-text',
    iconClasses: 'text-status-order-in-progress-icon',
  },
  completed: {
    icon: CircleCheck,
    classes: 'bg-status-order-completed-bg text-status-order-completed-text',
    iconClasses: 'text-status-order-completed-icon',
  },
  settled: {
    icon: Banknote,
    classes: 'bg-status-order-settled-bg text-status-order-settled-text',
    iconClasses: 'text-status-order-settled-icon',
  },
  'on-hold': {
    icon: CirclePause,
    classes: 'bg-status-order-on-hold-bg text-status-order-on-hold-text',
    iconClasses: 'text-status-order-on-hold-icon',
  },
  cancelled: {
    icon: Ban,
    classes: 'bg-status-order-cancelled-bg text-status-order-cancelled-text',
    iconClasses: 'text-status-order-cancelled-icon',
  },
  unknown: { icon: CircleHelp, classes: 'bg-status-unknown-bg text-status-unknown-text', iconClasses: 'text-status-unknown-icon' },
};

export interface StatusBadgeProps {
  readonly status: OrderStatusKey;
  /** The full label ("W realizacji") — never shortened; for `unknown` the fixed "Nieznany status". */
  readonly label: string;
  /** Explanation of the badge (the unknown value, § 3.9.1): a tooltip and the accessible description. */
  readonly hint?: string;
}

/**
 * StatusBadge (styleguide § 3.9, § 3.9.1): a static subtle badge — icon `size.icon.sm` (unique per status) + label
 * `text.label` on `color.status.order.*` (or `color.status.unknown.*`), `radius.pill`, `size.badge.height`. The icon is
 * decorative: the label carries the meaning, so the colour is never the only signal. Not interactive (focus belongs to
 * the row or card that holds it).
 */
export function StatusBadge({ status, label, hint }: StatusBadgeProps) {
  const id = useId();
  const { icon: IconComponent, classes, iconClasses } = LOOKS[status];
  return (
    <span
      title={hint}
      aria-describedby={hint === undefined ? undefined : id}
      className={classNames(
        'inline-flex items-center gap-inline-xs h-badge-height px-inset-sm rounded-pill text-label whitespace-nowrap',
        classes,
      )}
    >
      <IconComponent aria-hidden="true" className={classNames('size-icon-sm shrink-0', iconClasses)} />
      {label}
      {hint === undefined ? null : (
        <span id={id} className="sr-only">
          {hint}
        </span>
      )}
    </span>
  );
}

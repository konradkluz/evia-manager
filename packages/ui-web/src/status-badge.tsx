import { useId, type ButtonHTMLAttributes, type Ref } from 'react';
import { classNames } from './class-names.ts';
import {
  Ban,
  Banknote,
  Calculator,
  ChevronDown,
  Circle,
  CircleCheck,
  CircleHelp,
  CircleMinus,
  CirclePause,
  CirclePlay,
  Hourglass,
  Inbox,
  OctagonAlert,
  ThumbsUp,
  Wrench,
  type Icon,
} from './icons.ts';

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

/** Token key of a stage status (`color.status.stage.*`; styleguide § 4.4: the model code in kebab-case). */
export type StageStatusKey = 'todo' | 'in-progress' | 'waiting' | 'done' | 'not-applicable' | 'blocked';

/** Complete class names of the stage statuses (Tailwind reads them statically); the icon is unique within the group. */
const STAGE_LOOKS: Readonly<Record<StageStatusKey, Look>> = {
  todo: { icon: Circle, classes: 'bg-status-stage-todo-bg text-status-stage-todo-text', iconClasses: 'text-status-stage-todo-icon' },
  'in-progress': {
    icon: CirclePlay,
    classes: 'bg-status-stage-in-progress-bg text-status-stage-in-progress-text',
    iconClasses: 'text-status-stage-in-progress-icon',
  },
  waiting: {
    icon: Hourglass,
    classes: 'bg-status-stage-waiting-bg text-status-stage-waiting-text',
    iconClasses: 'text-status-stage-waiting-icon',
  },
  done: { icon: CircleCheck, classes: 'bg-status-stage-done-bg text-status-stage-done-text', iconClasses: 'text-status-stage-done-icon' },
  'not-applicable': {
    icon: CircleMinus,
    classes: 'bg-status-stage-not-applicable-bg text-status-stage-not-applicable-text',
    iconClasses: 'text-status-stage-not-applicable-icon',
  },
  blocked: {
    icon: OctagonAlert,
    classes: 'bg-status-stage-blocked-bg text-status-stage-blocked-text',
    iconClasses: 'text-status-stage-blocked-icon',
  },
};

function lookOf(status: OrderStatusKey | StageStatusKey, group: 'order' | 'stage'): Look {
  if (status === 'unknown') return LOOKS.unknown;
  if (group === 'stage') return STAGE_LOOKS[status as StageStatusKey];
  return LOOKS[status as OrderStatusKey];
}

export interface StatusBadgeProps {
  /** A status of the work order, a status of a stage (`color.status.stage.*`, § 4.4) or `unknown`. */
  readonly status: OrderStatusKey | StageStatusKey;
  /** `stage` takes the colours and icons of the stage statuses; `todo`, `in-progress` and `done` exist in both groups. */
  readonly group?: 'order' | 'stage';
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
export function StatusBadge({ status, group = 'order', label, hint }: StatusBadgeProps) {
  const id = useId();
  const { icon: IconComponent, classes, iconClasses } = lookOf(status, group);
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

export interface StatusBadgeButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'disabled' | 'title'> {
  readonly status: OrderStatusKey | StageStatusKey;
  /** `stage` takes the colours and icons of the stage statuses (§ 4.4), as in `StatusBadge`. */
  readonly group?: 'order' | 'stage';
  /** The full label of the status ("W realizacji"); the accessible name of the button comes from `aria-label`. */
  readonly label: string;
  /** Disabled stays focusable (`aria-disabled`, no `chevron-down`); the hint says why (§ 3.9, § 4.13). */
  readonly disabledHint?: string;
  readonly ref?: Ref<HTMLButtonElement>;
}

/**
 * StatusBadge as a button (styleguide § 3.9, § 3.20: the trigger of the menu of transitions): the look of the badge plus
 * `chevron-down` and the focus ring. Disabled, it drops the chevron and explains why through a tooltip and the accessible
 * description; clicks are blocked, the focus is kept.
 */
export function StatusBadgeButton({ status, group = 'order', label, disabledHint, onClick, ref, ...rest }: StatusBadgeButtonProps) {
  const id = useId();
  const { icon: IconComponent, classes, iconClasses } = lookOf(status, group);
  const disabled = disabledHint !== undefined;
  return (
    <button
      type="button"
      ref={ref}
      {...rest}
      title={disabledHint}
      aria-disabled={disabled || undefined}
      aria-describedby={disabled ? id : undefined}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      className={classNames(
        'inline-flex items-center gap-inline-xs h-badge-height px-inset-sm rounded-pill text-label whitespace-nowrap focus-visible:focus-ring',
        classes,
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
      )}
    >
      <IconComponent aria-hidden="true" className={classNames('size-icon-sm shrink-0', iconClasses)} />
      {label}
      {disabled ? (
        <span id={id} className="sr-only">
          {disabledHint}
        </span>
      ) : (
        <ChevronDown aria-hidden="true" className="size-icon-sm shrink-0" />
      )}
    </button>
  );
}

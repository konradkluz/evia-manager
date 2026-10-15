import type { PaymentMilestone, PaymentMilestoneStatus } from '@evia/contracts';
import { AlertDialog, Banner, Button, StatusBadge, WifiOff } from '@evia/ui-web';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { paymentStatusLabels } from '../i18n/payment-labels.ts';
import { serverNow } from '../session/server-clock.ts';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import {
  CommandAlert,
  useMilestoneCommand,
  type CorrectionStepUp,
  type MilestoneOrder,
  type OpenedMilestone,
} from './milestone-command.tsx';
import { formatMoney } from './money.ts';
import { formatDueDate } from './procedure-format.ts';
import { todayWarsaw } from './transition-actions.ts';

/** The corrections of payments without a field (EVM-057 K1–K3, K5, K6); the change of the amount (K4) has its own dialog. */
export type CorrectionKind = 'withdrawInvoice' | 'cancelInvoice' | 'undoPayment' | 'restore' | 'delete';

/** What a correction needs of the instalment: the row of W-11 has no day of the payment and no share (W-06 has both). */
export type CorrectionMilestone = OpenedMilestone & Partial<Pick<PaymentMilestone, 'paidOn' | 'sharePercent'>>;

const known = (status: string): status is PaymentMilestoneStatus => Object.hasOwn(paymentStatusLabels, status);

/** The badge of a status of the model in a dialog: the icon and the label carry the meaning, never the colour alone (§ 3.9). */
function Badge({ status }: { readonly status: string }) {
  const { t } = useTranslation();
  return known(status) ? (
    <StatusBadge status={status} group="payment" label={paymentStatusLabels[status]} />
  ) : (
    <StatusBadge status="unknown" group="payment" label={t('workOrders.status.unknown')} />
  );
}

/**
 * "Stan: [Wystawiona] → [Planowana]" of a dialog of a correction (the story → "UX / UI" → "Dialogi"): two badges, read as one sentence
 * "Stan: z Wystawiona na Planowana"; at `breakpoint.compact` in two lines "Przed: …" / "Po: …". Without `to` — the status now (K4, K6).
 */
export function CorrectionState({ from, to }: { readonly from: string; readonly to?: string }) {
  const { t } = useTranslation();
  const label = (status: string) => (known(status) ? paymentStatusLabels[status] : t('workOrders.status.unknown'));
  if (to === undefined) {
    return (
      <div className="flex flex-wrap items-center gap-inline-sm">
        <span className="sr-only">{t('workOrder.correction.stateNow', { status: label(from) })}</span>
        <span aria-hidden="true" className="text-text-secondary">
          {t('workOrder.correction.state')}
        </span>
        <span aria-hidden="true">
          <Badge status={from} />
        </span>
      </div>
    );
  }
  return (
    <div>
      <p className="sr-only">{t('workOrder.correction.stateChange', { from: label(from), to: label(to) })}</p>
      <div aria-hidden="true" className="hidden flex-wrap items-center gap-inline-sm medium:flex">
        <span className="text-text-secondary">{t('workOrder.correction.state')}</span>
        <Badge status={from} />
        <span>{t('workOrder.correction.arrow')}</span>
        <Badge status={to} />
      </div>
      <div aria-hidden="true" className="flex flex-col gap-stack-xs medium:hidden">
        <div className="flex flex-wrap items-center gap-inline-sm">
          <span className="text-text-secondary">{t('workOrder.correction.before')}</span>
          <Badge status={from} />
        </div>
        <div className="flex flex-wrap items-center gap-inline-sm">
          <span className="text-text-secondary">{t('workOrder.correction.after')}</span>
          <Badge status={to} />
        </div>
      </div>
    </div>
  );
}

/** One line "Kwota: 3 600,00 zł" of the summary of a correction (`text.numeric`, tabular figures). */
export function CorrectionLine({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <p className="flex flex-wrap gap-x-inline-sm">
      <span className="text-text-secondary">{label}</span>
      <span className="min-w-0 break-words tabular-nums text-text-primary">{children}</span>
    </p>
  );
}

/** The texts of W-04 of a correction: the title of flows/01 and the two lines of the summary (the operation, then the instalment). */
export function useCorrectionStepUp(): (order: MilestoneOrder, milestone: OpenedMilestone, operation: string) => CorrectionStepUp {
  const { t } = useTranslation();
  return (order, milestone, operation) => ({
    title: t('stepUp.title.correctPayment'),
    details: [
      operation,
      milestone.amount === null
        ? t('workOrder.correction.stepUpDetailsNoAmount', { name: milestone.name, number: order.number })
        : t('workOrder.correction.stepUpDetails', {
            name: milestone.name,
            number: order.number,
            amount: formatMoney(milestone.amount.amountMinor),
          }),
    ],
  });
}

interface Spec {
  readonly title: string;
  readonly to?: PaymentMilestoneStatus;
  readonly effects: readonly string[];
  readonly submit: string;
  readonly danger: boolean;
  readonly operation: string;
  readonly toast: string;
}

/**
 * A correction of a payment without a field (EVM-057 AC1, AC2, AC4; K1 "Wycofać fakturę …?", K2 "Anulować fakturę …?", K3 "Cofnąć wpłatę
 * za fakturę …?", K5 "Przywrócić transzę „…”?", K6 "Usunąć transzę „…”?"): an AlertDialog with "before → after" (two badges), the amount,
 * the effect and always "Operacja zostanie zapisana w dzienniku audytu."; the focus starts on "Anuluj" (§ 4.11). The button sends the
 * transition (`to` only) or `DELETE`; `403 step_up_required` opens W-04 instead of this dialog (its data stay) and, once confirmed, sends
 * the same request again with the same `Idempotency-Key`; "Anuluj" of W-04 brings this dialog back with "Nie wykonano korekty.".
 * The server decides all the same (the role, the step-up, a closed order, the version).
 */
export function MilestoneCorrectionDialog({
  kind,
  order,
  milestone,
  onClose,
  onSaved,
  onDeleted,
}: {
  readonly kind: CorrectionKind;
  readonly order: MilestoneOrder;
  readonly milestone: CorrectionMilestone;
  readonly onClose: () => void;
  readonly onSaved: (saved: PaymentMilestone) => void;
  readonly onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const showToast = useToast();
  const stepUpOf = useCorrectionStepUp();
  const [opened] = useState(milestone);
  const [today] = useState(() => todayWarsaw(serverNow()));
  const command = useMilestoneCommand(order, opened);
  const none = t('workOrder.correction.none');
  const number = opened.invoiceNumber ?? none;
  const name = opened.name;
  const amount = opened.amount === null ? none : formatMoney(opened.amount.amountMinor);

  const spec = ((): Spec => {
    switch (kind) {
      case 'withdrawInvoice':
        return {
          title: t('workOrder.correction.withdrawTitle', { number }),
          to: 'planned',
          effects: [t('workOrder.correction.withdrawEffect')],
          submit: t('workOrder.correction.withdrawSubmit'),
          danger: true,
          operation: t('workOrder.correction.withdrawStepUp', { number }),
          toast: t('workOrder.correction.withdrawn', { number }),
        };
      case 'cancelInvoice':
        return {
          title: t('workOrder.correction.cancelInvoiceTitle', { number }),
          to: 'cancelled',
          effects: [t('workOrder.correction.cancelInvoiceEffect')],
          submit: t('workOrder.correction.cancelInvoiceSubmit'),
          danger: true,
          operation: t('workOrder.correction.cancelInvoiceStepUp', { number }),
          toast: t('workOrder.correction.invoiceCancelled', { number }),
        };
      case 'undoPayment': {
        const effects = [
          ...(opened.paidOn == null ? [] : [t('workOrder.correction.undoPaidOn', { date: formatDueDate(opened.paidOn) })]),
          // the due date has passed: the instalment is "Po terminie" at once (the story → "Stany" → "Po terminie")
          ...(opened.dueDate !== null && opened.dueDate < today ? [t('workOrder.correction.undoOverdue')] : []),
        ];
        return {
          title: t('workOrder.correction.undoTitle', { number }),
          to: 'invoiced',
          effects,
          submit: t('workOrder.correction.undoSubmit'),
          danger: false,
          operation: t('workOrder.correction.undoStepUp', { number }),
          toast: t('workOrder.correction.undone', { number }),
        };
      }
      case 'restore':
        return {
          title: t('workOrder.correction.restoreTitle', { name }),
          to: 'planned',
          effects: [t('workOrder.correction.restoreEffect')],
          submit: t('workOrder.correction.restoreSubmit'),
          danger: false,
          operation: t('workOrder.correction.restoreStepUp', { name }),
          toast: t('workOrder.correction.restored', { name }),
        };
      case 'delete':
        return {
          title: t('workOrder.correction.deleteTitle', { name }),
          effects: [t('workOrder.correction.deleteEffect')],
          submit: t('workOrder.correction.deleteSubmit'),
          danger: true,
          operation: t('workOrder.correction.deleteStepUp', { name }),
          toast: t('workOrder.correction.deleted', { name }),
        };
    }
  })();

  const blocked = !online || command.failure?.kind === 'closed';
  const dismiss = () => {
    if (!command.pending) onClose();
  };
  const submit = () => {
    if (blocked) return;
    const stepUp = stepUpOf(order, opened, spec.operation);
    if (spec.to === undefined) {
      command.remove(() => {
        showToast(spec.toast);
        onDeleted();
      }, stepUp);
      return;
    }
    command.run(
      { kind: 'transition', body: { to: spec.to } },
      (saved) => {
        showToast(spec.toast);
        onSaved(saved);
      },
      stepUp,
    );
  };

  return (
    <AlertDialog
      open={!command.stepping}
      title={spec.title}
      onDismiss={dismiss}
      actions={
        <>
          <Button variant="tertiary" data-initial-focus onClick={dismiss}>
            {t('workOrder.correction.cancel')}
          </Button>
          <Button
            variant={spec.danger ? 'danger' : 'primary'}
            loading={command.pending}
            disabled={blocked}
            {...(online ? {} : { title: t('workOrder.correction.offline') })}
            onClick={submit}
          >
            {spec.submit}
          </Button>
        </>
      }
    >
      <p className="text-body-sm text-text-secondary">
        {t('workOrder.correction.subtitle', { number: order.number, title: order.title, name })}
      </p>
      {online ? null : <Banner icon={WifiOff}>{t('workOrder.correction.offline')}</Banner>}
      <CommandAlert
        correction
        failure={command.failure}
        orderStatus={order.status}
        onRefresh={() => {
          if (!command.adopt()) onClose();
        }}
      />
      <div className="flex flex-col gap-stack-xs">
        <CorrectionState from={opened.status} {...(spec.to === undefined ? {} : { to: spec.to })} />
        {kind === 'restore' && opened.sharePercent != null ? (
          <CorrectionLine label={t('workOrder.correction.share')}>
            {t('workOrder.correction.shareValue', { share: opened.sharePercent })}
          </CorrectionLine>
        ) : null}
        <CorrectionLine label={t('workOrder.correction.amount')}>{amount}</CorrectionLine>
        {kind === 'delete' && opened.invoiceNumber !== null ? (
          <CorrectionLine label={t('workOrder.correction.invoice')}>{opened.invoiceNumber}</CorrectionLine>
        ) : null}
      </div>
      {spec.effects.map((effect) => (
        <p key={effect}>{effect}</p>
      ))}
      <p>{t('workOrder.correction.audit')}</p>
    </AlertDialog>
  );
}

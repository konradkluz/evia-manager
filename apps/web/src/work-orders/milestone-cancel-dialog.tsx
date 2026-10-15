import type { PaymentMilestone, WorkOrderDetails } from '@evia/contracts';
import { Banner, Button, Dialog, TextArea, WifiOff } from '@evia/ui-web';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DiscardDialog } from '../forms/discard-dialog.tsx';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { CommandAlert, MILESTONE_REASON_MAX, plainTextProblem, useFieldMessage, useMilestoneCommand } from './milestone-command.tsx';
import { normalizeName, useMilestoneName } from './milestone-form.ts';
import { MilestoneSummary } from './milestone-summary.tsx';

/**
 * "Anulować transzę „…”?" (EVM-054 AC3; dialog 3 of "UX / UI"): a dialog with a summary (§ 4.11) — the instalment and its share —
 * and the required "Powód anulowania" (plain text, the limit of the contract, a counter). The focus starts in the field; the button
 * is danger ("Anuluj transzę"), because only the Administrator restores the instalment (EVM-057). The reason lives in this dialog
 * only: the API keeps it in the record of the instalment and never returns it (not in the address, not in a store of the browser).
 */
export function MilestoneCancelDialog({
  order,
  milestone,
  onClose,
  onSaved,
}: {
  readonly order: WorkOrderDetails;
  readonly milestone: PaymentMilestone;
  readonly onClose: () => void;
  readonly onSaved: (saved: PaymentMilestone) => void;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const showToast = useToast();
  const nameOf = useMilestoneName();
  const message = useFieldMessage();
  const formId = useId();
  const subtitleId = useId();
  const effectId = useId();
  const [opened] = useState(milestone);
  const [reason, setReason] = useState('');
  const [discarding, setDiscarding] = useState(false);
  const command = useMilestoneCommand(order, opened);
  const error = command.fieldErrors.reason;
  const length = (normalizeName(reason).match(/./gsu) ?? []).length;

  const dismiss = () => {
    if (reason.trim() !== '' && !command.pending) setDiscarding(true);
    else onClose();
  };

  const submit = () => {
    if (!online) return;
    const problem = plainTextProblem(reason, MILESTONE_REASON_MAX);
    command.setFieldErrors(problem === undefined ? {} : { reason: message('reason', problem) });
    if (problem !== undefined) return;
    command.run({ kind: 'transition', body: { to: 'cancelled', reason: normalizeName(reason) } }, (saved) => {
      showToast(t('workOrder.milestoneDialog.cancelled', { name: saved.name }));
      onSaved(saved);
    });
  };

  return (
    <>
      <Dialog
        open={!discarding}
        size="sm"
        title={t('workOrder.milestoneDialog.cancelTitle', { name: opened.name })}
        closeLabel={t('workOrder.milestoneDialog.close')}
        describedBy={`${subtitleId} ${effectId}`}
        onDismiss={dismiss}
        actions={
          <>
            <Button variant="tertiary" onClick={dismiss}>
              {t('workOrder.milestoneDialog.cancel')}
            </Button>
            <Button
              type="submit"
              form={formId}
              variant="danger"
              loading={command.pending}
              disabled={!online}
              {...(online ? {} : { title: t('workOrder.milestoneDialog.offline') })}
            >
              {t('workOrder.milestoneDialog.cancelSubmit')}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          noValidate
          className="flex flex-col gap-stack-md"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <p id={subtitleId} className="text-body-sm text-text-secondary">
            {t('workOrder.milestoneDialog.subtitle', { number: order.number, title: order.title })}
          </p>
          {online ? null : <Banner icon={WifiOff}>{t('workOrder.milestoneDialog.offline')}</Banner>}
          <CommandAlert
            failure={command.failure}
            orderStatus={order.status}
            onRefresh={() => {
              if (!command.adopt()) onClose();
            }}
          />
          <MilestoneSummary
            rows={[
              [t('workOrder.milestoneDialog.summaryMilestone'), nameOf(opened)],
              ...(opened.sharePercent === null
                ? []
                : [
                    [
                      t('workOrder.milestoneDialog.summaryShare'),
                      t('workOrder.milestoneDialog.shareValue', { share: opened.sharePercent }),
                    ] as const,
                  ]),
            ]}
          />
          <TextArea
            label={t('workOrder.milestoneDialog.reason')}
            value={reason}
            hint={t('workOrder.milestoneDialog.reasonHint', {
              length: length.toLocaleString('pl-PL'),
              max: MILESTONE_REASON_MAX.toLocaleString('pl-PL'),
            })}
            {...(error === undefined ? {} : { error })}
            onChange={(event) => {
              setReason(event.target.value);
              command.setFieldErrors({});
            }}
          />
          <p id={effectId} className="text-body">
            {t('workOrder.milestoneDialog.cancelEffect')}
          </p>
        </form>
      </Dialog>
      <DiscardDialog
        open={discarding}
        onConfirm={onClose}
        onBack={() => {
          setDiscarding(false);
        }}
      />
    </>
  );
}

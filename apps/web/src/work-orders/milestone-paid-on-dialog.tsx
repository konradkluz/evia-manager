import type { PaymentMilestone, WorkOrderDetails } from '@evia/contracts';
import { Banner, Button, DateField, Dialog, WifiOff } from '@evia/ui-web';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DiscardDialog } from '../forms/discard-dialog.tsx';
import { serverNow } from '../session/server-clock.ts';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { CommandAlert, useFieldMessage, useMilestoneCommand } from './milestone-command.tsx';
import { DAY_MIN, isDayInRange } from './milestone-days.ts';
import { useMilestoneName } from './milestone-form.ts';
import { formatDueDate } from './procedure-format.ts';
import { todayWarsaw } from './transition-actions.ts';

/**
 * "Popraw datę wpłaty" (EVM-054 AC4; dialog 5 of "UX / UI"): a plain dialog with "Data wpłaty" of a paid instalment (not later than
 * today — `400 in_future` of the server shows the same message, Q3e). The same day as before closes the dialog without a request.
 */
export function MilestonePaidOnDialog({
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
  const [opened] = useState(milestone);
  const [today] = useState(() => todayWarsaw(serverNow()));
  const initial = opened.paidOn ?? '';
  const [paidOn, setPaidOn] = useState(initial);
  const [discarding, setDiscarding] = useState(false);
  const command = useMilestoneCommand(order, opened);
  const error = command.fieldErrors.paidOn;
  const dirty = paidOn !== initial;

  const dismiss = () => {
    if (dirty && !command.pending) setDiscarding(true);
    else onClose();
  };

  const submit = () => {
    if (!online) return;
    let problem: string | undefined;
    if (!isDayInRange(paidOn)) problem = message('paidOn', 'out_of_range');
    else if (paidOn > today) problem = message('paidOn', 'in_future');
    command.setFieldErrors(problem === undefined ? {} : { paidOn: problem });
    if (problem !== undefined) return;
    if (!dirty) {
      onClose();
      return;
    }
    command.run({ kind: 'patch', body: { paidOn } }, (saved) => {
      showToast(t('workOrder.milestoneDialog.paidOnSaved', { date: formatDueDate(saved.paidOn ?? paidOn) }));
      onSaved(saved);
    });
  };

  return (
    <>
      <Dialog
        open={!discarding}
        size="sm"
        title={t('workOrder.milestoneDialog.paidOnTitle')}
        closeLabel={t('workOrder.milestoneDialog.close')}
        onDismiss={dismiss}
        actions={
          <>
            <Button variant="tertiary" onClick={dismiss}>
              {t('workOrder.milestoneDialog.cancel')}
            </Button>
            <Button
              type="submit"
              form={formId}
              loading={command.pending}
              disabled={!online}
              {...(online ? {} : { title: t('workOrder.milestoneDialog.offline') })}
            >
              {t('workOrder.milestoneDialog.paidOnSubmit')}
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
          <p className="text-body-sm text-text-secondary">
            {t('workOrder.milestoneDialog.milestoneSubtitle', { milestone: nameOf(opened), number: order.number })}
          </p>
          {online ? null : <Banner icon={WifiOff}>{t('workOrder.milestoneDialog.offline')}</Banner>}
          <CommandAlert
            failure={command.failure}
            orderStatus={order.status}
            onRefresh={() => {
              if (!command.adopt()) onClose();
            }}
          />
          <DateField
            label={t('workOrder.milestoneDialog.paidOn')}
            value={paidOn}
            min={DAY_MIN}
            max={today}
            hint={t('workOrder.milestoneDialog.paidOnHint')}
            {...(error === undefined ? {} : { error })}
            onChange={(value) => {
              setPaidOn(value);
              command.setFieldErrors({});
            }}
          />
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

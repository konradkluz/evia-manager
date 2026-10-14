import type { PaymentMilestone, PaymentMilestonePatch } from '@evia/contracts';
import { Banner, Button, DateField, Dialog, ErrorSummary, TextField, WifiOff } from '@evia/ui-web';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DiscardDialog } from '../forms/discard-dialog.tsx';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import {
  CommandAlert,
  DAY_MAX,
  DAY_MIN,
  INVOICE_NUMBER_MAX,
  isDayInRange,
  plainTextProblem,
  useFieldMessage,
  useMilestoneCommand,
  type MilestoneField,
  type MilestoneOrder,
  type MilestoneFieldErrors,
} from './milestone-command.tsx';
import { normalizeName, useMilestoneName } from './milestone-form.ts';
import { formatMoney } from './money.ts';

/**
 * "Popraw dane faktury" (EVM-054 AC4; dialog 4 of "UX / UI"): a plain dialog — the same role reverses it — with "Nr faktury lub
 * proformy", "Data wystawienia" and "Termin płatności" of an invoiced instalment; the amount is read only ("Kwotę zmieni
 * administrator korektą płatności."). Only the changed fields go to the server (`PATCH` merge with `If-Match`); "Zapisz zmiany" is
 * active after a change. The due date is checked against the date of the invoice after the change (Q3b); changing the date of the
 * invoice does not move the due date.
 */
export function MilestoneDetailsDialog({
  order,
  milestone,
  onClose,
  onSaved,
}: {
  readonly order: MilestoneOrder;
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
  const fields = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [opened] = useState(milestone);
  const initial = { invoiceNumber: opened.invoiceNumber ?? '', invoicedOn: opened.invoicedOn ?? '', dueDate: opened.dueDate ?? '' };
  const [invoiceNumber, setInvoiceNumber] = useState(initial.invoiceNumber);
  const [invoicedOn, setInvoicedOn] = useState(initial.invoicedOn);
  const [dueDate, setDueDate] = useState(initial.dueDate);
  const [refusals, setRefusals] = useState(0);
  const [discarding, setDiscarding] = useState(false);
  const command = useMilestoneCommand(order, opened);
  const errors = command.fieldErrors;
  const numberChanged = normalizeName(invoiceNumber) !== initial.invoiceNumber;
  const dirty = numberChanged || invoicedOn !== initial.invoicedOn || dueDate !== initial.dueDate;

  useEffect(() => {
    if (refusals > 0) summaryRef.current?.focus();
  }, [refusals]);

  const clearError = (field: MilestoneField) => {
    if (errors[field] === undefined) return;
    command.setFieldErrors(Object.fromEntries(Object.entries(errors).filter(([name]) => name !== field)));
  };

  const dismiss = () => {
    if (dirty && !command.pending) setDiscarding(true);
    else onClose();
  };

  const submit = () => {
    if (!online || !dirty) return;
    const found: MilestoneFieldErrors = {};
    const numberProblem = plainTextProblem(invoiceNumber, INVOICE_NUMBER_MAX);
    if (numberProblem !== undefined) found.invoiceNumber = message('invoiceNumber', numberProblem);
    if (!isDayInRange(invoicedOn)) found.invoicedOn = message('invoicedOn', 'out_of_range');
    if (dueDate === '') found.dueDate = message('dueDate', 'required');
    else if (!isDayInRange(dueDate)) found.dueDate = message('dueDate', 'out_of_range');
    else if (found.invoicedOn === undefined && dueDate < invoicedOn) {
      // the server points at the date of the invoice when only that one changed (the check runs on the state after the change)
      if (dueDate === initial.dueDate) found.invoicedOn = message('invoicedOn', 'before_invoiced_on');
      else found.dueDate = message('dueDate', 'before_invoiced_on');
    }
    command.setFieldErrors(found);
    if (Object.keys(found).length > 0) {
      setRefusals((count) => count + 1);
      return;
    }
    const body: PaymentMilestonePatch = {
      ...(numberChanged ? { invoiceNumber: normalizeName(invoiceNumber) } : {}),
      ...(invoicedOn === initial.invoicedOn ? {} : { invoicedOn }),
      ...(dueDate === initial.dueDate ? {} : { dueDate }),
    };
    command.run({ kind: 'patch', body }, (saved) => {
      showToast(t('workOrder.milestoneDialog.detailsSaved', { number: saved.invoiceNumber ?? '' }));
      onSaved(saved);
    });
  };

  const summaryItems = (['invoiceNumber', 'invoicedOn', 'dueDate'] as const).flatMap((field) => {
    const text = errors[field];
    return text === undefined ? [] : [{ field, message: text }];
  });
  const submitHint = online ? undefined : t('workOrder.milestoneDialog.offline');

  return (
    <>
      <Dialog
        open={!discarding}
        size="sm"
        title={t('workOrder.milestoneDialog.detailsTitle')}
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
              disabled={!online || !dirty}
              {...(submitHint === undefined ? {} : { title: submitHint })}
            >
              {t('workOrder.milestoneDialog.detailsSubmit')}
            </Button>
          </>
        }
      >
        <form
          ref={fields}
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
          {summaryItems.length > 0 ? (
            <ErrorSummary
              title={t('workOrder.milestoneDialog.detailsErrors')}
              items={summaryItems}
              onSelect={(field) => {
                fields.current?.querySelector<HTMLElement>(`[data-field="${field}"] input`)?.focus();
              }}
              summaryRef={summaryRef}
            />
          ) : null}
          <div data-field="invoiceNumber">
            <TextField
              label={t('workOrder.milestoneDialog.invoiceNumber')}
              value={invoiceNumber}
              {...(errors.invoiceNumber === undefined ? {} : { error: errors.invoiceNumber })}
              onChange={(event) => {
                setInvoiceNumber(event.target.value);
                clearError('invoiceNumber');
              }}
            />
          </div>
          <div className="flex flex-col gap-stack-md expanded:flex-row">
            <div data-field="invoicedOn" className="expanded:flex-1">
              <DateField
                label={t('workOrder.milestoneDialog.invoicedOn')}
                value={invoicedOn}
                min={DAY_MIN}
                max={DAY_MAX}
                {...(errors.invoicedOn === undefined ? {} : { error: errors.invoicedOn })}
                onChange={(value) => {
                  setInvoicedOn(value);
                  clearError('invoicedOn');
                }}
              />
            </div>
            <div data-field="dueDate" className="expanded:flex-1">
              <DateField
                label={t('workOrder.milestoneDialog.dueDate')}
                value={dueDate}
                min={DAY_MIN}
                max={DAY_MAX}
                {...(errors.dueDate === undefined ? {} : { error: errors.dueDate })}
                onChange={(value) => {
                  setDueDate(value);
                  clearError('dueDate');
                }}
              />
            </div>
          </div>
          <div className="flex flex-col gap-stack-xs text-body-sm">
            <p className="tabular-nums text-text-primary">
              {t('workOrder.milestoneDialog.amountReadOnly', {
                amount: opened.amount === null ? t('workOrder.milestoneDialog.summaryNone') : formatMoney(opened.amount.amountMinor),
              })}
            </p>
            <p className="text-text-secondary">{t('workOrder.milestoneDialog.amountReadOnlyHint')}</p>
          </div>
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

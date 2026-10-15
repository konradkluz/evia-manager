import type { PaymentMilestone, WorkOrderDetails } from '@evia/contracts';
import { Banner, Button, DateField, Dialog, ErrorSummary, TextField, WifiOff } from '@evia/ui-web';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DiscardDialog } from '../forms/discard-dialog.tsx';
import { serverNow } from '../session/server-clock.ts';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import {
  addDays,
  CommandAlert,
  INVOICE_NUMBER_MAX,
  plainTextProblem,
  useFieldMessage,
  useMilestoneCommand,
  type MilestoneField,
  type MilestoneFieldErrors,
} from './milestone-command.tsx';
import { DAY_MAX, DAY_MIN, isDayInRange } from './milestone-days.ts';
import { normalizeName, useAmountError, useMilestoneName } from './milestone-form.ts';
import { MilestoneSummary } from './milestone-summary.tsx';
import { amountInputOf, formatAmountInput, formatMoney, parseAmount } from './money.ts';
import { formatDueDate } from './procedure-format.ts';
import { todayWarsaw } from './transition-actions.ts';

/**
 * "Wystawić fakturę dla transzy „…”?" (EVM-054 AC1; dialog 1 of "UX / UI"): a dialog with a summary (§ 4.11) and fields — the
 * amount (the one of the instalment, if any), "Nr faktury lub proformy", "Data wystawienia" (today by default; 2000–2100, may be in
 * the future — Q3a) and "Termin płatności" (the date of the invoice + the days of the plan, recomputed with the date until the
 * person changes it; an instalment added by hand has no days — empty and required, Q3c; not earlier than the invoice — Q3b). The
 * focus starts in the first field. The default due date is counted by the server: the panel sends `dueDate` only when the person
 * set it or the plan has no days. A due date in the past is a hint, not an error. The toast has no "Cofnij": only the Administrator
 * withdraws an invoice (EVM-057).
 */
export function MilestoneInvoiceDialog({
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
  const amountError = useAmountError();
  const message = useFieldMessage();
  const formId = useId();
  const subtitleId = useId();
  const effectId = useId();
  const fields = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [opened] = useState(milestone);
  const [today] = useState(() => todayWarsaw(serverNow()));
  const days = opened.paymentTermDays;
  const [initialAmount] = useState(() => amountInputOf(opened.amount?.amountMinor));
  const [amount, setAmount] = useState(initialAmount);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoicedOn, setInvoicedOn] = useState(today);
  const [dueDate, setDueDate] = useState(days === null ? '' : addDays(today, days));
  const [dueTouched, setDueTouched] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  /** Bumped by every refused commit: the summary of the errors takes the focus once it is rendered (§ 4.1). */
  const [refusals, setRefusals] = useState(0);
  const [discarding, setDiscarding] = useState(false);
  const command = useMilestoneCommand(order, opened);
  const errors = command.fieldErrors;
  const dirty = amount !== initialAmount || invoiceNumber !== '' || invoicedOn !== today || dueTouched;

  const clearError = (field: MilestoneField) => {
    if (errors[field] === undefined) return;
    command.setFieldErrors(Object.fromEntries(Object.entries(errors).filter(([name]) => name !== field)));
  };

  useEffect(() => {
    if (refusals > 0) summaryRef.current?.focus();
  }, [refusals]);

  const dismiss = () => {
    if (dirty && !command.pending) setDiscarding(true);
    else onClose();
  };

  const focusField = (field: string) => {
    fields.current?.querySelector<HTMLElement>(`[data-field="${field}"] input`)?.focus();
  };

  const submit = () => {
    if (!online) return;
    const parsed = parseAmount(amount);
    const found: MilestoneFieldErrors = {};
    const amountProblem = amountError(parsed, true);
    if (amountProblem !== undefined) found.amount = amountProblem;
    const numberProblem = plainTextProblem(invoiceNumber, INVOICE_NUMBER_MAX);
    if (numberProblem !== undefined) found.invoiceNumber = message('invoiceNumber', numberProblem);
    if (!isDayInRange(invoicedOn)) found.invoicedOn = message('invoicedOn', 'out_of_range');
    if (dueDate === '') found.dueDate = message('dueDate', 'required');
    else if (!isDayInRange(dueDate)) found.dueDate = message('dueDate', 'out_of_range');
    else if (found.invoicedOn === undefined && dueDate < invoicedOn) found.dueDate = message('dueDate', 'before_invoiced_on');
    command.setFieldErrors(found);
    if (Object.keys(found).length > 0 || parsed.kind !== 'amount') {
      setShowSummary(true);
      setRefusals((count) => count + 1);
      return;
    }
    setShowSummary(false);
    command.run(
      {
        kind: 'transition',
        body: {
          to: 'invoiced',
          amount: { amountMinor: parsed.amountMinor, currency: 'PLN' },
          invoiceNumber: normalizeName(invoiceNumber),
          invoicedOn,
          ...(dueTouched || days === null ? { dueDate } : {}),
        },
      },
      (saved) => {
        showToast(
          t('workOrder.milestoneDialog.invoiced', {
            number: saved.invoiceNumber ?? '',
            amount: saved.amount === null ? '' : formatMoney(saved.amount.amountMinor),
            dueDate: saved.dueDate === null ? '' : formatDueDate(saved.dueDate),
          }),
        );
        onSaved(saved);
      },
    );
  };

  const parsedAmount = parseAmount(amount);
  const none = t('workOrder.milestoneDialog.summaryNone');
  const dayText = (day: string) => (isDayInRange(day) ? formatDueDate(day) : none);
  const summaryItems = (['amount', 'invoiceNumber', 'invoicedOn', 'dueDate'] as const).flatMap((field) => {
    const text = errors[field];
    return text === undefined ? [] : [{ field, message: text }];
  });
  const duePast = errors.dueDate === undefined && isDayInRange(dueDate) && dueDate < today;

  return (
    <>
      <Dialog
        open={!discarding}
        size="sm"
        title={t('workOrder.milestoneDialog.invoiceTitle', { name: opened.name })}
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
              loading={command.pending}
              disabled={!online}
              {...(online ? {} : { title: t('workOrder.milestoneDialog.offline') })}
            >
              {t('workOrder.milestoneDialog.invoiceSubmit')}
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
          {showSummary && summaryItems.length > 0 ? (
            <ErrorSummary
              title={t('workOrder.milestoneDialog.invoiceErrors')}
              items={summaryItems}
              onSelect={focusField}
              summaryRef={summaryRef}
            />
          ) : null}
          <div data-field="amount">
            <TextField
              label={t('workOrder.milestoneDialog.amount')}
              value={amount}
              suffix={t('workOrder.milestoneDialog.currency')}
              inputMode="decimal"
              {...(errors.amount === undefined ? {} : { error: errors.amount })}
              onChange={(event) => {
                setAmount(event.target.value);
                clearError('amount');
              }}
              onBlur={() => {
                setAmount((typed) => formatAmountInput(typed));
              }}
            />
          </div>
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
                  if (!dueTouched && days !== null && isDayInRange(value)) setDueDate(addDays(value, days));
                }}
              />
            </div>
            <div data-field="dueDate" className="expanded:flex-1">
              <DateField
                label={t('workOrder.milestoneDialog.dueDate')}
                value={dueDate}
                min={isDayInRange(invoicedOn) ? invoicedOn : DAY_MIN}
                max={DAY_MAX}
                {...(duePast ? { hint: t('workOrder.milestoneDialog.dueDatePast') } : {})}
                {...(errors.dueDate === undefined ? {} : { error: errors.dueDate })}
                onChange={(value) => {
                  setDueDate(value);
                  setDueTouched(true);
                  clearError('dueDate');
                }}
              />
            </div>
          </div>
          <MilestoneSummary
            rows={[
              [t('workOrder.milestoneDialog.summaryMilestone'), nameOf(opened)],
              [t('workOrder.milestoneDialog.summaryOrder'), order.number],
              [t('workOrder.milestoneDialog.summaryAmount'), parsedAmount.kind === 'amount' ? formatMoney(parsedAmount.amountMinor) : none],
              [t('workOrder.milestoneDialog.summaryInvoice'), normalizeName(invoiceNumber) === '' ? none : normalizeName(invoiceNumber)],
              [t('workOrder.milestoneDialog.summaryInvoicedOn'), dayText(invoicedOn)],
              [t('workOrder.milestoneDialog.summaryDueDate'), dayText(dueDate)],
            ]}
          />
          <p id={effectId} className="text-body">
            {t('workOrder.milestoneDialog.invoiceEffect')}
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

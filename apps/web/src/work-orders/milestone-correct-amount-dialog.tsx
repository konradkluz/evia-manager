import type { PaymentMilestone } from '@evia/contracts';
import { Banner, Button, Dialog, TextField, WifiOff } from '@evia/ui-web';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { CommandAlert, useMilestoneCommand, type MilestoneOrder } from './milestone-command.tsx';
import { CorrectionLine, CorrectionState, useCorrectionStepUp, type CorrectionMilestone } from './milestone-correction-dialog.tsx';
import { useAmountError } from './milestone-form.ts';
import { amountInputOf, formatAmountInput, formatMoney, parseAmount } from './money.ts';

/**
 * K4 "Zmienić kwotę transzy „…”?" (EVM-057 AC3; the story → "UX / UI" → "Dialogi"): the correction of the amount of an instalment
 * "Wystawiona" or "Opłacona" — the field "Nowa kwota" (the rules of EVM-053/054, sent in grosze with `If-Match`), the summary "3 600,00 zł →
 * 3 690,00 zł" updated while typing, the status and the invoice unchanged, and "Operacja zostanie zapisana w dzienniku audytu.". The
 * button stays disabled while the amount equals the current one. `403 step_up_required` opens W-04 instead of this dialog (the typed
 * amount stays) and repeats the same `PATCH` once confirmed; "Anuluj" of W-04 brings the dialog back with "Nie wykonano korekty.".
 */
export function MilestoneCorrectAmountDialog({
  order,
  milestone,
  onClose,
  onSaved,
}: {
  readonly order: MilestoneOrder;
  readonly milestone: CorrectionMilestone;
  readonly onClose: () => void;
  readonly onSaved: (saved: PaymentMilestone) => void;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const showToast = useToast();
  const amountError = useAmountError();
  const stepUpOf = useCorrectionStepUp();
  const formId = useId();
  const subtitleId = useId();
  const effectId = useId();
  const field = useRef<HTMLInputElement>(null);
  const [opened] = useState(milestone);
  const [amount, setAmount] = useState(() => amountInputOf(opened.amount?.amountMinor));
  const [error, setError] = useState<string | undefined>(undefined);
  const command = useMilestoneCommand(order, opened);
  const none = t('workOrder.correction.none');
  const before = opened.amount === null ? none : formatMoney(opened.amount.amountMinor);
  const parsed = parseAmount(amount);
  const after = parsed.kind === 'amount' ? formatMoney(parsed.amountMinor) : undefined;
  const unchanged = parsed.kind === 'amount' && parsed.amountMinor === opened.amount?.amountMinor;
  const blocked = !online || unchanged || command.failure?.kind === 'closed';
  const fieldError = error ?? command.fieldErrors.amount;

  // The field takes the focus with its value selected, so that typing replaces it (the story → "Fokus"); also when the dialog returns
  // after W-04 (the field is rendered anew).
  useEffect(() => {
    if (!command.stepping) field.current?.select();
  }, [command.stepping]);

  const dismiss = () => {
    if (!command.pending) onClose();
  };

  const submit = () => {
    if (blocked) return;
    const found = amountError(parsed, true);
    setError(found);
    if (found !== undefined || parsed.kind !== 'amount') return;
    const changed = formatMoney(parsed.amountMinor);
    command.run(
      { kind: 'patch', body: { amount: { amountMinor: parsed.amountMinor, currency: 'PLN' } } },
      (saved) => {
        showToast(t('workOrder.correction.amountCorrected', { name: saved.name, before, after: changed }));
        onSaved(saved);
      },
      stepUpOf(order, opened, t('workOrder.correction.amountStepUp', { name: opened.name, before, after: changed })),
    );
  };

  return (
    <Dialog
      open={!command.stepping}
      size="sm"
      title={t('workOrder.correction.amountTitle', { name: opened.name })}
      closeLabel={t('workOrder.correction.close')}
      describedBy={`${subtitleId} ${effectId}`}
      onDismiss={dismiss}
      actions={
        <>
          <Button variant="tertiary" onClick={dismiss}>
            {t('workOrder.correction.cancel')}
          </Button>
          <Button
            type="submit"
            form={formId}
            loading={command.pending}
            disabled={blocked}
            {...(online ? {} : { title: t('workOrder.correction.offline') })}
          >
            {t('workOrder.correction.amountSubmit')}
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
          {t('workOrder.correction.subtitle', { number: order.number, title: order.title, name: opened.name })}
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
        <TextField
          label={t('workOrder.correction.newAmount')}
          value={amount}
          suffix={t('workOrder.correction.currency')}
          inputMode="decimal"
          inputRef={field}
          {...(fieldError === undefined ? {} : { error: fieldError })}
          onChange={(event) => {
            setAmount(event.target.value);
            setError(undefined);
            command.setFieldErrors({});
          }}
          onBlur={() => {
            setAmount((typed) => formatAmountInput(typed));
          }}
        />
        <div className="flex flex-col gap-stack-xs text-body">
          <CorrectionLine label={t('workOrder.correction.amount')}>
            {after === undefined || unchanged ? before : t('workOrder.correction.change', { before, after })}
          </CorrectionLine>
          <CorrectionState from={opened.status} />
          <CorrectionLine label={t('workOrder.correction.invoice')}>{opened.invoiceNumber ?? none}</CorrectionLine>
        </div>
        <p id={effectId}>{t('workOrder.correction.amountEffect')}</p>
        <p>{t('workOrder.correction.audit')}</p>
      </form>
    </Dialog>
  );
}

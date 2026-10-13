import { updatePaymentMilestone, type PaymentMilestone, type PaymentMilestoneList, type WorkOrderDetails } from '@evia/contracts';
import { Banner, Button, Dialog, InlineAlert, TextField, WifiOff } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { useAttempt } from '../forms/attempt.ts';
import { DiscardDialog } from '../forms/discard-dialog.tsx';
import { describeFailure, refusesAttempt } from '../forms/save-failure.ts';
import { paymentStatusLabels } from '../i18n/payment-labels.ts';
import { useSession } from '../session/session.ts';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { useStateWord } from './edit-failure.ts';
import { etagOf, useAmountError, useMilestoneName } from './milestone-form.ts';
import { amountInputOf, formatAmountInput, formatMoney, parseAmount } from './money.ts';
import { WORK_ORDER_HEADER_KEY, WORK_ORDER_PAYMENTS_KEY } from './query-keys.ts';

type Failure =
  | { readonly kind: 'conflict' | 'closed' | 'gone' | 'forbidden' | 'network' | 'inProgress' }
  | { readonly kind: 'notPlanned'; readonly status: string }
  | { readonly kind: 'rate'; readonly seconds: number }
  | { readonly kind: 'server'; readonly code: string };

const statusLabelOf = (status: string): string | undefined =>
  Object.hasOwn(paymentStatusLabels, status) ? paymentStatusLabels[status as keyof typeof paymentStatusLabels] : undefined;

/**
 * Dialog "Zmień kwotę transzy" of a planned instalment (EVM-053 AC3, AC5, AC7, AC8; flows/08): one field, the gross amount, sent in
 * grosze (`amountMinor`, PLN) with `If-Match` of the version on screen. `412` keeps what was typed and shows "Aktualnie: …" of the
 * instalment read again (the next save uses the fresh version); an instalment that is no longer planned (`403 forbidden`, or seen so
 * after the refresh) says the Administrator changes it with a correction (EVM-057) and the save is disabled; `409
 * work_order_closed` and `404` (also an instalment of another order) are told in the dialog. The share of the plan is information only.
 */
export function MilestoneAmountDialog({
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
  const client = useApi();
  const online = useOnline();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const role = useSession().data?.user.role;
  const stateWord = useStateWord();
  const amountError = useAmountError();
  const nameOf = useMilestoneName();
  const attempt = useAttempt();
  const formId = useId();
  const field = useRef<HTMLInputElement>(null);
  // What the dialog was opened with stays the reference of "changed", also after a refresh of the list.
  const [initial] = useState(() => amountInputOf(milestone.amount?.amountMinor));
  const [amount, setAmount] = useState(initial);
  const [version, setVersion] = useState(milestone.version);
  const [current, setCurrent] = useState<PaymentMilestone | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const paymentsKey = [WORK_ORDER_PAYMENTS_KEY, order.id];
  const dirty = amount !== initial;
  const blocked = failure?.kind === 'notPlanned';

  // The dialog focuses the field; its value is selected so that typing replaces it (flows/08 → "Fokus").
  useEffect(() => {
    field.current?.select();
  }, []);

  const mutation = useMutation({
    mutationFn: (request: { readonly amountMinor: number; readonly key: string; readonly version: number }) =>
      unwrap(
        updatePaymentMilestone({
          client,
          path: { workOrderId: order.id, milestoneId: milestone.id },
          body: { amount: { amountMinor: request.amountMinor, currency: 'PLN' } },
          headers: { 'If-Match': etagOf(request.version), 'Idempotency-Key': request.key },
        }),
      ),
  });

  const dismiss = () => {
    if (dirty && !mutation.isPending) setDiscarding(true);
    else onClose();
  };

  /** Reads the instalments again and returns this one as the server has it now (`undefined` — gone). */
  const refresh = async (): Promise<PaymentMilestone | undefined> => {
    await queryClient.refetchQueries({ queryKey: paymentsKey });
    return queryClient.getQueryData<PaymentMilestoneList>(paymentsKey)?.items.find((entry) => entry.id === milestone.id);
  };

  const notPlannedOr = (fresh: PaymentMilestone | undefined, otherwise: Failure): Failure => {
    if (fresh === undefined) return { kind: 'gone' };
    if (fresh.status !== 'planned') return { kind: 'notPlanned', status: fresh.status };
    return otherwise;
  };

  const submit = () => {
    if (blocked) return;
    const parsed = parseAmount(amount);
    const found = amountError(parsed, true);
    setError(found);
    if (found !== undefined || parsed.kind !== 'amount') return;
    if (milestone.amount?.amountMinor === parsed.amountMinor && version === milestone.version) {
      onClose();
      return;
    }
    const { key } = attempt.next(JSON.stringify({ milestone: milestone.id, version, amountMinor: parsed.amountMinor }));
    setFailure(null);
    mutation.mutate(
      { amountMinor: parsed.amountMinor, key, version },
      {
        onSuccess: (saved) => {
          attempt.forget();
          queryClient.setQueryData<PaymentMilestoneList>(paymentsKey, (list) =>
            list === undefined ? list : { ...list, items: list.items.map((entry) => (entry.id === saved.id ? saved : entry)) },
          );
          void queryClient.invalidateQueries({ queryKey: paymentsKey });
          showToast(
            t('workOrder.paymentDialog.amountSaved', {
              name: saved.name,
              amount: saved.amount === null ? '' : formatMoney(saved.amount.amountMinor),
            }),
          );
          onSaved(saved);
        },
        onError: (failed) => {
          if (refusesAttempt(failed)) attempt.forget();
          if (failed instanceof ApiError && failed.status === 412) {
            setFailure({ kind: 'conflict' });
            // The answer carries no values: the list is read again, "Aktualnie: …" shows it and the next save uses its version.
            void refresh().then((fresh) => {
              if (fresh !== undefined) {
                setVersion(fresh.version);
                setCurrent(fresh);
              }
              setFailure(notPlannedOr(fresh, { kind: 'conflict' }));
            });
            return;
          }
          if (failed instanceof ApiError && failed.status === 403 && failed.code === 'forbidden') {
            void refresh().then((fresh) => {
              setFailure(notPlannedOr(fresh, { kind: 'forbidden' }));
            });
            return;
          }
          if (failed instanceof ApiError && failed.status === 409 && failed.code === 'work_order_closed') {
            setFailure({ kind: 'closed' });
            void queryClient.refetchQueries({ queryKey: [WORK_ORDER_HEADER_KEY, order.id] });
            return;
          }
          if (failed instanceof ApiError && failed.status === 404) {
            setFailure({ kind: 'gone' });
            void queryClient.refetchQueries({ queryKey: paymentsKey });
            return;
          }
          if (failed instanceof ApiError && failed.status === 400 && failed.errors.some((entry) => entry.pointer.startsWith('/amount'))) {
            setError(t('workOrder.paymentDialog.amountRequired'));
            return;
          }
          const generic = describeFailure(failed, false);
          if (generic.kind === 'rate' || generic.kind === 'server') setFailure(generic);
          else setFailure({ kind: generic.kind === 'fields' ? 'network' : generic.kind });
        },
      },
    );
  };

  const failureText = (failed: Failure): string => {
    const state = stateWord(order.status);
    switch (failed.kind) {
      case 'conflict':
        return t('workOrder.paymentDialog.conflict');
      case 'notPlanned':
        return t('workOrder.paymentDialog.notPlanned', { status: statusLabelOf(failed.status) ?? t('workOrders.status.unknown') });
      case 'closed':
        return role === 'editor' ? t('workOrder.paymentDialog.closedEditor', { state }) : t('workOrder.paymentDialog.closed', { state });
      case 'gone':
        return t('workOrder.paymentDialog.milestoneGone');
      case 'forbidden':
        return t('workOrder.paymentDialog.forbidden');
      case 'inProgress':
        return t('workOrder.paymentDialog.inProgress');
      case 'rate':
        return t('workOrder.paymentDialog.rateLimited', { seconds: failed.seconds });
      case 'server':
        return t('workOrder.paymentDialog.server', { code: failed.code });
      case 'network':
        return t('workOrder.paymentDialog.amountNetwork');
    }
  };

  const currentText =
    current === null
      ? undefined
      : t('workOrder.paymentDialog.current', {
          amount: current.amount === null ? t('workOrder.paymentDialog.currentNoAmount') : formatMoney(current.amount.amountMinor),
          status: statusLabelOf(current.status) ?? t('workOrders.status.unknown'),
        });
  const submitHint = !online ? t('workOrder.paymentDialog.offline') : failure?.kind === 'notPlanned' ? failureText(failure) : undefined;

  return (
    <>
      <Dialog
        open={!discarding}
        size="sm"
        title={t('workOrder.paymentDialog.amountTitle')}
        closeLabel={t('workOrder.paymentDialog.close')}
        onDismiss={dismiss}
        actions={
          <>
            <Button variant="tertiary" onClick={dismiss}>
              {t('workOrder.paymentDialog.cancel')}
            </Button>
            <Button
              type="submit"
              form={formId}
              loading={mutation.isPending}
              disabled={submitHint !== undefined}
              {...(submitHint === undefined ? {} : { title: submitHint })}
            >
              {t('workOrder.paymentDialog.amountSubmit')}
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
          <div className="flex flex-col gap-stack-xs text-body-sm text-text-secondary">
            <p>{t('workOrder.paymentDialog.amountSubtitle', { milestone: nameOf(milestone), number: order.number })}</p>
            {milestone.sharePercent === null ? null : <p>{t('workOrder.paymentDialog.share', { share: milestone.sharePercent })}</p>}
          </div>
          {online ? null : <Banner icon={WifiOff}>{t('workOrder.paymentDialog.offline')}</Banner>}
          {failure === null ? null : <InlineAlert tone="error">{failureText(failure)}</InlineAlert>}
          <TextField
            label={t('workOrder.paymentDialog.amount')}
            value={amount}
            suffix={t('workOrder.paymentDialog.currency')}
            inputMode="decimal"
            inputRef={field}
            hint={currentText ?? t('workOrder.paymentDialog.amountHint')}
            {...(error === undefined ? {} : { error })}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
            onBlur={() => {
              setAmount((typed) => formatAmountInput(typed));
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

import { createPaymentMilestone, type PaymentMilestone, type PaymentMilestoneList, type WorkOrderDetails } from '@evia/contracts';
import { Banner, Button, Dialog, InlineAlert, TextField, WifiOff } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { useAttempt } from '../forms/attempt.ts';
import { DiscardDialog } from '../forms/discard-dialog.tsx';
import { describeFailure, refusesAttempt } from '../forms/save-failure.ts';
import { useSession } from '../session/session.ts';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { useStateWord } from './edit-failure.ts';
import { MILESTONE_NAME_MAX, MILESTONES_MAX, nameProblem, normalizeName, useAmountError } from './milestone-form.ts';
import { formatAmountInput, parseAmount } from './money.ts';
import { WORK_ORDER_HEADER_KEY, WORK_ORDER_PAYMENTS_KEY } from './query-keys.ts';

type Failure =
  | { readonly kind: 'limit' | 'closed' | 'gone' | 'forbidden' | 'network' | 'inProgress' }
  | { readonly kind: 'rate'; readonly seconds: number }
  | { readonly kind: 'server'; readonly code: string };

interface FieldErrors {
  name?: string | undefined;
  amount?: string | undefined;
}

/**
 * Dialog "Dodaj transzę" (EVM-053 AC4, AC5, AC8; flows/08 → "Dialogi „Dodaj transzę” i „Zmień kwotę”"): the name (required,
 * plain text, at most 120 characters) and an optional amount. The instalment gets its identifier (UUIDv7) and the
 * `Idempotency-Key` here; a retry of the same content sends the same pair, so a lost answer never adds a second instalment.
 * `422 limit_exceeded` (the 21st), `409 work_order_closed` and the errors of the fields are told in the dialog, and what was
 * typed stays. The name may be free text about a person: it lives in this component only and never goes to a log.
 */
export function MilestoneAddDialog({
  order,
  onClose,
  onSaved,
}: {
  readonly order: WorkOrderDetails;
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
  const attempt = useAttempt();
  const formId = useId();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const paymentsKey = [WORK_ORDER_PAYMENTS_KEY, order.id];
  const dirty = name.trim() !== '' || amount.trim() !== '';

  const mutation = useMutation({
    mutationFn: (request: { readonly body: Parameters<typeof createPaymentMilestone>[0]['body']; readonly key: string }) =>
      unwrap(
        createPaymentMilestone({
          client,
          path: { workOrderId: order.id },
          body: request.body,
          headers: { 'Idempotency-Key': request.key },
        }),
      ),
  });

  const dismiss = () => {
    if (dirty && !mutation.isPending) setDiscarding(true);
    else onClose();
  };

  const nameError = (code: string | undefined): string | undefined => {
    if (code === undefined) return undefined;
    if (code === 'required') return t('workOrder.paymentDialog.nameRequired');
    if (code === 'too_long') return t('workOrder.paymentDialog.nameTooLong', { max: MILESTONE_NAME_MAX });
    return t('workOrder.paymentDialog.nameInvalid');
  };

  const submit = () => {
    const parsed = parseAmount(amount);
    const found: FieldErrors = { name: nameError(nameProblem(name)), amount: amountError(parsed, false) };
    setErrors(found);
    if (found.name !== undefined || found.amount !== undefined) return;
    const body = {
      name: normalizeName(name),
      ...(parsed.kind === 'amount' ? { amount: { amountMinor: parsed.amountMinor, currency: 'PLN' as const } } : {}),
    };
    // The same content is the same instalment: the identifier and the key are kept for a retry (EVM-053 AC4).
    const { id, key } = attempt.next(JSON.stringify(body));
    setFailure(null);
    mutation.mutate(
      { body: { id, ...body }, key },
      {
        onSuccess: (saved) => {
          attempt.forget();
          queryClient.setQueryData<PaymentMilestoneList>(paymentsKey, (list) =>
            list === undefined ? list : { ...list, items: [...list.items.filter((entry) => entry.id !== saved.id), saved] },
          );
          void queryClient.invalidateQueries({ queryKey: paymentsKey });
          showToast(t('workOrder.paymentDialog.added', { name: saved.name }));
          onSaved(saved);
        },
        onError: (error) => {
          if (refusesAttempt(error)) attempt.forget();
          if (error instanceof ApiError && error.status === 422 && error.code === 'limit_exceeded') {
            setFailure({ kind: 'limit' });
            void queryClient.refetchQueries({ queryKey: paymentsKey });
            return;
          }
          if (error instanceof ApiError && error.status === 409 && error.code === 'work_order_closed') {
            setFailure({ kind: 'closed' });
            void queryClient.refetchQueries({ queryKey: [WORK_ORDER_HEADER_KEY, order.id] });
            return;
          }
          if (error instanceof ApiError && error.status === 404) {
            setFailure({ kind: 'gone' });
            return;
          }
          if (error instanceof ApiError && error.status === 400) {
            const mapped: FieldErrors = {};
            for (const entry of error.errors) {
              if (entry.pointer === '/name') mapped.name = nameError(entry.code);
              else if (entry.pointer.startsWith('/amount')) mapped.amount = t('workOrder.paymentDialog.amountRequired');
            }
            if (mapped.name !== undefined || mapped.amount !== undefined) {
              setErrors(mapped);
              return;
            }
          }
          const generic = describeFailure(error, false);
          if (generic.kind === 'rate' || generic.kind === 'server') setFailure(generic);
          else setFailure({ kind: generic.kind === 'fields' ? 'network' : generic.kind });
        },
      },
    );
  };

  const failureText = (failed: Failure): string => {
    const state = stateWord(order.status);
    switch (failed.kind) {
      case 'limit':
        return t('workOrder.paymentDialog.limit', { max: MILESTONES_MAX });
      case 'closed':
        return role === 'editor' ? t('workOrder.paymentDialog.closedEditor', { state }) : t('workOrder.paymentDialog.closed', { state });
      case 'gone':
        return t('workOrder.paymentDialog.orderGone');
      case 'forbidden':
        return t('workOrder.paymentDialog.forbidden');
      case 'inProgress':
        return t('workOrder.paymentDialog.inProgress');
      case 'rate':
        return t('workOrder.paymentDialog.rateLimited', { seconds: failed.seconds });
      case 'server':
        return t('workOrder.paymentDialog.server', { code: failed.code });
      case 'network':
        return t('workOrder.paymentDialog.addNetwork');
    }
  };

  return (
    <>
      <Dialog
        open={!discarding}
        size="sm"
        title={t('workOrder.paymentDialog.addTitle')}
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
              disabled={!online}
              {...(online ? {} : { title: t('workOrder.paymentDialog.offline') })}
            >
              {t('workOrder.paymentDialog.addSubmit')}
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
            {t('workOrder.paymentDialog.addSubtitle', { number: order.number, title: order.title })}
          </p>
          {online ? null : <Banner icon={WifiOff}>{t('workOrder.paymentDialog.offline')}</Banner>}
          {failure === null ? null : <InlineAlert tone="error">{failureText(failure)}</InlineAlert>}
          <TextField
            label={t('workOrder.paymentDialog.name')}
            value={name}
            {...(errors.name === undefined ? {} : { error: errors.name })}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          <TextField
            label={t('workOrder.paymentDialog.amountOptional')}
            value={amount}
            suffix={t('workOrder.paymentDialog.currency')}
            inputMode="decimal"
            hint={t('workOrder.paymentDialog.amountLaterHint')}
            {...(errors.amount === undefined ? {} : { error: errors.amount })}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
            onBlur={() => {
              setAmount((current) => formatAmountInput(current));
            }}
          />
          <p className="text-body-sm text-text-secondary">{t('workOrder.paymentDialog.addNote')}</p>
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

import { assignWorkOrderCustomer, type WorkOrderDetails } from '@evia/contracts';
import { Banner, Button, Dialog, InlineAlert, TriangleAlert } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { CustomerPicker, type PickedCustomer } from '../customers/customer-picker.tsx';
import { useCustomerForm } from '../customers/use-customer-form.tsx';
import { useAttempt } from '../forms/attempt.ts';
import { DiscardDialog } from '../forms/discard-dialog.tsx';
import { refusesAttempt } from '../forms/save-failure.ts';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { HintedButton } from './hinted-button.tsx';
import { WORK_ORDER_HEADER_KEY, WORK_ORDER_JOURNAL_KEY, WORK_ORDERS_KEY } from './query-keys.ts';
import { assignText, surveyText } from './site-survey-labels.ts';

type View = 'choose' | 'add' | 'confirm';

type Failure =
  | 'conflict'
  | 'alreadySet'
  | 'customerGone'
  | 'forbidden'
  | 'network'
  | { readonly kind: 'rate'; readonly seconds: number }
  | { readonly kind: 'server'; readonly code: string };

/**
 * Why the assignment did not go through (flows/17 → "Stany dialogu"). `412 version_conflict` and `409 invalid_state_transition` both say
 * the survey is not what the person saw; `409 customer_already_set` that somebody was faster; `422 customer_unavailable` and `404` that the
 * chosen customer is gone. No answer or a 5xx is "network": the retry keeps the key, so the customer is never assigned twice.
 */
export function describeAssignFailure(error: unknown): Failure {
  if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) return 'network';
  if (error.status === 412 || (error.status === 409 && error.code === 'invalid_state_transition')) return 'conflict';
  if (error.status === 409 && error.code === 'customer_already_set') return 'alreadySet';
  if (error.status === 422 && error.code === 'customer_unavailable') return 'customerGone';
  if (error.status === 404) return 'customerGone';
  if (error.status === 403) return 'forbidden';
  if (error.status === 429) return { kind: 'rate', seconds: error.retryAfterSeconds ?? 60 };
  if (error.code === 'idempotency_mismatch' || error.code === 'idempotency_in_progress') return 'network';
  return { kind: 'server', code: error.traceId?.slice(0, 8) ?? error.code };
}

/**
 * "Przypisz klienta" (EVM-138 AC3; flows/17): one dialog with three views — choose a customer (the search of W-05) or add a new one (the
 * form "Dodaj klienta" with the phone of the orderer already in the field), and the confirmation, because the operation cannot be undone
 * (the customer cannot be changed and the phone of the orderer is removed). One dialog at a time, never a dialog on a dialog (§ 3.13): a
 * new customer is saved at once and comes back to the confirmation, so it is not lost when the assignment fails. `PUT …/customer` carries
 * `{customerId, version}` (no `If-Match`) and an `Idempotency-Key` that is the same for a retry of the same survey, version and customer.
 * The phone of the orderer lives in the state of this dialog only (memory of the tab): not in the address, a store, a key or a log.
 */
export function AssignCustomerDialog({
  order,
  onClose,
  onAssigned,
}: {
  readonly order: WorkOrderDetails;
  /** Esc, `x`, "Anuluj". */
  readonly onClose: () => void;
  /** The assignment went through: the page closes the dialog and moves the focus. */
  readonly onAssigned: () => void;
}) {
  const client = useApi();
  const queryClient = useQueryClient();
  const online = useOnline();
  const showToast = useToast();
  const attempt = useAttempt();
  const formId = useId();
  const [view, setView] = useState<View>('choose');
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [added, setAdded] = useState(false);
  // What was typed in the form of a new customer is not dropped without asking (README of the flows, rule 17).
  const [discarding, setDiscarding] = useState<'close' | 'back' | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  const previousView = useRef<View>('choose');
  const orderPhone = order.siteSurvey?.requesterPhone ?? undefined;

  const form = useCustomerForm({
    formId,
    active: view === 'add',
    initialPhone: orderPhone,
    onCreated: (created) => {
      setCustomer(created);
      setAdded(true);
      setFailure(null);
      setView('confirm');
    },
    onPick: (picked) => {
      form.reset();
      setCustomer(picked);
      setFailure(null);
      setView('confirm');
    },
  });

  // The new view is announced by its heading, which takes the focus (not on the first view: the dialog does that itself).
  useEffect(() => {
    if (previousView.current === view) return;
    previousView.current = view;
    heading.current?.focus();
  }, [view]);

  const mutation = useMutation({
    mutationFn: (request: { readonly customerId: string; readonly version: number; readonly key: string }) =>
      unwrap(
        assignWorkOrderCustomer({
          client,
          path: { workOrderId: order.id },
          headers: { 'Idempotency-Key': request.key },
          body: { customerId: request.customerId, version: request.version },
        }),
      ),
  });

  const assign = () => {
    if (customer === null) return;
    const { key } = attempt.next(`${order.id}|${String(order.version)}|${customer.id}`);
    setFailure(null);
    mutation.mutate(
      { customerId: customer.id, version: order.version, key },
      {
        onSuccess: (result) => {
          attempt.forget();
          queryClient.setQueryData([WORK_ORDER_HEADER_KEY, order.id], result);
          void queryClient.invalidateQueries({ queryKey: [WORK_ORDERS_KEY] });
          // The write of the journal ("Przypisano klienta") is shown by an open "Dziennik" without a reload.
          void queryClient.invalidateQueries({ queryKey: [WORK_ORDER_JOURNAL_KEY, order.id] });
          showToast(assignText.assigned);
          onAssigned();
        },
        onError: (error) => {
          if (refusesAttempt(error)) attempt.forget();
          const described = describeAssignFailure(error);
          if (described === 'conflict') void queryClient.refetchQueries({ queryKey: [WORK_ORDER_HEADER_KEY, order.id] });
          if (described === 'customerGone') {
            // The chosen customer is gone: back to the choice with the message, so another one can be picked.
            setCustomer(null);
            setView('choose');
          }
          setFailure(described);
          // The message is announced by its role; the focus moves to it only where the person is looking at the confirmation.
          if (described !== 'customerGone') requestAnimationFrame(() => alert.current?.focus());
        },
      },
    );
  };

  const failureText = (current: Failure): string => {
    if (typeof current === 'object') {
      return current.kind === 'rate' ? assignText.failure.rate(current.seconds) : assignText.failure.server(current.code);
    }
    return {
      conflict: assignText.failure.conflict,
      alreadySet: assignText.failure.alreadySet,
      customerGone: assignText.failure.customerGone,
      forbidden: assignText.failure.forbidden,
      network: assignText.failure.network,
    }[current];
  };

  const backToChoice = () => {
    form.reset();
    setView('choose');
  };
  const dismiss = () => {
    if (view === 'add' && form.dirty) setDiscarding('close');
    else onClose();
  };
  const offline = online ? undefined : surveyText.offlineAssign;
  const alertNode =
    failure === null ? null : (
      <InlineAlert
        tone="error"
        alertRef={alert}
        {...(failure === 'conflict'
          ? {
              action: (
                <Button
                  variant="secondary"
                  onClick={() => {
                    void queryClient.refetchQueries({ queryKey: [WORK_ORDER_HEADER_KEY, order.id] });
                    setFailure(null);
                  }}
                >
                  {assignText.failure.refresh}
                </Button>
              ),
            }
          : {})}
      >
        {failureText(failure)}
      </InlineAlert>
    );

  const viewTitle =
    view === 'add' ? assignText.addNewTitle : view === 'confirm' ? assignText.confirmTitle(order.number) : assignText.chooseTitle;

  return (
    <>
      <Dialog
        open
        title={assignText.title}
        closeLabel={assignText.close}
        onDismiss={dismiss}
        actions={
          view === 'choose' ? (
            <>
              <Button variant="tertiary" onClick={onClose}>
                {assignText.cancel}
              </Button>
              <HintedButton
                hint={offline}
                disabled={customer === null}
                onClick={() => {
                  if (customer !== null) setView('confirm');
                }}
              >
                {assignText.next}
              </HintedButton>
            </>
          ) : view === 'add' ? (
            <>
              <Button
                variant="tertiary"
                onClick={() => {
                  if (form.dirty) setDiscarding('back');
                  else backToChoice();
                }}
              >
                {assignText.backToChoice}
              </Button>
              <Button type="submit" form={formId} loading={form.pending} disabled={!online}>
                {assignText.addNew}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="tertiary"
                onClick={() => {
                  setAdded(false);
                  setFailure(null);
                  setView('choose');
                }}
              >
                {assignText.back}
              </Button>
              <HintedButton
                hint={offline}
                loading={mutation.isPending}
                aria-label={customer === null ? assignText.confirm : assignText.confirmName(customer.displayName, order.number)}
                onClick={assign}
              >
                {assignText.confirm}
              </HintedButton>
            </>
          )
        }
      >
        <h3 ref={heading} tabIndex={-1} className="text-heading-4 text-text-primary focus-visible:focus-ring">
          {viewTitle}
        </h3>
        {alertNode}
        {view === 'confirm' ? (
          <>
            {added ? <InlineAlert tone="success">{assignText.added}</InlineAlert> : null}
            <p className="break-words text-body text-text-primary">
              {customer === null ? '' : assignText.confirmCustomer(customer.displayName)}
            </p>
            <Banner icon={TriangleAlert}>
              <p>{assignText.confirmBody}</p>
            </Banner>
          </>
        ) : view === 'add' ? (
          <>
            {orderPhone === undefined ? null : <InlineAlert tone="info">{assignText.phoneFilled}</InlineAlert>}
            {form.element}
          </>
        ) : (
          <>
            <Banner icon={TriangleAlert}>
              <p>{assignText.once}</p>
            </Banner>
            <CustomerPicker
              selected={customer}
              onSelect={setCustomer}
              onClear={() => {
                setCustomer(null);
              }}
              onAdd={() => {
                setView('add');
              }}
            />
            {customer === null ? (
              <div className="flex flex-wrap items-center gap-inline-md">
                <span className="text-body text-text-secondary">{assignText.or}</span>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setView('add');
                  }}
                >
                  {assignText.addNew}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Dialog>
      <DiscardDialog
        open={discarding !== null}
        onConfirm={() => {
          const target = discarding;
          setDiscarding(null);
          if (target === 'close') onClose();
          else backToChoice();
        }}
        onBack={() => {
          setDiscarding(null);
        }}
      />
    </>
  );
}

import { transitionWorkOrder, type TransitionWorkOrderRequest, type WorkOrderDetails, type WorkOrderStatus } from '@evia/contracts';
import {
  ActionMenu,
  AlertDialog,
  Banner,
  Button,
  DateField,
  Dialog,
  InlineAlert,
  StatusBadge,
  StatusBadgeButton,
  TextArea,
  WifiOff,
  type OrderStatusKey,
} from '@evia/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { useAttempt } from '../forms/attempt.ts';
import { refusesAttempt } from '../forms/save-failure.ts';
import {
  transitionActionLabels,
  transitionDialogLabels,
  transitionFieldLabels,
  transitionToastLabels,
  transitionUndoneToast,
  type TransitionDialogKey,
} from '../i18n/transition-labels.ts';
import { workOrderStatusLabels } from '../i18n/work-order-labels.ts';
import { serverNow } from '../session/server-clock.ts';
import { useSession } from '../session/session.ts';
import { useStepUp } from '../session/step-up-context.tsx';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { WORK_ORDER_HEADER_KEY, WORK_ORDERS_KEY } from './query-keys.ts';
import {
  DIALOG_ACTIONS,
  REASON_MAX,
  describeTransitionFailure,
  menuEntries,
  todayWarsaw,
  type TransitionAction,
  type TransitionEntry,
  type TransitionFailure,
} from './transition-actions.ts';

const isKnown = (status: string): status is WorkOrderStatus => Object.hasOwn(workOrderStatusLabels, status);
const keyOf = (status: WorkOrderStatus): OrderStatusKey => status.replaceAll('_', '-') as OrderStatusKey;
const COMPLETED_ON_MIN = '2000-01-01';

/** Where a failure is shown: in the open dialog, or under the badge (an action without a dialog, or "Cofnij"). */
type Source = 'menu' | 'dialog' | 'undo';

interface Request {
  readonly action: TransitionAction;
  readonly to: WorkOrderStatus;
  readonly reason?: string;
  readonly completedOn?: string;
}

interface FieldErrors {
  reason?: string;
  completedOn?: string;
}

const normalize = (text: string): string => text.normalize('NFC').trim();

function reasonError(t: TFunction, code: string): string {
  if (code === 'too_long') return t('workOrder.status.field.reasonTooLong', { max: REASON_MAX });
  if (code === 'required') return t('workOrder.status.field.reasonRequired');
  return t('workOrder.status.field.reasonInvalid');
}

/**
 * The badge of the status of the order in W-06 and everything it starts (EVM-030): for the Administrator and the Editor the
 * badge is the button of the menu of transitions (`allowedTransitions` of the API; "Przywróć zlecenie…" is disabled for the
 * Editor), for Tylko odczyt it is static. Actions that are cheap to reverse run at once with a toast "[Cofnij]" (which sends
 * the reverse transition of the table, never a `PATCH`); the harmful ones ask first in a dialog with the reason where the
 * table demands it. The restore asks the server, and when it answers `403 step_up_required` opens W-04 — once, no loop.
 *
 * The reason lives in this component only (memory of the tab): not in the address, not in a store of the browser, and it
 * stays when a request fails — also on `429` and offline (AC8). Every request carries `If-Match` of the version on screen and
 * an `Idempotency-Key` that is the same for a retry of the same content (a lost answer never makes a second change).
 */
export function StatusTransitions({ order }: { readonly order: WorkOrderDetails }) {
  const { t } = useTranslation();
  const client = useApi();
  const queryClient = useQueryClient();
  const online = useOnline();
  const showToast = useToast();
  const requestStepUp = useStepUp();
  const role = useSession().data?.user.role;
  const attempt = useAttempt();
  const formId = useId();
  const root = useRef<HTMLDivElement>(null);
  /** The reason of the last hold in this tab — "Cofnij" after "Wznów" sends it again; the API does not return it. */
  const heldReason = useRef<{ readonly orderId: string; readonly reason: string } | null>(null);
  const [dialog, setDialog] = useState<TransitionEntry | null>(null);
  const [reason, setReason] = useState('');
  const [completedOn, setCompletedOn] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ readonly failure: TransitionFailure; readonly source: Source } | null>(null);

  const label = isKnown(order.status) ? workOrderStatusLabels[order.status] : t('workOrders.status.unknown');
  const entries = menuEntries(order, role);

  if (!isKnown(order.status)) {
    return <StatusBadge status="unknown" label={label} hint={t('workOrders.status.unknownHint')} />;
  }
  if (entries.length === 0) {
    return <StatusBadge status={keyOf(order.status)} label={label} />;
  }

  const refreshHeader = () => queryClient.refetchQueries({ queryKey: [WORK_ORDER_HEADER_KEY, order.id] });

  const send = (version: number, request: Request): Promise<WorkOrderDetails> => {
    const body: TransitionWorkOrderRequest = {
      to: request.to,
      ...(request.reason === undefined ? {} : { reason: request.reason }),
      ...(request.completedOn === undefined ? {} : { completedOn: request.completedOn }),
    };
    // The key names the action: the same version and content get the same key on every retry of a lost answer.
    const { key } = attempt.next(`${order.id}|${String(version)}|${JSON.stringify(body)}`);
    return unwrap(
      transitionWorkOrder({
        client,
        path: { workOrderId: order.id },
        headers: { 'If-Match': `"${String(version)}"`, 'Idempotency-Key': key },
        body,
      }),
    );
  };

  /** "Cofnij": the reverse transition of the table with the parameters the person could give by hand (flows/04). */
  const undoOf = (request: Request, before: WorkOrderDetails, after: WorkOrderDetails): (() => void) | undefined => {
    let reverse: Request | undefined;
    if (request.action === 'hold') reverse = { action: 'resume', to: before.status };
    else if (request.action === 'complete') reverse = { action: 'reopen', to: 'in_progress' };
    else if (request.action === 'reopen') {
      reverse = { action: 'complete', to: 'completed', ...(before.completedOn === undefined ? {} : { completedOn: before.completedOn }) };
    } else if (request.action === 'resume' && heldReason.current?.orderId === order.id) {
      reverse = { action: 'hold', to: 'on_hold', reason: heldReason.current.reason };
    }
    if (reverse === undefined) return undefined;
    const chosen = reverse;
    return () => {
      void execute(chosen, after, 'undo');
    };
  };

  /** Runs one transition on the version `base`; `true` when the server accepted it. */
  const execute = async (request: Request, base: WorkOrderDetails, source: Source): Promise<boolean> => {
    setPending(true);
    setFailure(null);
    try {
      let result: WorkOrderDetails;
      try {
        result = await send(base.version, request);
      } catch (error) {
        // Restoring is the one step-up operation: W-04 once, then the same request once more (no loop).
        if (request.action !== 'restore' || describeTransitionFailure(error).kind !== 'stepUp') throw error;
        if (!(await requestStepUp(t('stepUp.title.restoreWorkOrder')))) throw error;
        result = await send(base.version, request);
      }
      attempt.forget();
      queryClient.setQueryData([WORK_ORDER_HEADER_KEY, order.id], result);
      void queryClient.invalidateQueries({ queryKey: [WORK_ORDERS_KEY] });
      setDialog(null);
      setReason('');
      if (source === 'undo') showToast(transitionUndoneToast);
      else {
        if (request.action === 'hold' && request.reason !== undefined) heldReason.current = { orderId: order.id, reason: request.reason };
        const undo = undoOf(request, base, result);
        showToast(
          transitionToastLabels[request.action],
          undo === undefined ? undefined : { label: t('workOrder.status.undo'), onSelect: undo },
        );
      }
      return true;
    } catch (error) {
      if (refusesAttempt(error)) attempt.forget();
      const described = describeTransitionFailure(error);
      if (described.kind === 'conflict') void refreshHeader();
      setFailure({ failure: described, source });
      if (described.kind === 'fields') {
        setFieldErrors({
          ...(described.reason === undefined ? {} : { reason: reasonError(t, described.reason) }),
          ...(described.completedOn === undefined ? {} : { completedOn: t('workOrder.status.field.dateOutOfRange') }),
        });
      }
      return false;
    } finally {
      setPending(false);
    }
  };

  const closeDialog = () => {
    setDialog(null);
    setReason('');
    setFieldErrors({});
    setFailure(null);
    attempt.forget();
  };

  const choose = (entry: TransitionEntry) => {
    setFailure(null);
    setFieldErrors({});
    if (DIALOG_ACTIONS.has(entry.action)) {
      setReason('');
      setCompletedOn(todayWarsaw(serverNow()));
      setDialog(entry);
      return;
    }
    void execute({ action: entry.action, to: entry.to }, order, 'menu');
  };

  const submit = () => {
    if (dialog === null) return;
    let request: Request = { action: dialog.action, to: dialog.to };
    const errors: FieldErrors = {};
    if (dialog.action === 'hold' || dialog.action === 'cancel') {
      const text = normalize(reason);
      if (text === '') errors.reason = t('workOrder.status.field.reasonRequired');
      else if (text.length > REASON_MAX) errors.reason = t('workOrder.status.field.reasonTooLong', { max: REASON_MAX });
      else request = { ...request, reason: text };
    }
    if (dialog.action === 'complete') {
      if (completedOn === '') errors.completedOn = t('workOrder.status.field.dateRequired');
      else if (completedOn > todayWarsaw(serverNow()) || completedOn < COMPLETED_ON_MIN) {
        errors.completedOn = t('workOrder.status.field.dateOutOfRange');
      } else request = { ...request, completedOn };
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    void execute(request, order, 'dialog');
  };

  const items = entries.map((entry) => ({
    id: entry.action,
    label: transitionActionLabels[entry.action],
    onSelect: () => {
      choose(entry);
    },
    ...(!online
      ? { disabledHint: t('workOrder.status.offline') }
      : entry.forbidden === true
        ? { disabledHint: t('workOrder.status.restoreAdminOnly') }
        : {}),
  }));

  const failureText = (current: TransitionFailure, source: Source): string => {
    switch (current.kind) {
      case 'conflict':
        return source === 'undo' ? t('workOrder.status.failure.undoConflict') : t('workOrder.status.failure.conflict');
      case 'forbidden':
        return t('workOrder.status.failure.forbidden');
      case 'stepUp':
        return t('workOrder.status.failure.stepUp');
      case 'condition':
        return t('workOrder.status.failure.condition');
      case 'rate':
        return t('workOrder.status.failure.rateLimited', { seconds: current.seconds });
      case 'network':
      case 'fields':
        return t('workOrder.status.failure.network');
      case 'server':
        return t('workOrder.status.failure.server', { code: current.code });
    }
  };

  const refresh = () => {
    void refreshHeader().then(() => {
      setFailure(null);
      root.current?.querySelector('button')?.focus();
    });
  };

  const alertFor = (source: Source) => {
    // Errors of the fields are shown under the fields; one that has no field to show it (the server named an unexpected pointer) is told here.
    if (failure === null || failure.source !== source) return null;
    if (failure.failure.kind === 'fields' && Object.keys(fieldErrors).length > 0) return null;
    const conflict = failure.failure.kind === 'conflict';
    return (
      <InlineAlert
        tone="error"
        {...(conflict && source !== 'dialog'
          ? {
              action: (
                <Button variant="tertiary" onClick={refresh}>
                  {t('workOrder.status.failure.refresh')}
                </Button>
              ),
            }
          : {})}
      >
        {failureText(failure.failure, source)}
      </InlineAlert>
    );
  };

  const number = order.number;
  const restoreKey = order.status === 'settled' ? 'restoreSettled' : 'restoreCancelled';
  const dialogKey = (action: TransitionAction): TransitionDialogKey =>
    action === 'restore' ? restoreKey : (action as 'hold' | 'cancel' | 'complete' | 'settle');
  const labelsOf = (action: TransitionAction) => transitionDialogLabels[dialogKey(action)];

  return (
    <div ref={root} className="flex flex-col items-start gap-stack-sm">
      <ActionMenu
        label={t('workOrder.status.menu', { number })}
        items={items}
        trigger={(props) => (
          <StatusBadgeButton
            {...props}
            status={keyOf(order.status)}
            label={label}
            aria-label={t('workOrder.status.change', { status: label })}
            {...(online ? {} : { disabledHint: t('workOrder.status.offline') })}
          />
        )}
      />
      {dialog === null ? alertFor('menu') : null}
      {alertFor('undo')}
      {dialog === null ? null : dialog.action === 'settle' || dialog.action === 'restore' ? (
        <AlertDialog
          open
          title={labelsOf(dialog.action).title(number)}
          onDismiss={closeDialog}
          actions={
            <>
              <Button variant="tertiary" data-initial-focus onClick={closeDialog}>
                {t('workOrder.status.cancel')}
              </Button>
              <Button
                loading={pending}
                disabled={!online}
                onClick={() => {
                  void execute({ action: dialog.action, to: dialog.to }, order, 'dialog');
                }}
              >
                {labelsOf(dialog.action).submit}
              </Button>
            </>
          }
        >
          {alertFor('dialog')}
          {online ? null : <Banner icon={WifiOff}>{t('workOrder.status.offline')}</Banner>}
          <p>{labelsOf(dialog.action).description}</p>
        </AlertDialog>
      ) : (
        <Dialog
          open
          title={labelsOf(dialog.action).title(number)}
          closeLabel={t('workOrder.status.close')}
          onDismiss={closeDialog}
          actions={
            <>
              <Button variant="tertiary" onClick={closeDialog}>
                {dialog.action === 'cancel' ? t('workOrder.status.back') : t('workOrder.status.cancel')}
              </Button>
              <Button type="submit" form={formId} loading={pending} disabled={!online}>
                {labelsOf(dialog.action).submit}
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
            {alertFor('dialog')}
            {online ? null : <Banner icon={WifiOff}>{t('workOrder.status.offline')}</Banner>}
            <p>{labelsOf(dialog.action).description}</p>
            {dialog.action === 'complete' ? (
              <DateField
                label={transitionFieldLabels.completedOn}
                value={completedOn}
                min={COMPLETED_ON_MIN}
                max={todayWarsaw(serverNow())}
                {...(fieldErrors.completedOn === undefined ? {} : { error: fieldErrors.completedOn })}
                onChange={(value) => {
                  setCompletedOn(value);
                  setFieldErrors({});
                }}
              />
            ) : (
              <TextArea
                label={dialog.action === 'hold' ? transitionFieldLabels.holdReason : transitionFieldLabels.cancelReason}
                value={reason}
                hint={t('workOrder.status.reasonHint', { max: REASON_MAX })}
                {...(fieldErrors.reason === undefined ? {} : { error: fieldErrors.reason })}
                onChange={(event) => {
                  setReason(event.target.value);
                  setFieldErrors({});
                }}
              />
            )}
          </form>
        </Dialog>
      )}
    </div>
  );
}

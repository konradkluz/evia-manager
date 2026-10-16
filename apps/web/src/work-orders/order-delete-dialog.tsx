import { deleteWorkOrder, type WorkOrderDetails } from '@evia/contracts';
import { AlertDialog, Banner, Button, InlineAlert, WifiOff } from '@evia/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { useAttempt } from '../forms/attempt.ts';
import { refusesAttempt } from '../forms/save-failure.ts';
import { WORK_ORDERS_PATH } from '../paths.ts';
import { useStepUp } from '../session/step-up-context.tsx';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { describeDeletionFailure, etagOfVersion, type OrderDeletionFailure } from './order-deletion.ts';
import { WORK_ORDER_HEADER_KEY, WORK_ORDER_KEYS, WORK_ORDERS_KEY } from './query-keys.ts';
import { useWorkOrderPayments } from './use-work-order.ts';

/**
 * "Usunąć zlecenie ZL-…?" (EVM-060 AC1–AC3, AC5, AC6; W-06 menu `⋮`, § 4.17 AlertDialog, danger): the Administrator confirms, the panel
 * sends `DELETE` with `If-Match` of the version on screen and an `Idempotency-Key` that stays the same for a retry of the same decision.
 * What the server says is told in words, never with a number: `409 has_active_dependents` — "Nie można usunąć zlecenia z wystawioną
 * fakturą." (an invoiced instalment cannot be hidden by deleting the order); `403 step_up_required` (a paid instalment) opens W-04 once
 * and sends the same request once more (no loop); `412` offers "Odśwież zlecenie". Success leads to W-10 and drops everything of the
 * order from the memory of the tab (TM-10). Focus starts on "Anuluj"; the server decides all the same (SR-AUTHZ-05).
 */
export function OrderDeleteDialog({ order, onClose }: { readonly order: WorkOrderDetails; readonly onClose: () => void }) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const showToast = useToast();
  const requestStepUp = useStepUp();
  const attempt = useAttempt();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<OrderDeletionFailure | null>(null);
  // Only a hint: with the list at hand the dialog says a paid instalment asks for the identity; the server decides all the same.
  const milestones = useWorkOrderPayments(order.id, true).data?.items ?? null;
  const paid = milestones?.some((entry) => entry.status === 'paid') === true;

  const send = (): Promise<unknown> => {
    const { key } = attempt.next(`${order.id}|${String(order.version)}`);
    return unwrap(
      deleteWorkOrder({
        client,
        path: { workOrderId: order.id },
        headers: { 'If-Match': etagOfVersion(order.version), 'Idempotency-Key': key },
      }),
    );
  };

  const confirm = async () => {
    setPending(true);
    setFailure(null);
    try {
      try {
        await send();
      } catch (error) {
        // A paid instalment: W-04 once, then the same request once more (the refusal left no record under the key).
        if (describeDeletionFailure(error).kind !== 'stepUp') throw error;
        if (!(await requestStepUp(t('stepUp.title.deleteWorkOrder')))) throw error;
        await send();
      }
      attempt.forget();
      showToast(t('workOrder.delete.deleted', { number: order.number }));
      void queryClient.invalidateQueries({ queryKey: [WORK_ORDERS_KEY] });
      // The page of the order leaves first, so that no read of it asks the API for a deleted order (`404`).
      void navigate({ to: WORK_ORDERS_PATH }).then(() => {
        for (const key of WORK_ORDER_KEYS) queryClient.removeQueries({ queryKey: [key, order.id] });
      });
    } catch (error) {
      if (refusesAttempt(error)) attempt.forget();
      const described = describeDeletionFailure(error);
      // The order or its instalments changed meanwhile: the summary is read again (the server judged them as they are now).
      if (described.kind === 'conflict' || described.kind === 'gone' || described.kind === 'dependents') {
        void queryClient.refetchQueries({ queryKey: [WORK_ORDER_HEADER_KEY, order.id] });
      }
      setFailure(described);
      setPending(false);
    }
  };

  const failureText = (current: OrderDeletionFailure): string => {
    switch (current.kind) {
      case 'dependents':
        return t('workOrder.delete.failure.dependents');
      case 'stepUp':
        return t('workOrder.delete.failure.stepUp');
      case 'forbidden':
        return t('workOrder.delete.failure.forbidden');
      case 'conflict':
        return t('workOrder.delete.failure.conflict');
      case 'gone':
        return t('workOrder.delete.failure.gone');
      case 'inProgress':
        return t('workOrder.delete.failure.inProgress');
      case 'rate':
        return t('workOrder.delete.failure.rateLimited', { seconds: current.seconds });
      case 'network':
        return t('workOrder.delete.failure.network');
      case 'server':
        return t('workOrder.delete.failure.server', { code: current.code });
    }
  };

  return (
    <AlertDialog
      open
      title={t('workOrder.delete.title', { number: order.number })}
      onDismiss={onClose}
      actions={
        <>
          <Button variant="tertiary" data-initial-focus onClick={onClose}>
            {t('workOrder.delete.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={pending}
            disabled={!online || failure?.kind === 'dependents'}
            onClick={() => {
              void confirm();
            }}
          >
            {t('workOrder.delete.submit')}
          </Button>
        </>
      }
    >
      {failure === null ? null : (
        <InlineAlert
          tone="error"
          {...(failure.kind === 'conflict'
            ? {
                action: (
                  <Button
                    variant="tertiary"
                    onClick={() => {
                      void queryClient.refetchQueries({ queryKey: [WORK_ORDER_HEADER_KEY, order.id] }).then(() => {
                        setFailure(null);
                      });
                    }}
                  >
                    {t('workOrder.delete.failure.refresh')}
                  </Button>
                ),
              }
            : {})}
        >
          {failureText(failure)}
        </InlineAlert>
      )}
      {online ? null : <Banner icon={WifiOff}>{t('workOrder.delete.offline')}</Banner>}
      <p className="text-body-sm text-text-secondary">{order.number}</p>
      <p>{t('workOrder.delete.description')}</p>
      {paid ? <p>{t('workOrder.delete.paidNote')}</p> : null}
    </AlertDialog>
  );
}

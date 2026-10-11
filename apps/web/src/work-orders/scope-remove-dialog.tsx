import { deleteWorkOrderScopeItem, type Procedure, type ProcedureList, type ScopeItem, type WorkOrderDetails } from '@evia/contracts';
import { AlertDialog, Banner, Button, InlineAlert, WifiOff } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { useAttempt } from '../forms/attempt.ts';
import { refusesAttempt } from '../forms/save-failure.ts';
import { useSession } from '../session/session.ts';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { classifyEdit, useStateWord, type EditFailure } from './edit-failure.ts';
import { pluralForm } from './order-form.ts';
import { WORK_ORDER_HEADER_KEY, WORK_ORDER_JOURNAL_KEY, WORK_ORDER_SCOPE_KEY } from './query-keys.ts';

const etagOf = (version: number): string => `"${String(version)}"`;

/**
 * The confirmation "Usunąć pozycję „…”?" (EVM-035 AC3, AC6; W-06 (c), § 4.11): the item leaves the scope, the processes it brought stay
 * in the order — the dialog names them and says where they are removed ("Procesy i etapy": the stages are marked "Nie dotyczy").
 * `If-Match` of the version of the item; a removed item is not restored in the panel (it can be added again), so there is no
 * "Cofnij". Focus starts on "Anuluj".
 */
export function ScopeRemoveDialog({
  order,
  item,
  procedures,
  onClose,
  onRemoved,
}: {
  readonly order: WorkOrderDetails;
  readonly item: ScopeItem;
  readonly procedures: ProcedureList | undefined;
  readonly onClose: () => void;
  readonly onRemoved: () => void;
}) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const attempt = useAttempt();
  const stateWord = useStateWord();
  const role = useSession().data?.user.role;
  const [failure, setFailure] = useState<EditFailure | null>(null);
  const kept: Procedure[] = procedures?.items.filter((procedure) => procedure.sourceScopeItemId === item.id) ?? [];

  const mutation = useMutation({
    mutationFn: (request: { readonly key: string }) =>
      unwrap(
        deleteWorkOrderScopeItem({
          client,
          path: { workOrderId: order.id, scopeItemId: item.id },
          headers: { 'If-Match': etagOf(item.version), 'Idempotency-Key': request.key },
        }),
      ),
  });

  const stagesText = (count: number): string => {
    switch (pluralForm(count)) {
      case 'one':
        return t('workOrder.scopeRemove.stagesOne', { count });
      case 'few':
        return t('workOrder.scopeRemove.stagesFew', { count });
      case 'many':
        return t('workOrder.scopeRemove.stagesMany', { count });
    }
  };

  const confirm = () => {
    const { key } = attempt.next(JSON.stringify({ order: order.id, item: item.id, version: item.version }));
    setFailure(null);
    mutation.mutate(
      { key },
      {
        onSuccess: () => {
          attempt.forget();
          showToast(t('workOrder.scopeRemove.removed', { name: item.name }));
          void queryClient.invalidateQueries({ queryKey: [WORK_ORDER_JOURNAL_KEY, order.id] });
          void queryClient.refetchQueries({ queryKey: [WORK_ORDER_SCOPE_KEY, order.id] }).then(onRemoved);
          onClose();
        },
        onError: (error) => {
          if (refusesAttempt(error)) attempt.forget();
          const failed = classifyEdit(error);
          setFailure(failed);
          if (failed.kind === 'closed') void queryClient.refetchQueries({ queryKey: [WORK_ORDER_HEADER_KEY, order.id] });
          if (failed.kind === 'conflict' || failed.kind === 'gone')
            void queryClient.refetchQueries({ queryKey: [WORK_ORDER_SCOPE_KEY, order.id] });
        },
      },
    );
  };

  const failureText = (failed: EditFailure): string => {
    const state = stateWord(order.status);
    switch (failed.kind) {
      case 'conflict':
        return t('workOrder.scopeRemove.conflict');
      case 'closed':
        return role === 'editor' ? t('workOrder.scopeRemove.closedEditor', { state }) : t('workOrder.scopeRemove.closed', { state });
      case 'gone':
        return t('workOrder.scopeRemove.gone');
      case 'forbidden':
        return t('workOrder.scopeRemove.forbidden');
      case 'rate':
        return t('workOrder.scopeRemove.rateLimited', { seconds: failed.seconds });
      case 'server':
        return t('workOrder.scopeRemove.server', { code: failed.code });
      case 'limit':
      case 'proceduresLimit':
      case 'invalid':
      case 'network':
      case 'inProgress':
        return t('workOrder.scopeRemove.network');
    }
  };

  return (
    <AlertDialog
      open
      title={t('workOrder.scopeRemove.title', { name: item.name })}
      onDismiss={onClose}
      actions={
        <>
          <Button variant="tertiary" data-initial-focus onClick={onClose}>
            {t('workOrder.scopeRemove.cancel')}
          </Button>
          <Button loading={mutation.isPending} disabled={!online || failure?.kind === 'closed'} onClick={confirm}>
            {t('workOrder.scopeRemove.confirm')}
          </Button>
        </>
      }
    >
      <p>{t('workOrder.scopeRemove.body')}</p>
      {kept.length === 0 ? null : (
        <>
          <p>
            {t('workOrder.scopeRemove.processes', {
              processes: kept.map((procedure) => `${procedure.name} (${stagesText(procedure.stages.length)})`).join(', '),
            })}
          </p>
          <p className="text-body-sm text-text-secondary">{t('workOrder.scopeRemove.stagesHint')}</p>
        </>
      )}
      {online ? null : <Banner icon={WifiOff}>{t('workOrder.scopeAdd.offline')}</Banner>}
      {failure === null ? null : <InlineAlert tone="error">{failureText(failure)}</InlineAlert>}
    </AlertDialog>
  );
}

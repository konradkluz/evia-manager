import { deleteWorkOrderProcedure, type Procedure, type WorkOrderDetails } from '@evia/contracts';
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
import { useStateWord } from './edit-failure.ts';
import { manageFailureText } from './procedure-failure-text.ts';
import { classifyManage, etagOf, type ManageFailure } from './procedure-manage.ts';
import { undoDelete } from './procedure-restore.ts';
import {
  WORK_ORDER_DELETED_PROCEDURES_KEY,
  WORK_ORDER_HEADER_KEY,
  WORK_ORDER_JOURNAL_KEY,
  WORK_ORDER_PROCEDURES_KEY,
} from './query-keys.ts';

/**
 * The confirmation "Usunąć proces „…”?" (EVM-042 AC3, AC6, AC7; W-06 (d), § 4.11): the process leaves the order together with its
 * stages, the text recommends "Nie dotyczy" for the stages. `If-Match` of the version of the process on screen; `412` reads the
 * processes again and keeps the dialog open with the current number of the stages. The Administrator gets "Cofnij" (a restore), the
 * Editor is told that only an administrator restores. Focus starts on "Anuluj".
 */
export function ProcedureRemoveDialog({
  order,
  procedure,
  onClose,
  onRemoved,
}: {
  readonly order: WorkOrderDetails;
  /** The process as it is now on screen (the snapshot taken when the dialog opened, if the list no longer holds it). */
  readonly procedure: Procedure;
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
  const [failure, setFailure] = useState<ManageFailure | null>(null);

  const mutation = useMutation({
    mutationFn: (request: { readonly key: string; readonly version: number }) =>
      unwrap(
        deleteWorkOrderProcedure({
          client,
          path: { workOrderId: order.id, procedureId: procedure.id },
          headers: { 'If-Match': etagOf(request.version), 'Idempotency-Key': request.key },
        }),
      ),
  });

  const confirm = () => {
    // Without a version on screen the server would answer `412` anyway: the first number it knows is the reading's.
    const version = procedure.version ?? 1;
    const { key } = attempt.next(JSON.stringify({ order: order.id, procedure: procedure.id, version }));
    setFailure(null);
    mutation.mutate(
      { key, version },
      {
        onSuccess: () => {
          attempt.forget();
          const name = procedure.name;
          showToast(
            t('workOrder.procedureManage.removeProcedure.removed', { name }),
            role === 'administrator'
              ? {
                  label: t('workOrder.procedureManage.removeStage.undo'),
                  onSelect: () => {
                    undoDelete(client, queryClient, order.id, 'procedure', procedure.id)
                      .then(() => {
                        showToast(t('workOrder.procedureManage.deleted.restoredProcedure', { name }));
                      })
                      .catch(() => {
                        showToast(t('workOrder.procedureManage.deleted.conflict'));
                      });
                  },
                }
              : undefined,
          );
          void queryClient.invalidateQueries({ queryKey: [WORK_ORDER_JOURNAL_KEY, order.id] });
          void queryClient.invalidateQueries({ queryKey: [WORK_ORDER_DELETED_PROCEDURES_KEY, order.id] });
          void queryClient.refetchQueries({ queryKey: [WORK_ORDER_PROCEDURES_KEY, order.id] }).then(onRemoved);
          onClose();
        },
        onError: (error) => {
          if (refusesAttempt(error)) attempt.forget();
          const failed = classifyManage(error);
          if (failed.kind === 'closed') void queryClient.refetchQueries({ queryKey: [WORK_ORDER_HEADER_KEY, order.id] });
          if (failed.kind === 'conflict' || failed.kind === 'gone') {
            void queryClient.refetchQueries({ queryKey: [WORK_ORDER_PROCEDURES_KEY, order.id] });
          }
          setFailure(failed);
        },
      },
    );
  };

  return (
    <AlertDialog
      open
      title={t('workOrder.procedureManage.removeProcedure.title', { name: procedure.name })}
      onDismiss={onClose}
      actions={
        <>
          <Button variant="tertiary" data-initial-focus onClick={onClose}>
            {t('workOrder.procedureManage.cancel')}
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={!online || failure?.kind === 'closed'}
            {...(online ? {} : { title: t('workOrder.procedureManage.offline') })}
            onClick={confirm}
          >
            {t('workOrder.procedureManage.removeProcedure.confirm')}
          </Button>
        </>
      }
    >
      <p className="text-body-sm text-text-secondary">{`${order.number} · ${order.title}`}</p>
      <p>
        {procedure.stages.length === 0
          ? t('workOrder.procedureManage.removeProcedure.noStages')
          : t('workOrder.procedureManage.removeProcedure.stages', { count: procedure.stages.length })}
      </p>
      {procedure.stages.length === 0 ? null : <p>{t('workOrder.procedureManage.removeProcedure.hint')}</p>}
      <p>
        {role === 'administrator'
          ? t('workOrder.procedureManage.removeProcedure.administrator')
          : t('workOrder.procedureManage.removeProcedure.editor')}
      </p>
      {online ? null : <Banner icon={WifiOff}>{t('workOrder.procedureManage.offline')}</Banner>}
      {failure === null ? null : (
        <InlineAlert tone="error">
          {manageFailureText(t, failure, { object: 'procedure', role, state: stateWord(order.status) })}
        </InlineAlert>
      )}
    </AlertDialog>
  );
}

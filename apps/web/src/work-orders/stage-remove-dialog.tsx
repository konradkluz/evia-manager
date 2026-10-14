import {
  deleteProcedureStage,
  transitionProcedureStage,
  type Procedure,
  type ProcedureStage,
  type TransitionProcedureStageRequest,
  type WorkOrderDetails,
} from '@evia/contracts';
import { AlertDialog, Banner, Button, InlineAlert, WifiOff } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { uuidv7 } from '../customers/uuid.ts';
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
import { stageEntries, undoOf } from './stage-transitions.ts';

/**
 * The confirmation "Usunąć etap „…”?" (EVM-042 AC3, AC6, AC7; W-06 (d), § 4.11). The text recommends "Nie dotyczy" — it stays in the
 * history of the order and does not count in the progress — and the button "Oznacz jako „Nie dotyczy”" runs that transition (W-07)
 * when the table of the transitions allows it from the status on screen; "Zakończony" and "Zablokowany" get neither the advice nor
 * the button, a stage that is already "Nie dotyczy" is told so. `If-Match` of the version of the stage; `412` reads the processes
 * again and keeps the dialog open. The Administrator gets "Cofnij" (a restore), the Editor is told that only an administrator
 * restores. Focus starts on "Anuluj".
 */
export function StageRemoveDialog({
  order,
  procedure,
  stage,
  onClose,
  onRemoved,
  onMarked,
}: {
  readonly order: WorkOrderDetails;
  readonly procedure: Procedure;
  /** The stage as it is now on screen (the snapshot taken when the dialog opened, if the list no longer holds it). */
  readonly stage: ProcedureStage;
  readonly onClose: () => void;
  readonly onRemoved: () => void;
  /** The stage was marked "Nie dotyczy": the focus goes to its badge. */
  readonly onMarked: (stageId: string) => void;
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
  const [pending, setPending] = useState<'remove' | 'mark' | null>(null);

  const canMark = stageEntries(stage.status).some((entry) => entry.to === 'not_applicable');
  const already = stage.status === 'not_applicable';
  const proceduresKey = [WORK_ORDER_PROCEDURES_KEY, order.id];

  const remove = useMutation({
    mutationFn: (request: { readonly key: string }) =>
      unwrap(
        deleteProcedureStage({
          client,
          path: { workOrderId: order.id, stageId: stage.id },
          headers: { 'If-Match': etagOf(stage.version), 'Idempotency-Key': request.key },
        }),
      ),
  });
  const mark = useMutation({
    mutationFn: (request: { readonly key: string }) =>
      unwrap(
        transitionProcedureStage({
          client,
          path: { workOrderId: order.id, stageId: stage.id },
          headers: { 'If-Match': etagOf(stage.version), 'Idempotency-Key': request.key },
          body: { to: 'not_applicable' },
        }),
      ),
  });

  const fail = (error: unknown) => {
    if (refusesAttempt(error)) attempt.forget();
    const failed = classifyManage(error);
    if (failed.kind === 'closed') void queryClient.refetchQueries({ queryKey: [WORK_ORDER_HEADER_KEY, order.id] });
    // The answer carries no state: the processes are read again and the dialog keeps its place with the current stage.
    if (failed.kind === 'conflict' || failed.kind === 'gone') void queryClient.refetchQueries({ queryKey: proceduresKey });
    setFailure(failed);
  };

  const confirm = () => {
    const { key } = attempt.next(JSON.stringify({ action: 'remove', stage: stage.id, version: stage.version }));
    setFailure(null);
    setPending('remove');
    remove.mutate(
      { key },
      {
        onSuccess: () => {
          attempt.forget();
          const name = stage.name;
          showToast(
            t('workOrder.procedureManage.removeStage.removed', { name }),
            role === 'administrator'
              ? {
                  label: t('workOrder.procedureManage.removeStage.undo'),
                  onSelect: () => {
                    undoDelete(client, queryClient, order.id, 'stage', stage.id)
                      .then(() => {
                        showToast(t('workOrder.procedureManage.deleted.restoredStage', { name }));
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
          void queryClient.refetchQueries({ queryKey: proceduresKey }).then(onRemoved);
          onClose();
        },
        onError: fail,
        onSettled: () => {
          setPending(null);
        },
      },
    );
  };

  const markNotApplicable = () => {
    const { key } = attempt.next(JSON.stringify({ action: 'mark', stage: stage.id, version: stage.version }));
    setFailure(null);
    setPending('mark');
    mark.mutate(
      { key },
      {
        onSuccess: (saved) => {
          attempt.forget();
          const request: TransitionProcedureStageRequest = { to: 'not_applicable' };
          // "Cofnij" only where the table of the transitions has the reverse (todo → not_applicable), as in W-07.
          const reverse = undoOf(stage, request);
          showToast(
            t('workOrder.procedureManage.removeStage.markedNotApplicable', { name: stage.name }),
            reverse === undefined
              ? undefined
              : {
                  label: t('workOrder.procedureManage.removeStage.undo'),
                  onSelect: () => {
                    unwrap(
                      transitionProcedureStage({
                        client,
                        path: { workOrderId: order.id, stageId: saved.id },
                        headers: { 'If-Match': etagOf(saved.version), 'Idempotency-Key': uuidv7() },
                        body: reverse,
                      }),
                    )
                      .then(() => queryClient.refetchQueries({ queryKey: proceduresKey }))
                      .then(() => {
                        showToast(t('workOrder.stage.toast.undone'));
                      })
                      .catch(() => {
                        showToast(t('workOrder.stage.failure.undoConflict'));
                      });
                  },
                },
          );
          void queryClient.invalidateQueries({ queryKey: [WORK_ORDER_JOURNAL_KEY, order.id] });
          void queryClient.refetchQueries({ queryKey: proceduresKey }).then(() => {
            onMarked(stage.id);
          });
          onClose();
        },
        onError: fail,
        onSettled: () => {
          setPending(null);
        },
      },
    );
  };

  const busy = pending !== null;
  const unavailable = !online || failure?.kind === 'closed';

  return (
    <AlertDialog
      open
      title={t('workOrder.procedureManage.removeStage.title', { name: stage.name })}
      onDismiss={onClose}
      actions={
        <>
          <Button variant="tertiary" data-initial-focus onClick={onClose}>
            {t('workOrder.procedureManage.cancel')}
          </Button>
          {canMark ? (
            <Button
              variant="secondary"
              loading={pending === 'mark'}
              disabled={unavailable || busy}
              {...(online ? {} : { title: t('workOrder.procedureManage.offline') })}
              onClick={markNotApplicable}
            >
              {t('workOrder.procedureManage.removeStage.notApplicable')}
            </Button>
          ) : null}
          <Button
            loading={pending === 'remove'}
            disabled={unavailable || busy}
            {...(online ? {} : { title: t('workOrder.procedureManage.offline') })}
            onClick={confirm}
          >
            {t('workOrder.procedureManage.removeStage.confirm')}
          </Button>
        </>
      }
    >
      <p className="text-body-sm text-text-secondary">{`${procedure.name} · ${order.number}`}</p>
      {canMark ? <p>{t('workOrder.procedureManage.removeStage.recommend')}</p> : null}
      {already ? <p>{t('workOrder.procedureManage.removeStage.already')}</p> : null}
      <p>{t('workOrder.procedureManage.removeStage.vanish')}</p>
      <p>
        {role === 'administrator'
          ? t('workOrder.procedureManage.removeStage.administrator')
          : t('workOrder.procedureManage.removeStage.editor')}
      </p>
      {online ? null : <Banner icon={WifiOff}>{t('workOrder.procedureManage.offline')}</Banner>}
      {failure === null ? null : (
        <InlineAlert tone="error">{manageFailureText(t, failure, { object: 'stage', role, state: stateWord(order.status) })}</InlineAlert>
      )}
    </AlertDialog>
  );
}

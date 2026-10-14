import type { DeletedProcedure, DeletedProcedureList, DeletedProcedureStage, WorkOrderDetails } from '@evia/contracts';
import { Button, Disclosure, InlineAlert, List, ListItem, Undo2 } from '@evia/ui-web';
import type { UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError } from '../api/client.ts';
import { useAttempt } from '../forms/attempt.ts';
import { refusesAttempt } from '../forms/save-failure.ts';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { useStateWord } from './edit-failure.ts';
import { pluralForm } from './order-form.ts';
import { manageFailureText } from './procedure-failure-text.ts';
import { classifyManage, type ManageFailure } from './procedure-manage.ts';
import { refreshAfterRestore, sendRestore, type RestoreKind } from './procedure-restore.ts';
import { WORK_ORDER_HEADER_KEY } from './query-keys.ts';
import { isClosed } from './transition-actions.ts';

interface Target {
  readonly kind: RestoreKind;
  readonly id: string;
  readonly version: number;
  readonly name: string;
  /** The process of a restored stage: it is opened, so the focus can reach the stage. */
  readonly parentId?: string;
}

/**
 * "Usunięte procesy i etapy (n)" at the end of W-06 (EVM-042 AC3, AC6, AC7): the Administrator sees what was removed and restores it
 * with "Przywróć" (no step-up). The section does not exist for the other roles and without entries. A stage of a deleted process
 * is restored after the process ("Najpierw przywróć proces „…”."); a process whose code is active again gets `409` and the alert
 * names it. A closed order, the connection and the limits are told in the row; the server decides all the same. Names are free
 * text: React text only.
 */
export function DeletedProcedures({
  order,
  query,
  onRestored,
}: {
  readonly order: WorkOrderDetails;
  readonly query: UseQueryResult<DeletedProcedureList>;
  /** The object that came back: the focus goes to its header (process) or badge (stage). */
  readonly onRestored: (kind: RestoreKind, id: string, parentId?: string) => void;
}) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const attempt = useAttempt();
  const stateWord = useStateWord();
  const [open, setOpen] = useState(false);
  const [alert, setAlert] = useState<{ readonly failure: ManageFailure; readonly name: string; readonly kind: RestoreKind } | null>(null);
  const data = query.data;
  const count = data === undefined ? 0 : data.procedures.length + data.stages.length;
  const closed = isClosed(order.status);
  const hint = closed
    ? t('workOrder.procedureManage.deleted.closed', { state: stateWord(order.status) })
    : online
      ? undefined
      : t('workOrder.procedureManage.offline');

  const mutation = useMutation({
    mutationFn: ({ target, key }: { readonly target: Target; readonly key: string }) =>
      sendRestore(client, order.id, target.kind, target.id, target.version, key),
  });

  const restore = (target: Target) => {
    const { key } = attempt.next(JSON.stringify({ kind: target.kind, id: target.id, version: target.version }));
    setAlert(null);
    mutation.mutate(
      { target, key },
      {
        onSuccess: () => {
          attempt.forget();
          showToast(
            target.kind === 'procedure'
              ? t('workOrder.procedureManage.deleted.restoredProcedure', { name: target.name })
              : t('workOrder.procedureManage.deleted.restoredStage', { name: target.name }),
          );
          void refreshAfterRestore(queryClient, order.id).then(() => {
            onRestored(target.kind, target.id, target.parentId);
          });
        },
        onError: (error) => {
          if (refusesAttempt(error)) attempt.forget();
          const failed = classifyManage(error);
          if (failed.kind === 'closed') void queryClient.refetchQueries({ queryKey: [WORK_ORDER_HEADER_KEY, order.id] });
          // The answer carries no state: both lists are read again, so the row shows what is true now.
          if (error instanceof ApiError && error.status !== 429 && error.status < 500) void refreshAfterRestore(queryClient, order.id);
          setAlert({ failure: failed, name: target.name, kind: target.kind });
        },
      },
    );
  };

  if (data === undefined) {
    // Nothing to say before the first answer; a failed read is told, a missing right is not (the section is for the Administrator).
    return query.isError ? (
      <InlineAlert
        tone="error"
        action={
          <Button
            variant="secondary"
            onClick={() => {
              void query.refetch();
            }}
          >
            {t('workOrder.procedureManage.deleted.retry')}
          </Button>
        }
      >
        {t('workOrder.procedureManage.deleted.error')}
      </InlineAlert>
    ) : null;
  }
  if (count === 0) return null;

  const stagesText = (stages: number): string => {
    switch (pluralForm(stages)) {
      case 'one':
        return t('workOrder.procedureManage.stagesOne', { count: stages });
      case 'few':
        return t('workOrder.procedureManage.stagesFew', { count: stages });
      case 'many':
        return t('workOrder.procedureManage.stagesMany', { count: stages });
    }
  };

  const alertText = (): string => {
    if (alert === null) return '';
    const { failure, name } = alert;
    if (failure.kind === 'active') return t('workOrder.procedureManage.deleted.activeConflict', { name });
    if (failure.kind === 'conflict') return t('workOrder.procedureManage.deleted.conflict');
    if (failure.kind === 'gone') return t('workOrder.procedureManage.deleted.gone');
    if (failure.kind === 'tooManyProcedures' || failure.kind === 'tooManyStages') return t('workOrder.procedureManage.deleted.limit');
    return manageFailureText(t, failure, {
      object: alert.kind === 'stage' ? 'stage' : 'procedure',
      role: 'administrator',
      state: stateWord(order.status),
    });
  };

  const procedureRow = (entry: DeletedProcedure) => (
    <ListItem key={`p-${entry.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-inline-md">
        <div className="flex min-w-0 flex-col gap-stack-xs">
          <span className="break-words text-body text-text-primary">{entry.name}</span>
          <span className="text-body-sm text-text-secondary">
            {t('workOrder.procedureManage.deleted.procedureKind', { stages: stagesText(entry.stageCount) })}
          </span>
        </div>
        <Button
          variant="tertiary"
          icon={Undo2}
          aria-label={t('workOrder.procedureManage.deleted.restoreProcedure', { name: entry.name })}
          disabled={hint !== undefined || mutation.isPending}
          {...(hint === undefined ? {} : { title: hint })}
          onClick={() => {
            restore({ kind: 'procedure', id: entry.id, version: entry.version, name: entry.name });
          }}
        >
          {t('workOrder.procedureManage.deleted.restore')}
        </Button>
      </div>
    </ListItem>
  );

  const stageRow = (entry: DeletedProcedureStage) => {
    const parentHint = entry.procedureDeleted
      ? t('workOrder.procedureManage.deleted.parentFirst', { name: entry.procedureName })
      : undefined;
    const reason = hint ?? parentHint;
    return (
      <ListItem key={`s-${entry.id}`}>
        <div className="flex flex-wrap items-center justify-between gap-inline-md">
          <div className="flex min-w-0 flex-col gap-stack-xs">
            <span className="break-words text-body text-text-primary">{entry.name}</span>
            <span className="break-words text-body-sm text-text-secondary">
              {t('workOrder.procedureManage.deleted.stageKind', { process: entry.procedureName })}
            </span>
          </div>
          <Button
            variant="tertiary"
            icon={Undo2}
            aria-label={t('workOrder.procedureManage.deleted.restoreStage', { name: entry.name, process: entry.procedureName })}
            disabled={reason !== undefined || mutation.isPending}
            {...(reason === undefined ? {} : { title: reason })}
            onClick={() => {
              restore({ kind: 'stage', id: entry.id, version: entry.version, name: entry.name, parentId: entry.procedureId });
            }}
          >
            {t('workOrder.procedureManage.deleted.restore')}
          </Button>
        </div>
        {parentHint === undefined ? null : <span className="text-body-sm text-text-secondary">{parentHint}</span>}
      </ListItem>
    );
  };

  return (
    <Disclosure title={t('workOrder.procedureManage.deleted.heading', { count })} expanded={open} onExpandedChange={setOpen}>
      {alert === null ? null : <InlineAlert tone="error">{alertText()}</InlineAlert>}
      {data.truncated ? <p className="text-body-sm text-text-secondary">{t('workOrder.procedureManage.deleted.truncated')}</p> : null}
      <List label={t('workOrder.procedureManage.deleted.listLabel')}>
        {data.procedures.map(procedureRow)}
        {data.stages.map(stageRow)}
      </List>
    </Disclosure>
  );
}

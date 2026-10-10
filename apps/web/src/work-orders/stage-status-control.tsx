import {
  transitionProcedureStage,
  updateProcedureStage,
  type ProcedureList,
  type ProcedureStage,
  type TransitionProcedureStageRequest,
} from '@evia/contracts';
import { ActionMenu, Button, InlineAlert, StatusBadge, StatusBadgeButton } from '@evia/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { useAttempt } from '../forms/attempt.ts';
import { refusesAttempt } from '../forms/save-failure.ts';
import { stageActionLabels } from '../i18n/stage-labels.ts';
import { stageStatusLabels } from '../i18n/procedure-labels.ts';
import { useSession } from '../session/session.ts';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { stageStatusKey } from './procedure-format.ts';
import { WORK_ORDER_HEADER_KEY, WORK_ORDER_PROCEDURES_KEY } from './query-keys.ts';
import { StageDialog, stageFailureText, type DialogAction, type StageCommand } from './stage-dialog.tsx';
import {
  STAGE_DIALOG_ACTIONS,
  describeStageFailure,
  stageEntries,
  undoOf,
  type StageEntry,
  type StageFailure,
} from './stage-transitions.ts';

type Source = 'menu' | 'undo';

/**
 * The badge of the status of a stage in W-06 and everything it starts (EVM-032, W-07): for the Administrator and the Editor the badge
 * is the button of the menu of transitions (only those of the table "Etap procesu" for the status on screen), for Tylko odczyt it is
 * static. A transition without fields runs at once, the ones with fields ask in a dialog first. A toast with "Cofnij" (10 s) follows
 * a transition that has a reverse in the table — "Cofnij" is then an ordinary transition with parameters a person could give by hand,
 * never a `PATCH` of the status (SR-API-07, SR-AUTHZ-10). Every request carries `If-Match` of the version on screen and an
 * `Idempotency-Key` that is the same for a retry of the same content. What "Cofnij" needs (the previous party, day, reason) lives in the
 * closure of the toast: the memory of the tab only, not the address and not a store of the browser. The menu is disabled with the
 * reason for a closed order (PO-8) and offline — the server decides all the same.
 */
export function StageStatusControl({
  workOrderId,
  stage,
  closed,
}: {
  readonly workOrderId: string;
  readonly stage: ProcedureStage;
  readonly closed: boolean;
}) {
  const { t } = useTranslation();
  const client = useApi();
  const queryClient = useQueryClient();
  const online = useOnline();
  const showToast = useToast();
  const role = useSession().data?.user.role;
  const attempt = useAttempt();
  const root = useRef<HTMLDivElement>(null);
  const [dialog, setDialog] = useState<DialogAction | null>(null);
  const [alert, setAlert] = useState<{ readonly failure: StageFailure; readonly source: Source } | null>(null);

  const key = stageStatusKey(stage.status);
  const label = Object.hasOwn(stageStatusLabels, stage.status) ? stageStatusLabels[stage.status] : '';
  const entries = stageEntries(stage.status);
  const proceduresKey = [WORK_ORDER_PROCEDURES_KEY, workOrderId];

  if (key === undefined) {
    return <StatusBadge status="unknown" label={t('workOrders.status.unknown')} hint={t('workOrders.status.unknownHint')} />;
  }
  if ((role !== 'administrator' && role !== 'editor') || entries.length === 0) {
    return <StatusBadge status={key} group="stage" label={label} />;
  }

  const send = (command: StageCommand, base: ProcedureStage): Promise<ProcedureStage> => {
    // The key names the action: the same version and content get the same key on every retry of a lost answer.
    const { key: idempotencyKey } = attempt.next(`${base.id}|${String(base.version)}|${JSON.stringify(command)}`);
    const path = { workOrderId, stageId: base.id };
    const headers = { 'If-Match': `"${String(base.version)}"`, 'Idempotency-Key': idempotencyKey };
    return unwrap(
      command.kind === 'transition'
        ? transitionProcedureStage({ client, path, headers, body: command.request })
        : updateProcedureStage({ client, path, headers, body: command.patch }),
    );
  };

  /** Runs one command on `base`; `null` when the server accepted it, else why not. */
  const execute = async (command: StageCommand, base: ProcedureStage, source: Source | 'dialog'): Promise<StageFailure | null> => {
    setAlert(null);
    try {
      const saved = await send(command, base);
      attempt.forget();
      // The row shows the answer at once; the processes are read again for the progress the server counts.
      queryClient.setQueryData<ProcedureList>(proceduresKey, (list) =>
        list === undefined
          ? list
          : {
              ...list,
              items: list.items.map((procedure) => ({
                ...procedure,
                stages: procedure.stages.map((entry) => (entry.id === saved.id ? saved : entry)),
              })),
            },
      );
      void queryClient.refetchQueries({ queryKey: proceduresKey });
      setDialog(null);
      if (source === 'undo') showToast(t('workOrder.stage.toast.undone'));
      else if (command.kind === 'patch') showToast(t('workOrder.stage.toast.changed'));
      else {
        const reverse = undoOf(base, command.request);
        showToast(
          toastText(command.request, saved),
          reverse === undefined
            ? undefined
            : {
                label: t('workOrder.stage.undo'),
                onSelect: () => {
                  void execute({ kind: 'transition', request: reverse }, saved, 'undo').then((failure) => {
                    if (failure !== null) setAlert({ failure, source: 'undo' });
                  });
                },
              },
        );
      }
      return null;
    } catch (error) {
      if (refusesAttempt(error)) attempt.forget();
      const failure = describeStageFailure(error);
      // The answers carry no state: the processes (or the header, for a closed order) are read again.
      if (failure.kind === 'conflict' || failure.kind === 'gone') void queryClient.refetchQueries({ queryKey: proceduresKey });
      if (failure.kind === 'closed') void queryClient.refetchQueries({ queryKey: [WORK_ORDER_HEADER_KEY, workOrderId] });
      return failure;
    }
  };

  const toastText = (request: TransitionProcedureStageRequest, saved: ProcedureStage): string => {
    if (request.to === 'waiting') {
      return saved.waitingParty === null
        ? t('workOrder.stage.toast.waitingCustomer', { name: saved.name })
        : t('workOrder.stage.toast.waitingParty', { name: saved.name, party: saved.waitingParty.displayName });
    }
    return t('workOrder.stage.toast.status', { status: stageStatusLabels[request.to] });
  };

  const choose = (entry: StageEntry) => {
    setAlert(null);
    if (STAGE_DIALOG_ACTIONS.has(entry.action)) {
      setDialog(entry.action as DialogAction);
      return;
    }
    if (entry.to === undefined) return;
    const request: TransitionProcedureStageRequest = { to: entry.to };
    void execute({ kind: 'transition', request }, stage, 'menu').then((failure) => {
      if (failure !== null) setAlert({ failure, source: 'menu' });
    });
  };

  const refresh = () => {
    void queryClient.refetchQueries({ queryKey: proceduresKey }).then(() => {
      setAlert(null);
      root.current?.querySelector('button')?.focus();
    });
  };

  const closedHint = role === 'administrator' ? t('workOrder.stage.closedAdminHint') : t('workOrder.stage.closedEditorHint');
  const disabledHint = closed ? closedHint : online ? undefined : t('workOrder.stage.offlineHint');
  const items = entries.map((entry) => ({
    id: entry.action,
    label: stageActionLabels[entry.action],
    onSelect: () => {
      choose(entry);
    },
    ...(disabledHint === undefined ? {} : { disabledHint }),
  }));

  return (
    <div ref={root} className="flex flex-col items-start gap-stack-xs">
      <ActionMenu
        label={t('workOrder.stage.menuLabel', { name: stage.name })}
        items={items}
        trigger={(props) => (
          <StatusBadgeButton
            {...props}
            status={key}
            group="stage"
            label={label}
            aria-label={t('workOrder.stage.statusChange', { name: stage.name, status: label })}
            {...(disabledHint === undefined ? {} : { disabledHint })}
          />
        )}
      />
      {alert === null ? null : (
        <InlineAlert
          tone="error"
          {...(alert.failure.kind === 'conflict' || alert.failure.kind === 'gone'
            ? {
                action: (
                  <Button variant="tertiary" onClick={refresh}>
                    {t('workOrder.stage.failure.refresh')}
                  </Button>
                ),
              }
            : {})}
        >
          {stageFailureText(t, alert.failure, alert.source === 'undo')}
        </InlineAlert>
      )}
      {dialog === null ? null : (
        <StageDialog
          action={dialog}
          stage={stage}
          online={online}
          run={(command) => execute(command, stage, 'dialog')}
          onClose={() => {
            setDialog(null);
            attempt.forget();
          }}
        />
      )}
    </div>
  );
}

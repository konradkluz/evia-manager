import { updateProcedureStage, type ProcedureList, type ProcedureStage } from '@evia/contracts';
import { Banner, Button, DateField, Dialog, InlineAlert, Select, WifiOff, type SelectOption } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { useAttempt } from '../forms/attempt.ts';
import { DiscardDialog } from '../forms/discard-dialog.tsx';
import { describeFailure, refusesAttempt, type SaveFailure } from '../forms/save-failure.ts';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { DUE_DATE_MAX, DUE_DATE_MIN, buildStagePatch, stageEditOf, type StageEdit } from './procedure-format.ts';
import { WORK_ORDER_HEADER_KEY, WORK_ORDER_PROCEDURES_KEY } from './query-keys.ts';
import { useAssignableUsers } from './use-order-lookups.ts';

type Failure = SaveFailure | { readonly kind: 'conflict' | 'closed' | 'gone' };

interface FieldErrors {
  responsibleUserId?: string | undefined;
  dueDate?: string | undefined;
}

const etagOf = (version: number): string => `"${String(version)}"`;

/**
 * Dialog "Zmień etap" (EVM-031 AC3, AC5, AC6; W-06): the person responsible (the list of users: `id` and `displayName` only) and
 * the due date of one stage. A change goes out as a merge-patch of the fields that changed with `If-Match` of the version on
 * screen and an `Idempotency-Key` that is the same for a retry of the same content. `412` reads the processes again and keeps
 * what was typed; `409 work_order_closed` says the order is closed; `400 assignee_unavailable` is one answer for an account
 * that does not exist, is invited, deactivated or deleted. Names are rendered as React text only (SR-WEB-03).
 */
export function StageEditDialog({
  workOrderId,
  stage,
  onClose,
}: {
  readonly workOrderId: string;
  readonly stage: ProcedureStage;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const users = useAssignableUsers();
  const attempt = useAttempt();
  const formId = useId();
  // What the dialog was opened with stays the reference of "what was touched", also after a refresh of the processes.
  const [initial] = useState<StageEdit>(() => stageEditOf(stage));
  const [current, setCurrent] = useState<StageEdit>(initial);
  const [version, setVersion] = useState(stage.version);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [discarding, setDiscarding] = useState(false);

  const patch = buildStagePatch(initial, current);
  const dirty = Object.keys(patch).length > 0;
  const proceduresKey = [WORK_ORDER_PROCEDURES_KEY, workOrderId];

  const mutation = useMutation({
    mutationFn: (request: { readonly body: typeof patch; readonly key: string; readonly version: number }) =>
      unwrap(
        updateProcedureStage({
          client,
          path: { workOrderId, stageId: stage.id },
          body: request.body,
          headers: { 'If-Match': etagOf(request.version), 'Idempotency-Key': request.key },
        }),
      ),
  });

  const dismiss = () => {
    if (dirty && !mutation.isPending) setDiscarding(true);
    else onClose();
  };

  const submit = () => {
    if (!dirty) {
      onClose();
      return;
    }
    if (current.dueDate !== '' && (current.dueDate < DUE_DATE_MIN || current.dueDate > DUE_DATE_MAX)) {
      setErrors({ dueDate: t('workOrder.stageEdit.dueDateOutOfRange') });
      return;
    }
    const { key } = attempt.next(JSON.stringify({ stage: stage.id, version, patch }));
    setErrors({});
    setFailure(null);
    mutation.mutate(
      { body: patch, key, version },
      {
        onSuccess: (saved) => {
          attempt.forget();
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
          showToast(t('workOrder.stageEdit.saved'));
          onClose();
        },
        onError: (error) => {
          if (refusesAttempt(error)) attempt.forget();
          if (error instanceof ApiError && error.status === 412) {
            setFailure({ kind: 'conflict' });
            // The answer carries no values: the processes are read again and the fresh version is used by the next save.
            void queryClient.refetchQueries({ queryKey: proceduresKey }).then(() => {
              const fresh = queryClient
                .getQueryData<ProcedureList>(proceduresKey)
                ?.items.flatMap((procedure) => procedure.stages)
                .find((entry) => entry.id === stage.id);
              if (fresh !== undefined) setVersion(fresh.version);
            });
            return;
          }
          if (error instanceof ApiError && error.status === 409 && error.code === 'work_order_closed') {
            setFailure({ kind: 'closed' });
            void queryClient.refetchQueries({ queryKey: [WORK_ORDER_HEADER_KEY, workOrderId] });
            return;
          }
          if (error instanceof ApiError && error.status === 404) {
            setFailure({ kind: 'gone' });
            void queryClient.refetchQueries({ queryKey: proceduresKey });
            return;
          }
          const mapped: FieldErrors = {};
          if (error instanceof ApiError && error.status === 400) {
            for (const entry of error.errors) {
              if (entry.pointer === '/responsibleUserId') mapped.responsibleUserId = t('workOrder.stageEdit.assigneeUnavailable');
              else if (entry.pointer === '/dueDate') mapped.dueDate = t('workOrder.stageEdit.dueDateOutOfRange');
            }
          }
          setErrors(mapped);
          setFailure(describeFailure(error, Object.keys(mapped).length > 0));
        },
      },
    );
  };

  const failureText = (failed: Failure): string => {
    switch (failed.kind) {
      case 'conflict':
        return t('workOrder.stageEdit.conflict');
      case 'closed':
        return t('workOrder.stageEdit.closed');
      case 'gone':
        return t('workOrder.stageEdit.gone');
      case 'forbidden':
        return t('workOrder.stageEdit.forbidden');
      case 'rate':
        return t('workOrder.stageEdit.rateLimited', { seconds: failed.seconds });
      case 'server':
        return t('workOrder.stageEdit.server', { code: failed.code });
      case 'fields':
      case 'network':
      case 'inProgress':
        return t('workOrder.stageEdit.network');
    }
  };

  // The person who is responsible now stays on the list even when the list of users no longer holds them (shown, not lost).
  const listed = users.data ?? [];
  const known = new Set(listed.map((user) => user.id));
  const options: SelectOption[] = [
    { value: '', label: t('workOrder.stageEdit.responsibleNone') },
    ...(stage.responsibleUser !== null && !known.has(stage.responsibleUser.id)
      ? [{ value: stage.responsibleUser.id, label: stage.responsibleUser.displayName }]
      : []),
    ...listed.map((user) => ({ value: user.id, label: user.displayName })),
  ];

  return (
    <>
      <Dialog
        open={!discarding}
        title={t('workOrder.stageEdit.title', { name: stage.name })}
        closeLabel={t('workOrder.stageEdit.close')}
        onDismiss={dismiss}
        actions={
          <>
            <Button variant="tertiary" onClick={dismiss}>
              {t('workOrder.stageEdit.cancel')}
            </Button>
            <Button
              type="submit"
              form={formId}
              loading={mutation.isPending}
              disabled={!online}
              {...(online ? {} : { title: t('workOrder.stageEdit.offline') })}
            >
              {t('workOrder.stageEdit.submit')}
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
          {online ? null : <Banner icon={WifiOff}>{t('workOrder.stageEdit.offline')}</Banner>}
          {failure === null ? null : <InlineAlert tone="error">{failureText(failure)}</InlineAlert>}
          {users.isError ? (
            <InlineAlert
              tone="error"
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    void users.refetch();
                  }}
                >
                  {t('workOrder.stageEdit.usersRetry')}
                </Button>
              }
            >
              {t('workOrder.stageEdit.usersError')}
            </InlineAlert>
          ) : null}
          <Select
            label={t('workOrder.stageEdit.responsible')}
            value={current.responsibleUserId}
            options={options}
            {...(users.isPending ? { hint: t('workOrder.stageEdit.usersLoading') } : {})}
            {...(errors.responsibleUserId === undefined ? {} : { error: errors.responsibleUserId })}
            onChange={(value) => {
              setCurrent((existing) => ({ ...existing, responsibleUserId: value }));
              setErrors((existing) => ({ ...existing, responsibleUserId: undefined }));
            }}
          />
          <DateField
            label={t('workOrder.stageEdit.dueDate')}
            value={current.dueDate}
            min={DUE_DATE_MIN}
            max={DUE_DATE_MAX}
            {...(errors.dueDate === undefined ? {} : { error: errors.dueDate })}
            onChange={(value) => {
              setCurrent((existing) => ({ ...existing, dueDate: value }));
              setErrors((existing) => ({ ...existing, dueDate: undefined }));
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

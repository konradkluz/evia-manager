import { createProcedureStage, type CreateProcedureStageRequest, type Procedure, type WorkOrderDetails } from '@evia/contracts';
import { Banner, Button, DateField, Dialog, InlineAlert, Select, TextField, WifiOff, type SelectOption } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { useAttempt } from '../forms/attempt.ts';
import { DiscardDialog } from '../forms/discard-dialog.tsx';
import { refusesAttempt } from '../forms/save-failure.ts';
import { useSession } from '../session/session.ts';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { useStateWord } from './edit-failure.ts';
import { manageFailureText } from './procedure-failure-text.ts';
import { DUE_DATE_MAX, DUE_DATE_MIN } from './procedure-format.ts';
import {
  STAGES_MAX,
  STAGE_NAME_MAX,
  classifyManage,
  hasControlCharacters,
  normalizeStageName,
  type ManageFailure,
} from './procedure-manage.ts';
import { WORK_ORDER_HEADER_KEY, WORK_ORDER_JOURNAL_KEY, WORK_ORDER_PROCEDURES_KEY } from './query-keys.ts';
import { useAssignableUsers } from './use-order-lookups.ts';

const END = 'end';

/**
 * Dialog "Dodaj etap" (EVM-042 AC2; W-06 (d)): the name (plain text, 1–120 characters — a free field, so it warns against personal
 * data), the place in the process, an optional due date and an optional person responsible. The stage starts as "Do zrobienia" and
 * counts in the progress of the process. The typed data stays in the memory of this dialog (nothing in a store of the browser); a
 * lost answer is retried with the same `id` and `Idempotency-Key`. The name is rendered as React text only (SR-WEB-03).
 */
export function StageAddDialog({
  order,
  procedure,
  onClose,
  onAdded,
}: {
  readonly order: WorkOrderDetails;
  readonly procedure: Procedure;
  readonly onClose: () => void;
  readonly onAdded: (stageId: string) => void;
}) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const attempt = useAttempt();
  const stateWord = useStateWord();
  const role = useSession().data?.user.role;
  const users = useAssignableUsers();
  const formId = useId();
  const [name, setName] = useState('');
  const [place, setPlace] = useState(END);
  const [dueDate, setDueDate] = useState('');
  const [responsibleUserId, setResponsibleUserId] = useState('');
  const [errors, setErrors] = useState<{ name?: string | undefined; dueDate?: string | undefined; responsibleUserId?: string | undefined }>(
    {},
  );
  const [failure, setFailure] = useState<ManageFailure | null>(null);
  const [discarding, setDiscarding] = useState(false);

  const dirty = name !== '' || place !== END || dueDate !== '' || responsibleUserId !== '';
  const atLimit = procedure.stages.length >= STAGES_MAX;

  const mutation = useMutation({
    mutationFn: (request: { readonly body: CreateProcedureStageRequest; readonly key: string }) =>
      unwrap(
        createProcedureStage({
          client,
          path: { workOrderId: order.id, procedureId: procedure.id },
          body: request.body,
          headers: { 'Idempotency-Key': request.key },
        }),
      ),
  });

  const dismiss = () => {
    if (dirty && !mutation.isPending) setDiscarding(true);
    else onClose();
  };

  const submit = () => {
    const text = normalizeStageName(name);
    let nameProblem: string | undefined;
    if (text === '') nameProblem = t('workOrder.procedureManage.addStage.nameRequired');
    else if (text.length > STAGE_NAME_MAX) nameProblem = t('workOrder.procedureManage.addStage.nameTooLong', { max: STAGE_NAME_MAX });
    else if (hasControlCharacters(text)) nameProblem = t('workOrder.procedureManage.addStage.nameInvalid');
    const dateProblem =
      dueDate !== '' && (dueDate < DUE_DATE_MIN || dueDate > DUE_DATE_MAX)
        ? t('workOrder.procedureManage.addStage.dueDateOutOfRange')
        : undefined;
    setErrors({ name: nameProblem, dueDate: dateProblem });
    if (nameProblem !== undefined || dateProblem !== undefined) return;
    const { id, key } = attempt.next(JSON.stringify({ procedure: procedure.id, name: text, place, dueDate, responsibleUserId }));
    const body: CreateProcedureStageRequest = {
      id,
      name: text,
      ...(place === END ? {} : { position: Number(place) }),
      ...(dueDate === '' ? {} : { dueDate }),
      ...(responsibleUserId === '' ? {} : { responsibleUserId }),
    };
    setFailure(null);
    mutation.mutate(
      { body, key },
      {
        onSuccess: (added) => {
          attempt.forget();
          void queryClient.invalidateQueries({ queryKey: [WORK_ORDER_JOURNAL_KEY, order.id] });
          void queryClient.refetchQueries({ queryKey: [WORK_ORDER_PROCEDURES_KEY, order.id] }).then(() => {
            onAdded(added.id);
          });
          showToast(t('workOrder.procedureManage.addStage.added', { name: text }));
          onClose();
        },
        onError: (error) => {
          if (refusesAttempt(error)) attempt.forget();
          const failed = classifyManage(error);
          if (failed.kind === 'closed') void queryClient.refetchQueries({ queryKey: [WORK_ORDER_HEADER_KEY, order.id] });
          if (failed.kind === 'tooManyStages' || failed.kind === 'gone') {
            void queryClient.refetchQueries({ queryKey: [WORK_ORDER_PROCEDURES_KEY, order.id] });
          }
          if (failed.kind === 'invalid' && error instanceof ApiError) {
            const mapped = {
              name: error.errors.some((entry) => entry.pointer === '/name')
                ? t('workOrder.procedureManage.addStage.nameInvalid')
                : undefined,
              dueDate: error.errors.some((entry) => entry.pointer === '/dueDate')
                ? t('workOrder.procedureManage.addStage.dueDateOutOfRange')
                : undefined,
              responsibleUserId: error.errors.some((entry) => entry.pointer === '/responsibleUserId')
                ? t('workOrder.procedureManage.addStage.assigneeUnavailable')
                : undefined,
            };
            if (mapped.name !== undefined || mapped.dueDate !== undefined || mapped.responsibleUserId !== undefined) {
              setErrors(mapped);
              return;
            }
          }
          setFailure(failed);
        },
      },
    );
  };

  // "Po: …" names every stage but the last: after the last one is "Na końcu".
  const placeOptions: SelectOption[] = [
    { value: END, label: t('workOrder.procedureManage.addStage.end') },
    ...procedure.stages.slice(0, -1).map((stage) => ({
      value: String(stage.position + 1),
      label: t('workOrder.procedureManage.addStage.after', { position: stage.position, name: stage.name }),
    })),
  ];
  const userOptions: SelectOption[] = [
    { value: '', label: t('workOrder.procedureManage.addStage.responsibleNone') },
    ...(users.data ?? []).map((user) => ({ value: user.id, label: user.displayName })),
  ];
  const blocked = failure?.kind === 'closed' || atLimit;

  return (
    <>
      <Dialog
        open={!discarding}
        title={t('workOrder.procedureManage.addStage.title')}
        closeLabel={t('workOrder.procedureManage.close')}
        onDismiss={dismiss}
        actions={
          <>
            <Button variant="tertiary" onClick={dismiss}>
              {t('workOrder.procedureManage.cancel')}
            </Button>
            <Button
              type="submit"
              form={formId}
              loading={mutation.isPending}
              disabled={!online || blocked}
              {...(online ? {} : { title: t('workOrder.procedureManage.offline') })}
            >
              {t('workOrder.procedureManage.addStage.submit')}
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
            {t('workOrder.procedureManage.addStage.subtitle', { process: procedure.name, number: order.number })}
          </p>
          {online ? null : <Banner icon={WifiOff}>{t('workOrder.procedureManage.offline')}</Banner>}
          {atLimit ? <InlineAlert tone="error">{t('workOrder.procedureManage.limitStages', { max: STAGES_MAX })}</InlineAlert> : null}
          {failure === null ? null : (
            <InlineAlert tone="error">
              {manageFailureText(t, failure, { object: 'stage', role, state: stateWord(order.status) })}
            </InlineAlert>
          )}
          <TextField
            label={t('workOrder.procedureManage.addStage.name')}
            value={name}
            hint={t('workOrder.procedureManage.addStage.nameHint')}
            {...(errors.name === undefined ? {} : { error: errors.name })}
            onChange={(event) => {
              setName(event.target.value);
              setErrors((existing) => ({ ...existing, name: undefined }));
            }}
          />
          <Select label={t('workOrder.procedureManage.addStage.place')} value={place} options={placeOptions} onChange={setPlace} />
          <DateField
            label={t('workOrder.procedureManage.addStage.dueDate')}
            value={dueDate}
            min={DUE_DATE_MIN}
            max={DUE_DATE_MAX}
            {...(errors.dueDate === undefined ? {} : { error: errors.dueDate })}
            onChange={(value) => {
              setDueDate(value);
              setErrors((existing) => ({ ...existing, dueDate: undefined }));
            }}
          />
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
                  {t('workOrder.procedureManage.addStage.usersRetry')}
                </Button>
              }
            >
              {t('workOrder.procedureManage.addStage.usersError')}
            </InlineAlert>
          ) : null}
          <Select
            label={t('workOrder.procedureManage.addStage.responsible')}
            value={responsibleUserId}
            options={userOptions}
            {...(users.isPending ? { hint: t('workOrder.procedureManage.addStage.usersLoading') } : {})}
            {...(errors.responsibleUserId === undefined ? {} : { error: errors.responsibleUserId })}
            onChange={(value) => {
              setResponsibleUserId(value);
              setErrors((existing) => ({ ...existing, responsibleUserId: undefined }));
            }}
          />
          <p className="text-body-sm text-text-secondary">{t('workOrder.procedureManage.addStage.info')}</p>
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

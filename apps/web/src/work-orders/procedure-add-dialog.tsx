import { createWorkOrderProcedure, type CreateProcedureRequest, type Procedure, type WorkOrderDetails } from '@evia/contracts';
import { Banner, Button, Dialog, InlineAlert, Select, Skeleton, WifiOff, type SelectOption } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { useAttempt } from '../forms/attempt.ts';
import { DiscardDialog } from '../forms/discard-dialog.tsx';
import { refusesAttempt } from '../forms/save-failure.ts';
import { useSession } from '../session/session.ts';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { useStateWord } from './edit-failure.ts';
import { pluralForm } from './order-form.ts';
import { manageFailureText } from './procedure-failure-text.ts';
import { PROCEDURES_MAX, classifyManage, type ManageFailure } from './procedure-manage.ts';
import { WORK_ORDER_HEADER_KEY, WORK_ORDER_JOURNAL_KEY, WORK_ORDER_PROCEDURES_KEY } from './query-keys.ts';
import { useProcedureTemplates } from './use-order-lookups.ts';

const END = 'end';

/**
 * Dialog "Dodaj proces" (EVM-042 AC1; W-06 (d)): one of the templates of the processes and the place in the list ("Na końcu" or "Po:
 * …"). A template whose code is already active in the order is listed but cannot be chosen ("już jest w zleceniu" — at most one active
 * process of a code); a race ends in `409 procedure_already_active` and says which process it is. The `id` and the `Idempotency-Key` stay
 * the same for a retry of the same content, so a lost answer never adds the process twice. Names are rendered as React text only.
 */
export function ProcedureAddDialog({
  order,
  procedures,
  onClose,
  onAdded,
}: {
  readonly order: WorkOrderDetails;
  readonly procedures: readonly Procedure[];
  readonly onClose: () => void;
  readonly onAdded: (procedureId: string) => void;
}) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const attempt = useAttempt();
  const stateWord = useStateWord();
  const role = useSession().data?.user.role;
  const formId = useId();
  const templates = useProcedureTemplates();
  const [code, setCode] = useState('');
  const [place, setPlace] = useState(END);
  const [codeError, setCodeError] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<ManageFailure | null>(null);
  const [discarding, setDiscarding] = useState(false);

  const present = new Set(procedures.map((procedure) => procedure.code));
  const chosen = templates.data?.find((template) => template.code === code);
  const dirty = code !== '' || place !== END;

  const mutation = useMutation({
    mutationFn: (request: { readonly body: CreateProcedureRequest; readonly key: string }) =>
      unwrap(
        createWorkOrderProcedure({
          client,
          path: { workOrderId: order.id },
          body: request.body,
          headers: { 'Idempotency-Key': request.key },
        }),
      ),
  });

  const dismiss = () => {
    if (dirty && !mutation.isPending) setDiscarding(true);
    else onClose();
  };

  const stagesText = (count: number): string => {
    switch (pluralForm(count)) {
      case 'one':
        return t('workOrder.procedureManage.stagesOne', { count });
      case 'few':
        return t('workOrder.procedureManage.stagesFew', { count });
      case 'many':
        return t('workOrder.procedureManage.stagesMany', { count });
    }
  };

  const templateOptions: SelectOption[] = [
    { value: '', label: t('workOrder.procedureManage.addProcedure.choose') },
    ...(templates.data ?? []).map((template) =>
      present.has(template.code)
        ? { value: template.code, label: t('workOrder.procedureManage.addProcedure.taken', { name: template.name }), disabled: true }
        : { value: template.code, label: template.name },
    ),
  ];
  // "Po: …" names every process but the last: after the last one is "Na końcu".
  const placeOptions: SelectOption[] = [
    { value: END, label: t('workOrder.procedureManage.addProcedure.end') },
    ...procedures.slice(0, -1).map((procedure) => ({
      value: String(procedure.position + 1),
      label: t('workOrder.procedureManage.addProcedure.after', { name: procedure.name }),
    })),
  ];

  const submit = () => {
    if (chosen === undefined) {
      setCodeError(t('workOrder.procedureManage.addProcedure.required'));
      return;
    }
    const { id, key } = attempt.next(JSON.stringify({ order: order.id, code, place }));
    const body: CreateProcedureRequest = {
      id,
      procedureTemplateCode: chosen.code,
      ...(place === END ? {} : { position: Number(place) }),
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
          showToast(t('workOrder.procedureManage.addProcedure.added', { name: chosen.name }));
          onClose();
        },
        onError: (error) => {
          if (refusesAttempt(error)) attempt.forget();
          const failed = classifyManage(error);
          if (failed.kind === 'closed') void queryClient.refetchQueries({ queryKey: [WORK_ORDER_HEADER_KEY, order.id] });
          // The answer carries no state: the processes are read again, so the template that was taken is no longer offered.
          if (failed.kind === 'active' || failed.kind === 'tooManyProcedures' || failed.kind === 'gone') {
            void queryClient.refetchQueries({ queryKey: [WORK_ORDER_PROCEDURES_KEY, order.id] });
          }
          if (failed.kind === 'invalid') {
            setCodeError(t('workOrder.procedureManage.addProcedure.unavailable'));
            return;
          }
          setFailure(failed);
        },
      },
    );
  };

  const failureText = (failed: ManageFailure): string =>
    failed.kind === 'active'
      ? chosen === undefined
        ? t('workOrder.procedureManage.addProcedure.activeNoName')
        : t('workOrder.procedureManage.addProcedure.active', { name: chosen.name })
      : manageFailureText(t, failed, { object: 'procedure', role, state: stateWord(order.status) });

  const atLimit = procedures.length >= PROCEDURES_MAX;
  const blocked = failure?.kind === 'closed' || atLimit;

  return (
    <>
      <Dialog
        open={!discarding}
        title={t('workOrder.procedureManage.addProcedure.title')}
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
              disabled={!online || blocked || templates.data === undefined}
              {...(online ? {} : { title: t('workOrder.procedureManage.offline') })}
            >
              {t('workOrder.procedureManage.addProcedure.submit')}
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
            {t('workOrder.procedureManage.addProcedure.subtitle', { number: order.number, title: order.title })}
          </p>
          {online ? null : <Banner icon={WifiOff}>{t('workOrder.procedureManage.offline')}</Banner>}
          {atLimit ? (
            <InlineAlert tone="error">{t('workOrder.procedureManage.limitProcedures', { max: PROCEDURES_MAX })}</InlineAlert>
          ) : null}
          {failure === null ? null : <InlineAlert tone="error">{failureText(failure)}</InlineAlert>}
          {templates.isError ? (
            <InlineAlert
              tone="error"
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    void templates.refetch();
                  }}
                >
                  {t('workOrder.procedureManage.addProcedure.retry')}
                </Button>
              }
            >
              {t('workOrder.procedureManage.addProcedure.loadError')}
            </InlineAlert>
          ) : null}
          {templates.isPending ? (
            <div aria-busy="true" className="flex flex-col gap-stack-sm">
              <p role="status" className="sr-only">
                {t('workOrder.procedureManage.addProcedure.loading')}
              </p>
              <Skeleton shape="field" />
            </div>
          ) : (
            <Select
              label={t('workOrder.procedureManage.addProcedure.process')}
              value={code}
              options={templateOptions}
              {...(codeError === undefined ? {} : { error: codeError })}
              onChange={(value) => {
                setCode(value);
                setCodeError(undefined);
                setFailure(null);
              }}
            />
          )}
          <Select
            label={t('workOrder.procedureManage.addProcedure.place')}
            value={place}
            options={placeOptions}
            onChange={(value) => {
              setPlace(value);
            }}
          />
          {chosen === undefined ? null : (
            <p className="text-body-sm text-text-secondary">
              {t('workOrder.procedureManage.addProcedure.stages', { stages: stagesText(chosen.stages.length) })}
            </p>
          )}
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

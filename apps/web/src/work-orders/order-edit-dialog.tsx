import { updateWorkOrder, type WorkOrderDetails, type WorkOrderPatch } from '@evia/contracts';
import { Banner, Button, DateField, Dialog, InlineAlert, Select, TextArea, TextField, WifiOff, type SelectOption } from '@evia/ui-web';
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
import { formatDueDate } from './procedure-format.ts';
import { classifyEdit, useStateWord, type EditFailure } from './edit-failure.ts';
import { PLANNED_DATE_MAX, PLANNED_DATE_MIN } from './order-form.ts';
import { WORK_ORDER_HEADER_KEY, WORK_ORDER_JOURNAL_KEY, WORK_ORDERS_KEY } from './query-keys.ts';
import { useAssignableUsers } from './use-order-lookups.ts';

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 2000;

/** What the dialog edits: the four fields of the contract `WorkOrderPatch`, as the controls hold them (`''` is "empty"). */
interface Draft {
  readonly title: string;
  readonly description: string;
  readonly coordinatorId: string;
  readonly plannedDate: string;
}

type Field = keyof Draft;
type FieldErrors = Partial<Record<Field, string>>;

const etagOf = (version: number): string => `"${String(version)}"`;
const normalize = (text: string): string => text.normalize('NFC').trim();

const draftOf = (order: WorkOrderDetails): Draft => ({
  title: order.title,
  description: order.description ?? '',
  coordinatorId: order.coordinator?.id ?? '',
  plannedDate: order.plannedDate ?? '',
});

/**
 * The merge-patch of what changed (`null` clears the description and the date). A field that was not touched is not sent, so a
 * stale value never overwrites somebody else's change (SR-API-07); the server fields (`number`, `status`, `version` …) cannot be
 * named here (SR-AUTHZ-04).
 */
export function buildOrderPatch(initial: Draft, current: Draft): WorkOrderPatch {
  const patch: WorkOrderPatch = {};
  const title = normalize(current.title);
  if (title !== normalize(initial.title)) patch.title = title;
  const description = normalize(current.description);
  if (description !== normalize(initial.description)) patch.description = description === '' ? null : description;
  if (current.plannedDate !== initial.plannedDate) patch.plannedDate = current.plannedDate === '' ? null : current.plannedDate;
  if (current.coordinatorId !== initial.coordinatorId && current.coordinatorId !== '') patch.assigneeUserId = current.coordinatorId;
  return patch;
}

/**
 * Dialog "Edytuj dane zlecenia" (EVM-035 AC1, AC6, AC7, AC8; W-06 (a)): title, description, coordinator and planned date. The
 * change goes out as a merge-patch of the fields that changed with `If-Match` of the version on screen and an `Idempotency-Key`
 * that is the same for a retry of the same content. `412` keeps what was typed, reads the header again and shows "Aktualnie: …"
 * under the fields that differ; `409 work_order_closed` disables the save; `400 assignee_unavailable` is one answer for an
 * account that does not exist, is invited, deactivated or deleted. The typed text lives in this component only — never in a store
 * of the browser (TM-10). Everything is rendered as React text (SR-WEB-03).
 */
export function OrderEditDialog({ order, onClose }: { readonly order: WorkOrderDetails; readonly onClose: () => void }) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const users = useAssignableUsers();
  const attempt = useAttempt();
  const stateWord = useStateWord();
  const role = useSession().data?.user.role;
  const formId = useId();
  // What the dialog was opened with stays the reference of "what was touched", also after the header was read again.
  const [initial] = useState<Draft>(() => draftOf(order));
  const [current, setCurrent] = useState<Draft>(initial);
  const [version, setVersion] = useState(order.version);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<EditFailure | null>(null);
  const [fresh, setFresh] = useState<Draft | null>(null);
  const [discarding, setDiscarding] = useState(false);

  const patch = buildOrderPatch(initial, current);
  const dirty = Object.keys(patch).length > 0;

  const mutation = useMutation({
    mutationFn: (request: { readonly body: WorkOrderPatch; readonly key: string; readonly version: number }) =>
      unwrap(
        updateWorkOrder({
          client,
          path: { workOrderId: order.id },
          body: request.body,
          headers: { 'If-Match': etagOf(request.version), 'Idempotency-Key': request.key },
        }),
      ),
  });

  const dismiss = () => {
    if (dirty && !mutation.isPending) setDiscarding(true);
    else onClose();
  };

  const check = (): FieldErrors => {
    const found: FieldErrors = {};
    const title = normalize(current.title);
    if (title === '') found.title = t('workOrder.edit.titleRequired');
    else if (title.length > TITLE_MAX) found.title = t('workOrder.edit.titleTooLong', { max: TITLE_MAX });
    if (normalize(current.description).length > DESCRIPTION_MAX)
      found.description = t('workOrder.edit.descriptionTooLong', { max: DESCRIPTION_MAX });
    if (current.plannedDate !== '' && (current.plannedDate < PLANNED_DATE_MIN || current.plannedDate > PLANNED_DATE_MAX))
      found.plannedDate = t('workOrder.edit.plannedDateOutOfRange');
    return found;
  };

  const submit = () => {
    if (!dirty) {
      onClose();
      return;
    }
    const found = check();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const { key } = attempt.next(JSON.stringify({ order: order.id, version, patch }));
    setFailure(null);
    mutation.mutate(
      { body: patch, key, version },
      {
        onSuccess: (saved) => {
          attempt.forget();
          queryClient.setQueryData<WorkOrderDetails>([WORK_ORDER_HEADER_KEY, order.id], saved);
          // The title and the coordinator are in the list of orders; EVM-038: the edit wrote a journal event.
          void queryClient.invalidateQueries({ queryKey: [WORK_ORDERS_KEY] });
          void queryClient.invalidateQueries({ queryKey: [WORK_ORDER_JOURNAL_KEY, order.id] });
          showToast(t('workOrder.edit.saved'));
          onClose();
        },
        onError: (error) => {
          if (refusesAttempt(error)) attempt.forget();
          const failed = classifyEdit(error);
          setFailure(failed);
          if (failed.kind === 'conflict' || failed.kind === 'closed') {
            // The answer carries no values: the header is read again; the fresh version is used by the next save.
            void queryClient.refetchQueries({ queryKey: [WORK_ORDER_HEADER_KEY, order.id] }).then(() => {
              const latest = queryClient.getQueryData<WorkOrderDetails>([WORK_ORDER_HEADER_KEY, order.id]);
              if (latest === undefined) return;
              setVersion(latest.version);
              setFresh(draftOf(latest));
            });
            return;
          }
          if (failed.kind === 'invalid' && error instanceof ApiError) {
            const mapped: FieldErrors = {};
            for (const entry of error.errors) {
              if (entry.pointer === '/title')
                mapped.title = entry.code === 'required' ? t('workOrder.edit.titleRequired') : t('workOrder.edit.invalidText');
              else if (entry.pointer === '/description') mapped.description = t('workOrder.edit.invalidText');
              else if (entry.pointer === '/plannedDate') mapped.plannedDate = t('workOrder.edit.plannedDateOutOfRange');
              else if (entry.pointer === '/assigneeUserId') mapped.coordinatorId = t('workOrder.edit.assigneeUnavailable');
            }
            setErrors(mapped);
            if (Object.keys(mapped).length > 0) setFailure(null);
            else setFailure({ kind: 'network' });
          }
        },
      },
    );
  };

  const failureText = (failed: EditFailure): string => {
    const state = stateWord(order.status);
    switch (failed.kind) {
      case 'conflict':
        return t('workOrder.edit.conflict');
      case 'closed':
        return role === 'editor' ? t('workOrder.edit.closedNowEditor', { state }) : t('workOrder.edit.closedNow', { state });
      case 'gone':
        return t('workOrder.edit.gone');
      case 'forbidden':
        return t('workOrder.edit.forbidden');
      case 'rate':
        return t('workOrder.edit.rateLimited', { seconds: failed.seconds });
      case 'server':
        return t('workOrder.edit.server', { code: failed.code });
      case 'limit':
      case 'proceduresLimit':
      case 'invalid':
      case 'network':
      case 'inProgress':
        return t('workOrder.edit.network');
    }
  };

  // The person who is the coordinator now stays on the list even when the list of users no longer holds them (shown, not lost).
  const listed = users.data ?? [];
  const known = new Set(listed.map((user) => user.id));
  const options: SelectOption[] = [
    ...(initial.coordinatorId === '' ? [{ value: '', label: t('workOrder.edit.coordinator') }] : []),
    ...(order.coordinator !== null && !known.has(order.coordinator.id)
      ? [{ value: order.coordinator.id, label: order.coordinator.displayName }]
      : []),
    ...listed.map((user) => ({ value: user.id, label: user.displayName })),
  ];

  /** "Aktualnie: …" under a field whose current value on the server differs from what the dialog was opened with. */
  const currentOf = (field: Field): string | undefined => {
    if (failure?.kind !== 'conflict' || fresh === null || fresh[field] === initial[field]) return undefined;
    const value = fresh[field];
    if (value === '') return t('workOrder.edit.currentNone');
    if (field === 'plannedDate') return t('workOrder.edit.current', { value: formatDueDate(value) });
    if (field === 'coordinatorId') {
      const name = [...listed, ...(order.coordinator === null ? [] : [order.coordinator])].find((user) => user.id === value)?.displayName;
      return name === undefined ? undefined : t('workOrder.edit.current', { value: name });
    }
    return t('workOrder.edit.current', { value });
  };
  const hintOf = (base: string | undefined, field: Field): { hint?: string } => {
    const now = currentOf(field);
    const hint = now === undefined ? base : base === undefined ? now : `${base} ${now}`;
    return hint === undefined ? {} : { hint };
  };
  const errorOf = (field: Field): { error?: string } => (errors[field] === undefined ? {} : { error: errors[field] });

  const closed = failure?.kind === 'closed';

  return (
    <>
      <Dialog
        open={!discarding}
        title={t('workOrder.edit.title')}
        closeLabel={t('workOrder.edit.close')}
        onDismiss={dismiss}
        actions={
          <>
            <Button variant="tertiary" onClick={dismiss}>
              {t('workOrder.edit.cancel')}
            </Button>
            <Button
              type="submit"
              form={formId}
              loading={mutation.isPending}
              disabled={!online || closed}
              {...(online ? {} : { title: t('workOrder.edit.offlineSubmit') })}
            >
              {t('workOrder.edit.submit')}
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
          <p className="text-body-sm text-text-secondary">{order.number}</p>
          {online ? null : <Banner icon={WifiOff}>{t('workOrder.edit.offlineSubmit')}</Banner>}
          {failure === null ? null : <InlineAlert tone="error">{failureText(failure)}</InlineAlert>}
          <TextField
            label={t('workOrder.edit.fieldTitle')}
            value={current.title}
            {...hintOf(t('workOrder.edit.titleHint'), 'title')}
            {...errorOf('title')}
            onChange={(event) => {
              setCurrent((existing) => ({ ...existing, title: event.target.value }));
              setErrors((existing) => ({ ...existing, title: undefined }));
            }}
          />
          <TextArea
            label={t('workOrder.edit.description')}
            value={current.description}
            rows={4}
            {...hintOf(t('workOrder.edit.descriptionHint'), 'description')}
            {...errorOf('description')}
            onChange={(event) => {
              setCurrent((existing) => ({ ...existing, description: event.target.value }));
              setErrors((existing) => ({ ...existing, description: undefined }));
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
                  {t('workOrder.edit.usersRetry')}
                </Button>
              }
            >
              {t('workOrder.edit.usersError')}
            </InlineAlert>
          ) : null}
          <Select
            label={t('workOrder.edit.coordinator')}
            value={current.coordinatorId}
            options={options}
            {...hintOf(users.isPending ? t('workOrder.edit.usersLoading') : undefined, 'coordinatorId')}
            {...errorOf('coordinatorId')}
            onChange={(value) => {
              setCurrent((existing) => ({ ...existing, coordinatorId: value }));
              setErrors((existing) => ({ ...existing, coordinatorId: undefined }));
            }}
          />
          <DateField
            label={t('workOrder.edit.plannedDate')}
            value={current.plannedDate}
            min={PLANNED_DATE_MIN}
            max={PLANNED_DATE_MAX}
            {...hintOf(undefined, 'plannedDate')}
            {...errorOf('plannedDate')}
            onChange={(value) => {
              setCurrent((existing) => ({ ...existing, plannedDate: value }));
              setErrors((existing) => ({ ...existing, plannedDate: undefined }));
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

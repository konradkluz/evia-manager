import { updateWorkOrderScopeItem, type ScopeItem, type ScopeItemList, type ScopeItemPatch, type WorkOrderDetails } from '@evia/contracts';
import { Banner, Button, Dialog, InlineAlert, TextArea, WifiOff } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { useAttempt } from '../forms/attempt.ts';
import { DiscardDialog } from '../forms/discard-dialog.tsx';
import { refusesAttempt } from '../forms/save-failure.ts';
import { describeParameters } from '../i18n/parameter-labels.ts';
import { useSession } from '../session/session.ts';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { classifyEdit, useStateWord, type EditFailure } from './edit-failure.ts';
import { ParameterControls } from './parameter-controls.tsx';
import { WORK_ORDER_HEADER_KEY, WORK_ORDER_JOURNAL_KEY, WORK_ORDER_SCOPE_KEY } from './query-keys.ts';
import { CUSTOM_SERVICE_CODE, NOTES_MAX, hasForbiddenCharacters } from './scope-add-dialog.tsx';
import {
  buildParameters,
  hasParameterSet,
  sameParameters,
  valuesOf,
  type ParameterErrors,
  type ParameterValues,
} from './scope-parameters.ts';

/** What the dialog is for: parameters (an item with a set), notes (an item without a set) or the description of "Inna usługa". */
export type ScopeEditVariant = 'parameters' | 'notes' | 'description';

export function editVariantOf(item: Pick<ScopeItem, 'code' | 'parameterSetCode'>): ScopeEditVariant {
  if (item.code === CUSTOM_SERVICE_CODE) return 'description';
  return hasParameterSet(item.parameterSetCode) ? 'parameters' : 'notes';
}

const etagOf = (version: number): string => `"${String(version)}"`;
const normalize = (text: string): string => text.normalize('NFC').trim();

/** The text after a conflict: what the item holds now, as the list shows it (parameters in words, notes as text). */
function currentText(item: ScopeItem, variant: ScopeEditVariant): string | undefined {
  if (variant === 'parameters') {
    const parts = describeParameters(item.parameterSetCode, item.parameters).flatMap((part) => (part.kind === 'text' ? [part.text] : []));
    return parts.length === 0 ? undefined : parts.join(', ');
  }
  return item.notes;
}

/**
 * Dialog "Edytuj parametry" / "Edytuj notatki" / "Edytuj opis" of one scope item (EVM-035 AC4, AC6, AC8; W-06 (c)): the same typed
 * controls as the dialog of adding, filled with the current values. The set comes from the item (a copy of the catalogue); only
 * what changed goes out, as a merge-patch with `If-Match` of the version of the item. `412` keeps what was typed and reads the
 * scope again. The server checks the schema of the set (a field it does not know, a value out of range, more than 16 KB — `400
 * validation_failed`). Typed text stays in this component (TM-10).
 */
export function ScopeEditDialog({
  order,
  item,
  onClose,
}: {
  readonly order: WorkOrderDetails;
  readonly item: ScopeItem;
  readonly onClose: () => void;
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
  const variant = editVariantOf(item);
  const [initial] = useState(() => ({ values: valuesOf(item.parameterSetCode, item.parameters), notes: item.notes ?? '' }));
  const [values, setValues] = useState<ParameterValues>(initial.values);
  const [notes, setNotes] = useState(initial.notes);
  const [version, setVersion] = useState(item.version);
  const [errors, setErrors] = useState<ParameterErrors>({});
  const [notesError, setNotesError] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<EditFailure | null>(null);
  const [fresh, setFresh] = useState<ScopeItem | null>(null);
  const [discarding, setDiscarding] = useState(false);

  const scopeKey = [WORK_ORDER_SCOPE_KEY, order.id];
  const dirty = notes !== initial.notes || Object.keys(values).some((key) => values[key] !== initial.values[key]);

  const mutation = useMutation({
    mutationFn: (request: { readonly body: ScopeItemPatch; readonly key: string; readonly version: number }) =>
      unwrap(
        updateWorkOrderScopeItem({
          client,
          path: { workOrderId: order.id, scopeItemId: item.id },
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
    const text = normalize(notes);
    let problem: string | undefined;
    if (variant === 'description' && text === '') problem = t('workOrder.scopeEdit.descriptionRequired');
    else if (text.length > NOTES_MAX) problem = t('workOrder.scopeEdit.notesTooLong', { max: NOTES_MAX });
    else if (hasForbiddenCharacters(text)) problem = t('workOrder.scopeEdit.notesInvalid');
    const built = variant === 'parameters' ? buildParameters(item.parameterSetCode, values) : { ok: true as const, parameters: {} };
    setNotesError(problem);
    setErrors(built.ok ? {} : built.errors);
    if (problem !== undefined || !built.ok) return;
    const patch: ScopeItemPatch = {
      ...(variant === 'parameters' && !sameParameters(built.parameters, item.parameters) ? { parameters: built.parameters } : {}),
      ...(text !== normalize(item.notes ?? '') ? { notes: text === '' ? null : text } : {}),
    };
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    const { key } = attempt.next(JSON.stringify({ order: order.id, item: item.id, version, patch }));
    setFailure(null);
    mutation.mutate(
      { body: patch, key, version },
      {
        onSuccess: (saved) => {
          attempt.forget();
          queryClient.setQueryData<ScopeItemList>(scopeKey, (list) =>
            list === undefined ? list : { ...list, items: list.items.map((entry) => (entry.id === saved.id ? saved : entry)) },
          );
          void queryClient.invalidateQueries({ queryKey: [WORK_ORDER_JOURNAL_KEY, order.id] });
          const done =
            variant === 'parameters'
              ? t('workOrder.scopeEdit.savedParameters', { name: item.name })
              : variant === 'notes'
                ? t('workOrder.scopeEdit.savedNotes', { name: item.name })
                : t('workOrder.scopeEdit.savedDescription', { name: item.name });
          showToast(done);
          onClose();
        },
        onError: (error) => {
          if (refusesAttempt(error)) attempt.forget();
          const failed = classifyEdit(error);
          setFailure(failed);
          if (failed.kind === 'conflict') {
            // The answer carries no values: the scope is read again and the fresh version is used by the next save.
            void queryClient.refetchQueries({ queryKey: scopeKey }).then(() => {
              const latest = queryClient.getQueryData<ScopeItemList>(scopeKey)?.items.find((entry) => entry.id === item.id);
              if (latest === undefined) return;
              setVersion(latest.version);
              setFresh(latest);
            });
          } else if (failed.kind === 'closed') {
            void queryClient.refetchQueries({ queryKey: [WORK_ORDER_HEADER_KEY, order.id] });
          } else if (failed.kind === 'gone') {
            void queryClient.refetchQueries({ queryKey: scopeKey });
          } else if (failed.kind === 'invalid' && error instanceof ApiError) {
            if (error.errors.some((entry) => entry.pointer === '/notes')) {
              setNotesError(
                variant === 'description' ? t('workOrder.scopeEdit.descriptionRequired') : t('workOrder.scopeEdit.notesInvalid'),
              );
              setFailure(null);
            }
          }
        },
      },
    );
  };

  const failureText = (failed: EditFailure): string => {
    const state = stateWord(order.status);
    switch (failed.kind) {
      case 'conflict':
        return t('workOrder.scopeEdit.conflict');
      case 'closed':
        return role === 'editor' ? t('workOrder.scopeEdit.closedEditor', { state }) : t('workOrder.scopeEdit.closed', { state });
      case 'gone':
        return t('workOrder.scopeEdit.gone');
      case 'forbidden':
        return t('workOrder.scopeEdit.forbidden');
      case 'rate':
        return t('workOrder.scopeEdit.rateLimited', { seconds: failed.seconds });
      case 'server':
        return t('workOrder.scopeEdit.server', { code: failed.code });
      case 'invalid':
        return t('workOrder.scopeEdit.invalid');
      case 'limit':
      case 'proceduresLimit':
      case 'network':
      case 'inProgress':
        return t('workOrder.scopeEdit.network');
    }
  };

  const title =
    variant === 'parameters'
      ? t('workOrder.scopeEdit.titleParameters', { name: item.name })
      : variant === 'notes'
        ? t('workOrder.scopeEdit.titleNotes', { name: item.name })
        : t('workOrder.scopeEdit.titleDescription', { name: item.name });
  const submitLabel =
    variant === 'parameters'
      ? t('workOrder.scopeEdit.submitParameters')
      : variant === 'notes'
        ? t('workOrder.scopeEdit.submitNotes')
        : t('workOrder.scopeEdit.submitDescription');
  const notesLabel = variant === 'description' ? t('workOrder.scopeEdit.description') : t('workOrder.scopeEdit.notes');
  const notesHint = variant === 'description' ? t('workOrder.scopeEdit.descriptionHint') : t('workOrder.scopeEdit.notesHint');
  const showNow = failure?.kind === 'conflict' && fresh !== null;
  const now = showNow ? currentText(fresh, variant) : undefined;
  const closed = failure?.kind === 'closed';

  return (
    <>
      <Dialog
        open={!discarding}
        title={title}
        closeLabel={t('workOrder.scopeEdit.close')}
        onDismiss={dismiss}
        actions={
          <>
            <Button variant="tertiary" onClick={dismiss}>
              {t('workOrder.scopeEdit.cancel')}
            </Button>
            <Button
              type="submit"
              form={formId}
              loading={mutation.isPending}
              disabled={!online || closed}
              {...(online ? {} : { title: t('workOrder.scopeEdit.offline') })}
            >
              {submitLabel}
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
          {online ? null : <Banner icon={WifiOff}>{t('workOrder.scopeEdit.offline')}</Banner>}
          {failure === null ? null : <InlineAlert tone="error">{failureText(failure)}</InlineAlert>}
          {variant === 'parameters' ? (
            <fieldset className="flex flex-col gap-stack-md">
              <legend className="text-label text-text-primary">{t('workOrder.scopeEdit.parameters')}</legend>
              <p className="text-body-sm text-text-tertiary">{t('workOrder.scopeEdit.parametersHint')}</p>
              <ParameterControls
                setCode={item.parameterSetCode}
                values={values}
                errors={errors}
                onChange={(key, value) => {
                  setValues((existing) => ({ ...existing, [key]: value }));
                  setErrors((existing) => Object.fromEntries(Object.entries(existing).filter(([name]) => name !== key)));
                }}
              />
              {showNow ? (
                <p className="text-body-sm text-text-secondary">
                  {now === undefined ? t('workOrder.scopeEdit.currentNone') : t('workOrder.scopeEdit.current', { value: now })}
                </p>
              ) : null}
            </fieldset>
          ) : null}
          <TextArea
            label={notesLabel}
            value={notes}
            rows={3}
            hint={
              showNow && variant !== 'parameters'
                ? `${notesHint} ${now === undefined ? t('workOrder.scopeEdit.currentNone') : t('workOrder.scopeEdit.current', { value: now })}`
                : notesHint
            }
            {...(notesError === undefined ? {} : { error: notesError })}
            onChange={(event) => {
              setNotes(event.target.value);
              setNotesError(undefined);
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

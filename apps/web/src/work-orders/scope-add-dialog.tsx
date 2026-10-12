import {
  createWorkOrderScopeItem,
  type CreateScopeItemRequest,
  type ProcedureTemplate,
  type ServiceItem,
  type WorkOrderDetails,
} from '@evia/contracts';
import { Banner, Button, CircleCheck, Dialog, InlineAlert, Select, Skeleton, TextArea, WifiOff, Checkbox } from '@evia/ui-web';
import type { SelectGroup } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { useAttempt } from '../forms/attempt.ts';
import { DiscardDialog } from '../forms/discard-dialog.tsx';
import { refusesAttempt } from '../forms/save-failure.ts';
import { serviceCategoryLabels } from '../i18n/catalog-labels.ts';
import { useSession } from '../session/session.ts';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { classifyEdit, useStateWord, type EditFailure } from './edit-failure.ts';
import { pluralForm } from './order-form.ts';
import { ParameterControls } from './parameter-controls.tsx';
import { WORK_ORDER_HEADER_KEY, WORK_ORDER_JOURNAL_KEY, WORK_ORDER_PROCEDURES_KEY, WORK_ORDER_SCOPE_KEY } from './query-keys.ts';
import { buildParameters, hasParameterSet, type ParameterErrors, type ParameterValues } from './scope-parameters.ts';
import { useProcedureTemplates, useServiceItems } from './use-order-lookups.ts';
import { useWorkOrderProcedures } from './use-work-order.ts';

/** The limits of the contract: 50 active items in an order, 1000 characters of notes. */
export const SCOPE_ITEMS_MAX = 50;
export const NOTES_MAX = 1000;
/** The item "Inna usługa (opis w zleceniu)": no parameters, no processes, the description is required (service-catalog.md § 1). */
export const CUSTOM_SERVICE_CODE = 'custom_service';

/** Controls of unicode that the server refuses in free text (a newline is allowed in multi-line fields). */
const CONTROL_CHARACTERS = /(?!\n)[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
export const hasForbiddenCharacters = (text: string): boolean => CONTROL_CHARACTERS.test(text);

const normalize = (text: string): string => text.normalize('NFC').trim();

/** What one item of the catalogue brings, joined with the names and the stages of the templates of the processes. */
interface BroughtProcess {
  readonly code: string;
  readonly name: string;
  readonly stages: number;
}

export function broughtBy(item: ServiceItem, templates: readonly ProcedureTemplate[]): BroughtProcess[] {
  return item.procedureTemplateCodes.flatMap((code) => {
    const template = templates.find((entry) => entry.code === code);
    return template === undefined ? [] : [{ code, name: template.name, stages: template.stages.length }];
  });
}

/**
 * Dialog "Dodaj pozycję zakresu" (EVM-035 AC2, AC4, AC5, AC6; W-06 (c)): an item of the catalogue, its parameters as typed
 * controls of its set, notes (for "Inna usługa" the required description) and the processes the item brings — those whose code is
 * already in the order are not offered ("już jest w zleceniu, nie dodamy drugiego"). One request creates the item and the chosen
 * processes with their stages in one transaction; the `id` and the `Idempotency-Key` are the same for a retry of the same content,
 * so a lost answer never adds the item twice. Nothing typed leaves the memory of the tab (TM-10).
 */
export function ScopeAddDialog({ order, onClose }: { readonly order: WorkOrderDetails; readonly onClose: () => void }) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const attempt = useAttempt();
  const stateWord = useStateWord();
  const role = useSession().data?.user.role;
  const formId = useId();
  const catalog = useServiceItems();
  const templates = useProcedureTemplates();
  const procedures = useWorkOrderProcedures(order.id, true);
  const [itemCode, setItemCode] = useState('');
  const [values, setValues] = useState<ParameterValues>({});
  const [notes, setNotes] = useState('');
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<ParameterErrors>({});
  const [itemError, setItemError] = useState<string | undefined>(undefined);
  const [notesError, setNotesError] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<EditFailure | null>(null);
  const [discarding, setDiscarding] = useState(false);

  const items = catalog.data ?? [];
  const chosen = items.find((entry) => entry.code === itemCode);
  const custom = chosen?.code === CUSTOM_SERVICE_CODE;
  const withParameters = chosen !== undefined && hasParameterSet(chosen.parameterSetCode);
  const present = new Set(procedures.data?.items.map((procedure) => procedure.code) ?? []);
  const brought = chosen === undefined || templates.data === undefined ? [] : broughtBy(chosen, templates.data);
  const addable = brought.filter((process) => !present.has(process.code));
  const already = brought.filter((process) => present.has(process.code));
  const selected = addable.filter((process) => !unchecked.has(process.code)).map((process) => process.code);

  const dirty = itemCode !== '' || notes !== '';

  const mutation = useMutation({
    mutationFn: (request: { readonly body: CreateScopeItemRequest; readonly key: string }) =>
      unwrap(
        createWorkOrderScopeItem({
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

  const groups: SelectGroup[] = Object.entries(serviceCategoryLabels).flatMap(([category, label]) => {
    const inCategory = items.filter((entry) => entry.category === category);
    return inCategory.length === 0 ? [] : [{ label, options: inCategory.map((entry) => ({ value: entry.code, label: entry.name })) }];
  });

  const submit = () => {
    if (chosen === undefined) {
      setItemError(t('workOrder.scopeAdd.itemRequired'));
      return;
    }
    const text = normalize(notes);
    let noteProblem: string | undefined;
    if (custom && text === '') noteProblem = t('workOrder.scopeAdd.descriptionRequired');
    else if (text.length > NOTES_MAX) noteProblem = t('workOrder.scopeAdd.notesTooLong', { max: NOTES_MAX });
    else if (hasForbiddenCharacters(text)) noteProblem = t('workOrder.scopeAdd.notesInvalid');
    const built = withParameters ? buildParameters(chosen.parameterSetCode, values) : { ok: true as const, parameters: {} };
    setNotesError(noteProblem);
    setErrors(built.ok ? {} : built.errors);
    if (noteProblem !== undefined || !built.ok) return;
    const procedureCodes = custom ? [] : selected;
    const content = JSON.stringify({ order: order.id, itemCode, parameters: built.parameters, notes: text, procedureCodes });
    const { id, key } = attempt.next(content);
    const body: CreateScopeItemRequest = {
      id,
      catalogItemCode: chosen.code,
      ...(Object.keys(built.parameters).length === 0 ? {} : { parameters: built.parameters }),
      ...(text === '' ? {} : { notes: text }),
      procedureCodes,
    };
    setFailure(null);
    mutation.mutate(
      { body, key },
      {
        onSuccess: (added) => {
          attempt.forget();
          void queryClient.invalidateQueries({ queryKey: [WORK_ORDER_SCOPE_KEY, order.id] });
          void queryClient.invalidateQueries({ queryKey: [WORK_ORDER_PROCEDURES_KEY, order.id] });
          void queryClient.invalidateQueries({ queryKey: [WORK_ORDER_JOURNAL_KEY, order.id] });
          const names = added.addedProcedureCodes.flatMap((code) => {
            const name = brought.find((process) => process.code === code)?.name;
            return name === undefined ? [] : [name];
          });
          if (names.length === 0) showToast(t('workOrder.scopeAdd.added', { name: chosen.name }));
          else if (names.length === 1) showToast(t('workOrder.scopeAdd.addedWithOne', { name: chosen.name, processes: names.join(', ') }));
          else showToast(t('workOrder.scopeAdd.addedWithMany', { name: chosen.name, processes: names.join(', ') }));
          onClose();
        },
        onError: (error) => {
          if (refusesAttempt(error)) attempt.forget();
          const failed = classifyEdit(error);
          if (failed.kind === 'closed') void queryClient.refetchQueries({ queryKey: [WORK_ORDER_HEADER_KEY, order.id] });
          if (failed.kind === 'limit') void queryClient.refetchQueries({ queryKey: [WORK_ORDER_SCOPE_KEY, order.id] });
          if (failed.kind === 'invalid' && error instanceof ApiError) {
            const unknownItem = error.errors.some((entry) => entry.pointer === '/catalogItemCode');
            const noteIssue = error.errors.some((entry) => entry.pointer === '/notes');
            if (unknownItem) setItemError(t('workOrder.scopeAdd.itemUnavailable'));
            if (noteIssue) setNotesError(custom ? t('workOrder.scopeAdd.descriptionRequired') : t('workOrder.scopeAdd.notesInvalid'));
            if (unknownItem || noteIssue) return;
          }
          setFailure(failed);
        },
      },
    );
  };

  const stagesText = (count: number): string => {
    switch (pluralForm(count)) {
      case 'one':
        return t('workOrder.scopeAdd.stagesOne', { count });
      case 'few':
        return t('workOrder.scopeAdd.stagesFew', { count });
      case 'many':
        return t('workOrder.scopeAdd.stagesMany', { count });
    }
  };

  const failureText = (failed: EditFailure): string => {
    const state = stateWord(order.status);
    switch (failed.kind) {
      case 'closed':
        return role === 'editor' ? t('workOrder.scopeAdd.closedEditor', { state }) : t('workOrder.scopeAdd.closed', { state });
      case 'limit':
        return t('workOrder.scopeAdd.limitExceeded', { max: SCOPE_ITEMS_MAX });
      case 'proceduresLimit':
        return t('workOrder.scopeAdd.proceduresLimit');
      case 'invalid':
        return t('workOrder.scopeAdd.parametersInvalid');
      case 'gone':
        return t('workOrder.scopeAdd.gone');
      case 'forbidden':
        return t('workOrder.scopeAdd.forbidden');
      case 'rate':
        return t('workOrder.scopeAdd.rateLimited', { seconds: failed.seconds });
      case 'server':
        return t('workOrder.scopeAdd.server', { code: failed.code });
      case 'inProgress':
        return t('workOrder.scopeAdd.inProgress');
      case 'conflict':
      case 'network':
        return t('workOrder.scopeAdd.network');
    }
  };

  const closed = failure?.kind === 'closed';
  const ready = catalog.data !== undefined;

  return (
    <>
      <Dialog
        open={!discarding}
        title={t('workOrder.scopeAdd.title')}
        closeLabel={t('workOrder.scopeAdd.close')}
        onDismiss={dismiss}
        actions={
          <>
            <Button variant="tertiary" onClick={dismiss}>
              {t('workOrder.scopeAdd.cancel')}
            </Button>
            <Button
              type="submit"
              form={formId}
              loading={mutation.isPending}
              disabled={!online || closed || !ready}
              {...(online ? {} : { title: t('workOrder.scopeAdd.offline') })}
            >
              {t('workOrder.scopeAdd.submit')}
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
          <p className="text-body-sm text-text-secondary">{t('workOrder.scopeAdd.subtitle', { number: order.number })}</p>
          {online ? null : <Banner icon={WifiOff}>{t('workOrder.scopeAdd.offline')}</Banner>}
          {failure === null ? null : <InlineAlert tone="error">{failureText(failure)}</InlineAlert>}
          {catalog.isError ? (
            <InlineAlert
              tone="error"
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    void catalog.refetch();
                  }}
                >
                  {t('workOrder.scopeAdd.catalogRetry')}
                </Button>
              }
            >
              {t('workOrder.scopeAdd.catalogError')}
            </InlineAlert>
          ) : null}
          {catalog.isPending ? (
            <div aria-busy="true" className="flex flex-col gap-stack-sm">
              <p role="status" className="sr-only">
                {t('workOrder.scopeAdd.catalogLoading')}
              </p>
              <Skeleton shape="field" />
            </div>
          ) : (
            <Select
              label={t('workOrder.scopeAdd.item')}
              value={itemCode}
              options={[{ value: '', label: t('workOrder.scopeAdd.itemPlaceholder') }, ...groups]}
              {...(itemError === undefined ? {} : { error: itemError })}
              onChange={(value) => {
                setItemCode(value);
                setValues({});
                setErrors({});
                setUnchecked(new Set());
                setItemError(undefined);
                setNotesError(undefined);
                setFailure(null);
              }}
            />
          )}
          {chosen !== undefined && withParameters ? (
            <fieldset className="flex flex-col gap-stack-md">
              <legend className="text-label text-text-primary">{t('workOrder.scopeAdd.parameters')}</legend>
              <p className="text-body-sm text-text-tertiary">{t('workOrder.scopeAdd.parametersHint')}</p>
              <ParameterControls
                setCode={chosen.parameterSetCode}
                values={values}
                errors={errors}
                onChange={(key, value) => {
                  setValues((existing) => ({ ...existing, [key]: value }));
                  setErrors((existing) => Object.fromEntries(Object.entries(existing).filter(([name]) => name !== key)));
                }}
              />
            </fieldset>
          ) : null}
          {chosen === undefined ? null : (
            <TextArea
              label={custom ? t('workOrder.scopeAdd.custom') : t('workOrder.scopeAdd.notes')}
              value={notes}
              rows={3}
              hint={custom ? t('workOrder.scopeAdd.customHint') : t('workOrder.scopeAdd.notesHint')}
              {...(notesError === undefined ? {} : { error: notesError })}
              onChange={(event) => {
                setNotes(event.target.value);
                setNotesError(undefined);
              }}
            />
          )}
          {chosen === undefined ? null : brought.length === 0 ? (
            <p className="text-body-sm text-text-secondary">{t('workOrder.scopeAdd.noProcedures')}</p>
          ) : (
            <fieldset className="flex flex-col gap-stack-xs">
              <legend className="text-label text-text-primary">{t('workOrder.scopeAdd.procedures')}</legend>
              {addable.map((process) => (
                <Checkbox
                  key={process.code}
                  label={process.name}
                  description={stagesText(process.stages)}
                  checked={!unchecked.has(process.code)}
                  onChange={(checked) => {
                    setUnchecked((existing) => {
                      const next = new Set(existing);
                      if (checked) next.delete(process.code);
                      else next.add(process.code);
                      return next;
                    });
                  }}
                />
              ))}
              {already.map((process) => (
                <p key={process.code} className="flex items-start gap-inline-sm text-body text-text-primary">
                  <CircleCheck aria-hidden="true" className="mt-stack-xs size-icon-md shrink-0 text-icon-success" />
                  <span>{t('workOrder.scopeAdd.present', { name: process.name })}</span>
                </p>
              ))}
            </fieldset>
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

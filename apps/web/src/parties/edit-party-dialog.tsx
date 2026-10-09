import { updateParty, type Party } from '@evia/contracts';
import { Banner, Button, Dialog, InlineAlert, RadioGroup, TextArea, TextField, WifiOff } from '@evia/ui-web';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { useAttempt } from '../forms/attempt.ts';
import { StateDialog } from '../forms/dialog-states.tsx';
import { DiscardDialog } from '../forms/discard-dialog.tsx';
import { fieldErrorText } from '../forms/field-error-text.ts';
import { describeFailure, refusesAttempt, type SaveFailure } from '../forms/save-failure.ts';
import { partyKindLabels } from '../i18n/catalog-labels.ts';
import { useOnline } from '../shell/use-online.ts';
import { isNotFound } from '../work-orders/use-work-order.ts';
import { buildPartyPatch, changedPartyFields, currentPartyText, partyFormOf } from './party-edit.ts';
import {
  firstInvalidParty,
  missingPartyFields,
  partyFieldOf,
  type PartyFieldErrors,
  type PartyFieldName,
  type PartyForm,
} from './party-form.ts';
import { useParty } from './use-party.ts';

export interface EditPartyDialogProps {
  readonly partyId: string;
  /** Closing: the saved party, or `undefined` when nothing was saved. */
  readonly onClose: (saved?: Party) => void;
  /** The party is gone (`404`): "Odśwież zlecenie" closes the dialog and reads the order again. */
  readonly onRefresh: () => void;
}

const etagOf = (version: number): string => `"${String(version)}"`;

type Failure = SaveFailure | { readonly kind: 'conflict' };

/**
 * Dialog "Edytuj stronę" (EVM-036 AC3, AC4; W-20): reads the party (skeleton, error with "Spróbuj ponownie", "Nie znaleziono strony"),
 * then hands over to the form. The kind of the party is shown as text — it cannot be changed (the API answers `read_only_field`).
 */
export function EditPartyDialog(props: EditPartyDialogProps) {
  const { t } = useTranslation();
  const party = useParty(props.partyId);
  // What the form was opened with: once it is there it stays, whatever a later read of the party does (typed data is never lost).
  const [opened, setOpened] = useState<Party | null>(null);
  const close = () => {
    props.onClose();
  };
  if (opened === null && party.data !== undefined) setOpened(party.data);
  if (opened !== null) return <EditPartyForm {...props} party={opened} refresh={async () => (await party.refetch()).data} />;
  const title = t('partyEdit.title');
  if (isNotFound(party.error)) {
    return (
      <StateDialog
        title={title}
        onClose={close}
        state={{ kind: 'gone', text: t('partyEdit.gone'), actionLabel: t('partyEdit.refresh'), onAction: props.onRefresh }}
      />
    );
  }
  if (party.isError) {
    return (
      <StateDialog
        title={title}
        onClose={close}
        state={{
          kind: 'error',
          text: t('partyEdit.loadError'),
          retryLabel: t('partyEdit.retry'),
          onRetry: () => {
            void party.refetch();
          },
        }}
      />
    );
  }
  return <StateDialog title={title} onClose={close} state={{ kind: 'loading', text: t('partyEdit.loading') }} />;
}

function EditPartyForm({
  party,
  refresh,
  onClose,
  onRefresh,
}: EditPartyDialogProps & { readonly party: Party; readonly refresh: () => Promise<Party | undefined> }) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const [initial] = useState(() => partyFormOf(party));
  const [form, setForm] = useState<PartyForm>(initial);
  const [version, setVersion] = useState(party.version);
  const [latest, setLatest] = useState<Party | null>(null);
  const [errors, setErrors] = useState<PartyFieldErrors>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [asking, setAsking] = useState(false);
  const [gone, setGone] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const formId = useId();
  const attempt = useAttempt();
  const fields = useRef<Partial<Record<PartyFieldName, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  const alert = useRef<HTMLDivElement>(null);

  const mutation = useMutation({
    mutationFn: (request: { readonly body: ReturnType<typeof buildPartyPatch>; readonly key: string; readonly version: number }) =>
      unwrap(
        updateParty({
          client,
          path: { partyId: party.id },
          body: request.body,
          headers: { 'If-Match': etagOf(request.version), 'Idempotency-Key': request.key },
        }),
      ),
  });

  const touched = changedPartyFields(initial, form);
  const dirty = touched.length > 0 || form.legalForm !== initial.legalForm;
  // The fields the person changed and somebody else changed too: their value now is shown under the field.
  const conflicts: PartyFieldName[] =
    latest === null
      ? []
      : touched.filter(
          (field) => currentPartyText(latest, field) !== form[field].trim() && currentPartyText(latest, field) !== initial[field].trim(),
        );

  useEffect(() => {
    if (focusRequest === 0) return;
    const target = firstInvalidParty(errors) ?? conflicts[0];
    if (target !== undefined) fields.current[target]?.focus();
    else if (failure !== null) alert.current?.focus();
    // Only the request matters here: it is bumped together with the errors and the failure it concerns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  const change = (field: PartyFieldName, value: string) => {
    setForm((existing) => ({ ...existing, [field]: value }));
    setErrors((existing) =>
      existing[field] === undefined ? existing : Object.fromEntries(Object.entries(existing).filter(([name]) => name !== field)),
    );
  };

  const dismiss = () => {
    if (dirty && !mutation.isPending) setAsking(true);
    else onClose();
  };

  const submit = () => {
    const missing = missingPartyFields(form);
    if (missing.length > 0) {
      setErrors(Object.fromEntries(missing.map((field) => [field, t('formErrors.required')])));
      setFailure(null);
      setFocusRequest((value) => value + 1);
      return;
    }
    const body = buildPartyPatch(initial, form);
    // Nothing changed: nothing to save (a patch would raise the version and write to the audit log for no reason).
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    const { key } = attempt.next(JSON.stringify({ body, version }));
    setErrors({});
    setFailure(null);
    mutation.mutate(
      { body, key, version },
      {
        onSuccess: (saved) => {
          onClose(saved);
        },
        onError: (error) => {
          if (refusesAttempt(error)) attempt.forget();
          if (error instanceof ApiError && error.status === 404) {
            setGone(true);
            return;
          }
          if (error instanceof ApiError && error.status === 412) {
            setFailure({ kind: 'conflict' });
            setErrors({});
            // The answer carries no values: the party is read again and the fresh version is used by the next save.
            void refresh().then((fresh) => {
              if (fresh !== undefined) {
                setLatest(fresh);
                setVersion(fresh.version);
              }
              setFocusRequest((value) => value + 1);
            });
            return;
          }
          const mapped: PartyFieldErrors = {};
          if (error instanceof ApiError && error.status === 400) {
            for (const entry of error.errors) {
              const field = partyFieldOf(entry);
              if (field !== undefined && mapped[field] === undefined) mapped[field] = fieldErrorText(t, field, entry.code);
            }
          }
          setErrors(mapped);
          setFailure(describeFailure(error, Object.keys(mapped).length > 0));
          setFocusRequest((value) => value + 1);
        },
      },
    );
  };

  const failureText = (failed: Failure): string => {
    switch (failed.kind) {
      case 'conflict':
        return t('partyEdit.conflict');
      case 'fields':
        return t('partyEdit.failure.fields');
      case 'network':
        return t('partyEdit.failure.network');
      case 'inProgress':
        return t('partyEdit.failure.inProgress');
      case 'forbidden':
        return t('partyEdit.failure.forbidden');
      case 'rate':
        return t('partyEdit.failure.rateLimited', { seconds: failed.seconds });
      case 'server':
        return t('partyEdit.failure.server', { code: failed.code });
    }
  };

  /** A field with "Aktualnie: …" under it when somebody else changed it while the dialog was open (plain text, SR-WEB-03). */
  const withCurrent = (field: PartyFieldName, control: ReactNode) => {
    if (latest === null || !conflicts.includes(field)) return control;
    const now = currentPartyText(latest, field);
    return (
      <div className="flex flex-col gap-stack-xs">
        {control}
        <p className="text-body-sm text-text-secondary">{now === '' ? t('forms.currentNone') : t('forms.current', { value: now })}</p>
      </div>
    );
  };

  const text = (field: PartyFieldName, label: string, extra: { type?: 'email' | 'tel' } = {}) =>
    withCurrent(
      field,
      <TextField
        label={label}
        value={form[field]}
        type={extra.type ?? 'text'}
        autoComplete="off"
        error={errors[field]}
        inputRef={(element) => {
          fields.current[field] = element;
        }}
        onChange={(event) => {
          change(field, event.target.value);
        }}
      />,
    );

  if (gone) {
    return (
      <StateDialog
        title={t('partyEdit.title')}
        onClose={() => {
          onClose();
        }}
        state={{ kind: 'gone', text: t('partyEdit.gone'), actionLabel: t('partyEdit.refresh'), onAction: onRefresh }}
      />
    );
  }

  return (
    <>
      <Dialog
        open={!asking}
        title={t('partyEdit.title')}
        closeLabel={t('forms.closeDialog')}
        onDismiss={dismiss}
        actions={
          <>
            <Button variant="tertiary" onClick={dismiss}>
              {t('forms.cancel')}
            </Button>
            <Button
              type="submit"
              form={formId}
              loading={mutation.isPending}
              disabled={!online}
              {...(online ? {} : { title: t('forms.submitOffline') })}
            >
              {t('partyEdit.submit')}
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
          <p className="break-words text-body text-text-secondary">
            {t('partyEdit.subtitle', { name: party.displayName, kind: partyKindLabels[party.kind] })}
          </p>
          <InlineAlert tone="info">{t('partyEdit.shared')}</InlineAlert>
          {online ? null : <Banner icon={WifiOff}>{t('partyEdit.offline')}</Banner>}
          {failure === null ? null : (
            <InlineAlert tone="error" alertRef={alert}>
              {failureText(failure)}
            </InlineAlert>
          )}
          <div className="flex flex-col gap-stack-xs">
            <span className="text-label text-text-primary">{t('partyEdit.kind')}</span>
            <p className="text-body text-text-primary">{partyKindLabels[party.kind]}</p>
            <p className="text-body-sm text-text-secondary">{t('partyEdit.kindHint')}</p>
          </div>
          <RadioGroup
            legend={t('parties.dialog.legalForm')}
            value={form.legalForm}
            onChange={(legalForm) => {
              setForm((existing) => ({ ...existing, legalForm: legalForm === 'natural_person' ? 'natural_person' : 'organization' }));
            }}
            options={[
              { value: 'organization', label: t('parties.dialog.organization') },
              { value: 'natural_person', label: t('parties.dialog.naturalPerson') },
            ]}
          />
          {text('displayName', form.legalForm === 'natural_person' ? t('parties.dialog.personName') : t('parties.dialog.name'))}
          {text('contactPersonName', t('parties.dialog.contactPerson'))}
          <div className="grid grid-cols-1 gap-inline-md medium:grid-cols-2">
            {text('phone', t('parties.dialog.phone'), { type: 'tel' })}
            {text('email', t('parties.dialog.email'), { type: 'email' })}
          </div>
          {withCurrent(
            'notes',
            <TextArea
              label={t('parties.dialog.notes')}
              value={form.notes}
              hint={t('parties.dialog.notesHint')}
              error={errors.notes}
              inputRef={(element) => {
                fields.current.notes = element;
              }}
              onChange={(event) => {
                change('notes', event.target.value);
              }}
            />,
          )}
        </form>
      </Dialog>
      <DiscardDialog
        open={asking}
        onConfirm={() => {
          onClose();
        }}
        onBack={() => {
          setAsking(false);
        }}
      />
    </>
  );
}

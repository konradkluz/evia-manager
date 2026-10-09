import { createParty, type PartyKind } from '@evia/contracts';
import { Banner, Button, Dialog, InlineAlert, RadioGroup, Select, TextArea, TextField, WifiOff } from '@evia/ui-web';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, unwrap } from '../api/client.ts';
import { useApi } from '../api/api-context.tsx';
import { fieldErrorText } from '../forms/field-error-text.ts';
import { useAttempt } from '../forms/attempt.ts';
import { describeFailure, refusesAttempt, type SaveFailure } from '../forms/save-failure.ts';
import { partyKindLabels } from '../i18n/catalog-labels.ts';
import { useOnline } from '../shell/use-online.ts';
import {
  buildPartyBody,
  emptyPartyForm,
  firstInvalidParty,
  missingPartyFields,
  partyFieldOf,
  partyFingerprint,
  type PartyFieldErrors,
  type PartyFieldName,
  type PartyForm,
} from './party-form.ts';
import type { PickedParty } from './party-picker.tsx';

export interface AddPartyDialogProps {
  readonly open: boolean;
  /** The kinds the field that opened the dialog accepts: the first one is suggested and the person can pick among these only. */
  readonly kinds: readonly PartyKind[];
  /** Esc, `x`, "Anuluj"; what was typed stays in the memory of the tab unless `discard` is set. */
  readonly onClose: (discard: boolean) => void;
  readonly onCreated: (party: PickedParty) => void;
  /** The title when the dialog is a view of another one ("Edytuj lokalizację › Dodaj stronę"); default "Dodaj stronę". */
  readonly title?: string;
  /** The name of the button that leaves without saving ("Wróć do lokalizacji"); default "Anuluj". */
  readonly cancelLabel?: string;
}

/**
 * Dialog "Dodaj stronę" (EVM-021 AC4; W-05): the kind (suggested by the field it was opened from), the form (a company or institution,
 * or a natural person), the name, an optional contact person, phone, e-mail and notes with the warning about what not to write.
 * The first save names the party (`id`, UUIDv7) and the request (`Idempotency-Key`); a retry of the same content after a network error
 * sends the same pair, so no duplicate appears. What is typed lives in this component only — not in the address, the storage of the
 * browser or a log; offline and after a failed save it stays.
 */
export function AddPartyDialog({ open, kinds, onClose, onCreated, title, cancelLabel }: AddPartyDialogProps) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const [form, setForm] = useState<PartyForm>(() => emptyPartyForm(kinds[0] ?? 'other'));
  const [errors, setErrors] = useState<PartyFieldErrors>({});
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const formId = useId();
  const attempt = useAttempt();
  const fields = useRef<Partial<Record<PartyFieldName, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  const alert = useRef<HTMLDivElement>(null);

  const mutation = useMutation({
    mutationFn: (request: { readonly body: ReturnType<typeof buildPartyBody>; readonly key: string }) =>
      unwrap(createParty({ client, body: request.body, headers: { 'Idempotency-Key': request.key } })),
  });

  // After a failed save the focus goes to the first invalid field, or to the message when no field is to blame (§ 4.1).
  useEffect(() => {
    if (focusRequest === 0) return;
    const invalid = firstInvalidParty(errors);
    if (invalid !== undefined) fields.current[invalid]?.focus();
    else if (failure !== null) alert.current?.focus();
    // Only the request matters here: it is bumped together with the errors and the failure it concerns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  const change = (field: PartyFieldName, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) =>
      current[field] === undefined ? current : Object.fromEntries(Object.entries(current).filter(([name]) => name !== field)),
    );
  };

  const reset = () => {
    setForm(emptyPartyForm(kinds[0] ?? 'other'));
    setErrors({});
    setFailure(null);
    attempt.forget();
    mutation.reset();
  };

  const submit = () => {
    const missing = missingPartyFields(form);
    if (missing.length > 0) {
      setErrors(Object.fromEntries(missing.map((field) => [field, t('formErrors.required')])));
      setFailure(null);
      setFocusRequest((current) => current + 1);
      return;
    }
    const { id, key } = attempt.next(partyFingerprint(buildPartyBody(form, '')));
    setErrors({});
    setFailure(null);
    mutation.mutate(
      { body: buildPartyBody(form, id), key },
      {
        onSuccess: (party) => {
          reset();
          onCreated({ id: party.id, kind: party.kind, legalForm: party.legalForm, displayName: party.displayName });
        },
        onError: (error) => {
          const mapped: PartyFieldErrors = {};
          if (error instanceof ApiError && error.status === 400) {
            for (const entry of error.errors) {
              const field = partyFieldOf(entry);
              if (field !== undefined && mapped[field] === undefined) mapped[field] = fieldErrorText(t, field, entry.code);
            }
          }
          if (refusesAttempt(error)) attempt.forget();
          setErrors(mapped);
          setFailure(describeFailure(error, Object.keys(mapped).length > 0));
          setFocusRequest((current) => current + 1);
        },
      },
    );
  };

  const text = (field: PartyFieldName, label: string, extra: { type?: 'email' | 'tel' } = {}) => (
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
    />
  );

  const failureText = (current: SaveFailure): string => {
    switch (current.kind) {
      case 'fields':
        return t('parties.failure.fields');
      case 'network':
        return t('parties.failure.network');
      case 'inProgress':
        return t('parties.failure.inProgress');
      case 'forbidden':
        return t('parties.failure.forbidden');
      case 'rate':
        return t('parties.failure.rateLimited', { seconds: current.seconds });
      case 'server':
        return t('parties.failure.server', { code: current.code });
    }
  };

  return (
    <Dialog
      open={open}
      title={title ?? t('parties.dialog.title')}
      closeLabel={t('parties.dialog.close')}
      onDismiss={() => {
        onClose(false);
      }}
      actions={
        <>
          <Button
            variant="tertiary"
            onClick={() => {
              reset();
              onClose(true);
            }}
          >
            {cancelLabel ?? t('parties.dialog.cancel')}
          </Button>
          <Button type="submit" form={formId} loading={mutation.isPending} disabled={!online}>
            {t('parties.dialog.submit')}
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
        {online ? null : <Banner icon={WifiOff}>{t('parties.dialog.offline')}</Banner>}
        {failure === null ? null : (
          <InlineAlert tone="error" alertRef={alert}>
            {failureText(failure)}
          </InlineAlert>
        )}
        <Select
          label={t('parties.dialog.kind')}
          value={form.kind}
          options={kinds.map((kind) => ({ value: kind, label: partyKindLabels[kind] }))}
          onChange={(kind) => {
            const chosen = kinds.find((candidate) => candidate === kind);
            if (chosen !== undefined) setForm((current) => ({ ...current, kind: chosen }));
          }}
        />
        <RadioGroup
          legend={t('parties.dialog.legalForm')}
          value={form.legalForm}
          onChange={(legalForm) => {
            setForm((current) => ({ ...current, legalForm: legalForm === 'natural_person' ? 'natural_person' : 'organization' }));
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
        />
      </form>
    </Dialog>
  );
}

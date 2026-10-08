import { updateCustomer, type Customer } from '@evia/contracts';
import { Banner, Button, Dialog, Disclosure, InlineAlert, RadioGroup, TextArea, TextField, WifiOff } from '@evia/ui-web';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { useAttempt } from '../forms/attempt.ts';
import { describeFailure, refusesAttempt, type SaveFailure } from '../forms/save-failure.ts';
import { useOnline } from '../shell/use-online.ts';
import {
  addressStarted,
  buildPatch,
  changedFields,
  currentText,
  fieldOf,
  firstInvalid,
  formOf,
  missingFields,
  type CustomerForm,
  type FieldErrors,
  type FieldName,
} from './customer-form.ts';
import { errorText } from './field-errors.ts';

const ADDRESS_FIELDS: readonly FieldName[] = ['street', 'buildingNumber', 'apartmentNumber', 'postalCode', 'city'];

type Failure = SaveFailure | { readonly kind: 'conflict' };

export interface EditCustomerDialogProps {
  /** The customer as the page holds it: the dialog is filled with it and the first save asks for its version (`If-Match`). */
  readonly customer: Customer;
  /** Reads the customer again (after a `412`); `undefined` when it could not be read. */
  readonly refresh: () => Promise<Customer | undefined>;
  /** Closing: a saved customer, or `undefined` when nothing was saved. */
  readonly onClose: (saved?: Customer) => void;
  /** The customer is gone (`404`): the page shows "Nie znaleziono klienta". */
  readonly onGone: () => void;
}

const etagOf = (version: number): string => `"${String(version)}"`;

/**
 * Dialog "Edytuj dane klienta" (EVM-039 AC3, AC4; W-14): the fields of "Dodaj klienta" filled with the customer, validation as
 * on creation (the server's — `400` points at the fields), the save is a merge-patch of the touched fields with `If-Match` of
 * the version on screen and an `Idempotency-Key` per attempt. On `412` the typed data stays, the customer is read again and
 * "Aktualnie: …" (plain text) appears under every touched field whose value differs; the next save asks for the new version.
 * "Odrzucić zmiany?" asks before a dismissal drops typed data. What is typed lives in this component only (SR-WEB-05).
 * The dialog is mounted while it is open, so each opening starts from the customer on the page.
 */
export function EditCustomerDialog({ customer, refresh, onClose, onGone }: EditCustomerDialogProps) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  // The form the dialog was opened with stays the reference of "what was touched", also after a refresh of the customer.
  const [initial] = useState(() => formOf(customer));
  const [form, setForm] = useState<CustomerForm>(initial);
  const [version, setVersion] = useState(customer.version);
  const [latest, setLatest] = useState<Customer | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [addressOpen, setAddressOpen] = useState(addressStarted(formOf(customer)));
  const [asking, setAsking] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const formId = useId();
  const attempt = useAttempt();
  const fields = useRef<Partial<Record<FieldName, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  const alert = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLButtonElement>(null);

  const mutation = useMutation({
    mutationFn: (request: { readonly body: ReturnType<typeof buildPatch>; readonly key: string; readonly version: number }) =>
      unwrap(
        updateCustomer({
          client,
          path: { customerId: customer.id },
          body: request.body,
          headers: { 'If-Match': etagOf(request.version), 'Idempotency-Key': request.key },
        }),
      ),
  });

  const touched = changedFields(initial, form);
  const dirty = touched.length > 0 || form.kind !== initial.kind;
  // The fields the person changed and somebody else changed too: their value now is shown under the field.
  const conflicts: FieldName[] = latest === null ? [] : touched.filter((field) => currentText(latest, field) !== form[field].trim());

  // After a failed save the focus goes to the first invalid field, or after a conflict to the first field with "Aktualnie: …",
  // or to the message; only a new attempt asks for it — fixing one field must not pull the focus to another.
  useEffect(() => {
    if (focusRequest === 0) return;
    const invalid = firstInvalid(errors);
    const target = invalid ?? conflicts[0];
    if (target !== undefined) fields.current[target]?.focus();
    else if (failure !== null) alert.current?.focus();
    // Only the request matters here: it is bumped together with the errors and the failure it concerns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  // "Odrzucić zmiany?" replaces the form in the same dialog: the focus follows it (WCAG 2.4.3).
  const askedBefore = useRef(false);
  useEffect(() => {
    if (asking) {
      askedBefore.current = true;
      back.current?.focus();
    } else if (askedBefore.current) (fields.current.firstName ?? fields.current.companyName)?.focus();
  }, [asking]);

  const change = (field: FieldName, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) =>
      current[field] === undefined ? current : Object.fromEntries(Object.entries(current).filter(([name]) => name !== field)),
    );
  };

  const dismiss = () => {
    if (dirty && !mutation.isPending) setAsking(true);
    else onClose();
  };

  const submit = () => {
    const missing = missingFields(form);
    if (missing.length > 0) {
      setErrors(Object.fromEntries(missing.map((field) => [field, t('customers.errors.required')])));
      setFailure(null);
      if (missing.some((field) => ADDRESS_FIELDS.includes(field))) setAddressOpen(true);
      setFocusRequest((current) => current + 1);
      return;
    }
    const body = buildPatch(initial, form);
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
            onGone();
            return;
          }
          if (error instanceof ApiError && error.status === 412) {
            setFailure({ kind: 'conflict' });
            setErrors({});
            // The answer carries no values: the customer is read again and the fresh version is used by the next save.
            void refresh().then((fresh) => {
              if (fresh !== undefined) {
                setLatest(fresh);
                setVersion(fresh.version);
              }
              setFocusRequest((current) => current + 1);
            });
            return;
          }
          const mapped: FieldErrors = {};
          if (error instanceof ApiError && error.status === 400) {
            for (const entry of error.errors) {
              const field = fieldOf(entry);
              if (field !== undefined && mapped[field] === undefined) mapped[field] = errorText(t, field, entry.code);
            }
          }
          if (Object.keys(mapped).some((field) => ADDRESS_FIELDS.includes(field as FieldName))) setAddressOpen(true);
          setErrors(mapped);
          setFailure(describeFailure(error, Object.keys(mapped).length > 0));
          setFocusRequest((current) => current + 1);
        },
      },
    );
  };

  const failureText = (current: Failure): string => {
    switch (current.kind) {
      case 'conflict':
        return t('customerEdit.conflict');
      case 'fields':
        return t('customers.failure.fields');
      case 'network':
        return t('customerEdit.failure.network');
      case 'inProgress':
        return t('customers.failure.inProgress');
      case 'forbidden':
        return t('customerEdit.failure.forbidden');
      case 'rate':
        return t('customers.failure.rateLimited', { seconds: current.seconds });
      case 'server':
        return t('customerEdit.failure.server', { code: current.code });
    }
  };

  /** A field with "Aktualnie: …" under it when somebody else changed it while the dialog was open (plain text, SR-WEB-03). */
  const withCurrent = (field: FieldName, control: ReactNode) => {
    if (!conflicts.includes(field) || latest === null) return control;
    const now = currentText(latest, field);
    return (
      <div className="flex flex-col gap-stack-xs">
        {control}
        <p className="text-body-sm text-text-secondary">
          {now === '' ? t('customerEdit.currentNone') : t('customerEdit.current', { value: now })}
        </p>
      </div>
    );
  };

  const text = (field: FieldName, label: string, extra: { type?: 'email' | 'tel' } = {}) =>
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

  if (asking) {
    return (
      <Dialog
        open
        title={t('customerEdit.discard.title')}
        closeLabel={t('customers.dialog.close')}
        onDismiss={() => {
          setAsking(false);
        }}
        actions={
          <>
            <Button
              variant="tertiary"
              onClick={() => {
                onClose();
              }}
            >
              {t('customerEdit.discard.confirm')}
            </Button>
            <Button
              ref={back}
              onClick={() => {
                setAsking(false);
              }}
            >
              {t('customerEdit.discard.back')}
            </Button>
          </>
        }
      >
        <p>{t('customerEdit.discard.description')}</p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      title={t('customerEdit.title')}
      closeLabel={t('customers.dialog.close')}
      onDismiss={dismiss}
      actions={
        <>
          <Button variant="tertiary" onClick={dismiss}>
            {t('customers.dialog.cancel')}
          </Button>
          <Button type="submit" form={formId} loading={mutation.isPending} disabled={!online}>
            {t('customerEdit.submit')}
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
        <p className="break-words text-body text-text-secondary">{customer.displayName}</p>
        {online ? null : <Banner icon={WifiOff}>{t('customerEdit.offline')}</Banner>}
        {failure === null ? null : (
          <InlineAlert tone="error" alertRef={alert}>
            {failureText(failure)}
          </InlineAlert>
        )}
        <RadioGroup
          legend={t('customers.dialog.kind')}
          value={form.kind}
          onChange={(kind) => {
            setForm((current) => ({ ...current, kind: kind === 'company' ? 'company' : 'person' }));
            setErrors({});
          }}
          options={[
            { value: 'person', label: t('customers.dialog.person') },
            { value: 'company', label: t('customers.dialog.company') },
          ]}
        />
        {form.kind === initial.kind ? null : <p className="text-body-sm text-text-secondary">{t('customerEdit.kindHint')}</p>}
        {form.kind === 'person' ? (
          <div className="grid grid-cols-1 gap-inline-md medium:grid-cols-2">
            {text('firstName', t('customers.dialog.firstName'))}
            {text('lastName', t('customers.dialog.lastName'))}
          </div>
        ) : (
          <>
            {text('companyName', t('customers.dialog.companyName'))}
            <div className="grid grid-cols-1 gap-inline-md medium:grid-cols-2">
              {text('taxId', t('customers.dialog.taxId'))}
              {text('contactPersonName', t('customers.dialog.contactPerson'))}
            </div>
          </>
        )}
        <div className="grid grid-cols-1 gap-inline-md medium:grid-cols-2">
          {text('phone', t('customers.dialog.phone'), { type: 'tel' })}
          {text('email', t('customers.dialog.email'), { type: 'email' })}
        </div>
        <Disclosure
          title={t('customers.dialog.address')}
          summary={addressStarted(form) ? undefined : t('customers.dialog.addressSummary')}
          expanded={addressOpen}
          onExpandedChange={setAddressOpen}
        >
          <div className="grid grid-cols-1 gap-inline-md medium:grid-cols-2">
            {text('street', t('customers.dialog.street'))}
            {text('buildingNumber', t('customers.dialog.buildingNumber'))}
            {text('apartmentNumber', t('customers.dialog.apartmentNumber'))}
            {text('postalCode', t('customers.dialog.postalCode'))}
            {text('city', t('customers.dialog.city'))}
          </div>
        </Disclosure>
        {withCurrent(
          'notes',
          <TextArea
            label={t('customers.dialog.notes')}
            value={form.notes}
            hint={t('customers.dialog.notesHint')}
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
  );
}

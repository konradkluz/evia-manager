import { createCustomer, type CustomerSearchItem } from '@evia/contracts';
import { Banner, Button, Dialog, Disclosure, InlineAlert, RadioGroup, TextArea, TextField, WifiOff } from '@evia/ui-web';
import { useMutation } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { useOnline } from '../shell/use-online.ts';
import {
  addressStarted,
  buildBody,
  EMPTY_FORM,
  fieldOf,
  fingerprint,
  firstInvalid,
  missingFields,
  type CustomerForm,
  type FieldErrors,
  type FieldName,
} from './customer-form.ts';
import type { PickedCustomer } from './customer-picker.tsx';
import { formatPhone } from './format.ts';
import { useCustomerSearch } from './use-customer-search.ts';
import { uuidv7 } from './uuid.ts';

/** How many "Podobny klient" hints are shown at most (AC3). */
const SIMILAR_MAX = 3;
const PHONE_LIKE = /^[+\d\s()-]+$/;
/** Fewer digits than this is not "the same phone" yet; the API asks for 3 characters at least. */
const PHONE_MIN_DIGITS = 7;

type Failure =
  | { readonly kind: 'fields' | 'network' | 'inProgress' | 'forbidden' }
  | { readonly kind: 'rate'; readonly seconds: number }
  | { readonly kind: 'server'; readonly code: string };

/** The text under a field for a code of the server (never the value — the API sends none, SR-ERR-02). */
function errorText(t: TFunction, field: FieldName, code: string): string {
  switch (code) {
    case 'required':
      return t('customers.errors.required');
    case 'too_long':
      return t('customers.errors.tooLong');
    case 'invalid_characters':
      return t('customers.errors.invalidCharacters');
    case 'invalid_format':
      switch (field) {
        case 'phone':
          return t('customers.errors.phone');
        case 'email':
          return t('customers.errors.email');
        case 'taxId':
          return t('customers.errors.taxId');
        case 'postalCode':
          return t('customers.errors.postalCode');
        default:
          return t('customers.errors.invalid');
      }
    default:
      return t('customers.errors.invalid');
  }
}

function describe(error: unknown, errors: FieldErrors): Failure {
  if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) return { kind: 'network' };
  if (error.status === 400 && Object.keys(errors).length > 0) return { kind: 'fields' };
  if (error.status === 403) return { kind: 'forbidden' };
  if (error.status === 409 && error.code === 'idempotency_in_progress') return { kind: 'inProgress' };
  if (error.status === 429) return { kind: 'rate', seconds: error.retryAfterSeconds ?? 60 };
  // A refused identifier or key (`id_conflict`, `idempotency_mismatch`) is repaired by a fresh attempt on the next try.
  if (error.code === 'id_conflict' || error.code === 'idempotency_mismatch') return { kind: 'network' };
  return { kind: 'server', code: error.traceId?.slice(0, 8) ?? error.code };
}

const digitsOf = (text: string): number => text.replaceAll(/\D/g, '').length;

export interface AddCustomerDialogProps {
  readonly open: boolean;
  /** Esc, `x`, "Anuluj" and a saved customer; what was typed stays in the memory of the tab unless `discard` is set. */
  readonly onClose: (discard: boolean) => void;
  readonly onCreated: (customer: PickedCustomer) => void;
  /** "Wybierz tego klienta" in the hint "Podobny klient". */
  readonly onPick: (customer: PickedCustomer) => void;
}

/**
 * Dialog "Dodaj klienta" (EVM-020 AC2–AC4, AC8; W-05): person or company, phone, e-mail, an optional postal address and notes.
 * The server normalises the phone to E.164 and the e-mail to lower case, the panel does not. The first save names the customer
 * (`id`, UUIDv7) and the request (`Idempotency-Key`); a retry of the same content after a network error sends the same pair, so
 * no duplicate appears; changed content is a new request. "Podobny klient" comes from the same search as the combobox.
 * What is typed lives in this component only — not in the address, the storage of the browser or a log.
 */
export function AddCustomerDialog({ open, onClose, onCreated, onPick }: AddCustomerDialogProps) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [addressOpen, setAddressOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const formId = useId();
  const attempt = useRef<{ readonly content: string; readonly id: string; readonly key: string } | null>(null);
  const fields = useRef<Partial<Record<FieldName, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  const alert = useRef<HTMLDivElement>(null);

  const mutation = useMutation({
    mutationFn: (request: { readonly body: ReturnType<typeof buildBody>; readonly key: string }) =>
      unwrap(createCustomer({ client, body: request.body, headers: { 'Idempotency-Key': request.key } })),
  });

  const phoneText = PHONE_LIKE.test(form.phone.trim()) && digitsOf(form.phone) >= PHONE_MIN_DIGITS ? form.phone : '';
  const nameText = form.kind === 'person' ? form.lastName : form.companyName;
  const byPhone = useCustomerSearch(phoneText, open);
  const byName = useCustomerSearch(nameText, open);
  const similar: CustomerSearchItem[] = [];
  for (const item of [...(byPhone.items ?? []), ...(byName.items ?? [])]) {
    if (similar.length < SIMILAR_MAX && !similar.some((known) => known.id === item.id)) similar.push(item);
  }

  // After a failed save the focus goes to the first invalid field, or to the message when no field is to blame (§ 4.1);
  // only a new attempt asks for it — fixing one field must not pull the focus to another.
  useEffect(() => {
    if (focusRequest === 0) return;
    const invalid = firstInvalid(errors);
    if (invalid !== undefined) fields.current[invalid]?.focus();
    else if (failure !== null) alert.current?.focus();
    // Only the request matters here: it is bumped together with the errors and the failure it concerns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  const change = (field: FieldName, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) =>
      current[field] === undefined ? current : Object.fromEntries(Object.entries(current).filter(([name]) => name !== field)),
    );
  };

  const reset = () => {
    setForm(EMPTY_FORM);
    setErrors({});
    setFailure(null);
    setAddressOpen(false);
    attempt.current = null;
    mutation.reset();
  };

  const submit = () => {
    const missing = missingFields(form);
    if (missing.length > 0) {
      setErrors(Object.fromEntries(missing.map((field) => [field, t('customers.errors.required')])));
      setFailure(null);
      if (missing.some((field) => ['street', 'buildingNumber', 'postalCode', 'city'].includes(field))) setAddressOpen(true);
      setFocusRequest((current) => current + 1);
      return;
    }
    const content = fingerprint(buildBody(form, ''));
    if (attempt.current?.content !== content) attempt.current = { content, id: uuidv7(), key: uuidv7() };
    const { id, key } = attempt.current;
    setErrors({});
    setFailure(null);
    mutation.mutate(
      { body: buildBody(form, id), key },
      {
        onSuccess: (customer) => {
          reset();
          onCreated({ id: customer.id, displayName: customer.displayName, phone: customer.phone });
        },
        onError: (error) => {
          const mapped: FieldErrors = {};
          if (error instanceof ApiError && error.status === 400) {
            for (const entry of error.errors) {
              const field = fieldOf(entry);
              if (field !== undefined && mapped[field] === undefined) mapped[field] = errorText(t, field, entry.code);
            }
          }
          if (Object.keys(mapped).some((field) => ['street', 'buildingNumber', 'postalCode', 'city', 'apartmentNumber'].includes(field))) {
            setAddressOpen(true);
          }
          if (error instanceof ApiError && (error.code === 'id_conflict' || error.code === 'idempotency_mismatch')) attempt.current = null;
          setErrors(mapped);
          setFailure(describe(error, mapped));
          setFocusRequest((current) => current + 1);
        },
      },
    );
  };

  const text = (field: FieldName, label: string, extra: { type?: 'email' | 'tel'; autoComplete?: string } = {}) => (
    <TextField
      label={label}
      value={form[field]}
      type={extra.type ?? 'text'}
      autoComplete={extra.autoComplete ?? 'off'}
      error={errors[field]}
      inputRef={(element) => {
        fields.current[field] = element;
      }}
      onChange={(event) => {
        change(field, event.target.value);
      }}
    />
  );

  const failureText = (current: Failure): string => {
    switch (current.kind) {
      case 'fields':
        return t('customers.failure.fields');
      case 'network':
        return t('customers.failure.network');
      case 'inProgress':
        return t('customers.failure.inProgress');
      case 'forbidden':
        return t('customers.failure.forbidden');
      case 'rate':
        return t('customers.failure.rateLimited', { seconds: current.seconds });
      case 'server':
        return t('customers.failure.server', { code: current.code });
    }
  };

  return (
    <Dialog
      open={open}
      title={t('customers.dialog.title')}
      closeLabel={t('customers.dialog.close')}
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
            {t('customers.dialog.cancel')}
          </Button>
          <Button type="submit" form={formId} loading={mutation.isPending} disabled={!online}>
            {t('customers.dialog.submit')}
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
        {online ? null : <Banner icon={WifiOff}>{t('customers.dialog.offline')}</Banner>}
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
          {text('phone', t('customers.dialog.phone'), { type: 'tel', autoComplete: 'off' })}
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
        />
        <div role="status" className="flex flex-col gap-stack-sm">
          {online
            ? similar.map((item) => (
                <InlineAlert
                  key={item.id}
                  tone="info"
                  action={
                    <Button
                      variant="tertiary"
                      onClick={() => {
                        reset();
                        onPick({ id: item.id, displayName: item.displayName, phone: item.phone });
                      }}
                    >
                      {t('customers.similar.choose')}
                    </Button>
                  }
                >
                  {t('customers.similar.text', { name: item.displayName, phone: formatPhone(item.phone) })}
                </InlineAlert>
              ))
            : null}
        </div>
      </form>
    </Dialog>
  );
}

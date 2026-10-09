import type { Customer, CustomerKind, CustomerPatch, CustomerWritable, FieldError } from '@evia/contracts';
import { formatPhone } from './format.ts';

/** What a person types in the dialog "Dodaj klienta" (text only; the server normalises the phone, e-mail and NIP — AC2). */
export interface CustomerForm {
  readonly kind: CustomerKind;
  readonly firstName: string;
  readonly lastName: string;
  readonly companyName: string;
  readonly taxId: string;
  readonly contactPersonName: string;
  readonly phone: string;
  readonly email: string;
  readonly street: string;
  readonly buildingNumber: string;
  readonly apartmentNumber: string;
  readonly postalCode: string;
  readonly city: string;
  readonly notes: string;
}

export type FieldName = Exclude<keyof CustomerForm, 'kind'>;

export const EMPTY_FORM: CustomerForm = {
  kind: 'person',
  firstName: '',
  lastName: '',
  companyName: '',
  taxId: '',
  contactPersonName: '',
  phone: '',
  email: '',
  street: '',
  buildingNumber: '',
  apartmentNumber: '',
  postalCode: '',
  city: '',
  notes: '',
};

/** Fields of the postal address: all of them but the apartment number are required once any is filled. */
const ADDRESS_FIELDS = ['street', 'buildingNumber', 'apartmentNumber', 'postalCode', 'city'] as const;
const ADDRESS_REQUIRED = ['street', 'buildingNumber', 'postalCode', 'city'] as const;

export type FieldErrors = Partial<Record<FieldName, string>>;

/** The order of the fields in the dialog: the first invalid one gets the focus. */
const FIELD_ORDER: readonly FieldName[] = [
  'firstName',
  'lastName',
  'companyName',
  'taxId',
  'contactPersonName',
  'phone',
  'email',
  'street',
  'buildingNumber',
  'apartmentNumber',
  'postalCode',
  'city',
  'notes',
];

const filled = (value: string): boolean => value.trim() !== '';

export function addressStarted(form: CustomerForm): boolean {
  return ADDRESS_FIELDS.some((field) => filled(form[field]));
}

/** Fields that must be filled before anything is sent: the name of the kind, the phone and, once started, the address. */
export function missingFields(form: CustomerForm): FieldName[] {
  const missing: FieldName[] = [];
  if (form.kind === 'person') {
    if (!filled(form.firstName)) missing.push('firstName');
    if (!filled(form.lastName)) missing.push('lastName');
  } else if (!filled(form.companyName)) missing.push('companyName');
  if (!filled(form.phone)) missing.push('phone');
  if (addressStarted(form)) for (const field of ADDRESS_REQUIRED) if (!filled(form[field])) missing.push(field);
  return missing;
}

const optional = (value: string): string | undefined => (filled(value) ? value.trim() : undefined);

function present(values: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

/**
 * The body of `createCustomer`: only the fields of the chosen kind and only the filled ones (an emptied field is absent,
 * never an empty text); `postalAddress` only when something of it is typed. The phone goes as typed — the server
 * normalises it to E.164.
 */
export function buildBody(form: CustomerForm, id: string): CustomerWritable {
  const person = form.kind === 'person';
  return {
    id,
    kind: form.kind,
    ...(person ? { firstName: form.firstName.trim(), lastName: form.lastName.trim() } : { companyName: form.companyName.trim() }),
    ...(person ? {} : present({ taxId: optional(form.taxId), contactPersonName: optional(form.contactPersonName) })),
    phone: form.phone.trim(),
    ...present({ email: optional(form.email), notes: optional(form.notes) }),
    ...(addressStarted(form)
      ? {
          postalAddress: {
            street: form.street.trim(),
            buildingNumber: form.buildingNumber.trim(),
            ...present({ apartmentNumber: optional(form.apartmentNumber) }),
            postalCode: form.postalCode.trim(),
            city: form.city.trim(),
          },
        }
      : {}),
  };
}

/** The same content (everything but the identifier) is the same request: a retry of it keeps the `id` and the key. */
export const fingerprint = (body: CustomerWritable): string => JSON.stringify({ ...body, id: undefined });

const POINTERS: Readonly<Record<string, FieldName>> = {
  '/firstName': 'firstName',
  '/lastName': 'lastName',
  '/companyName': 'companyName',
  '/taxId': 'taxId',
  '/contactPersonName': 'contactPersonName',
  '/phone': 'phone',
  '/email': 'email',
  '/postalAddress/street': 'street',
  '/postalAddress/buildingNumber': 'buildingNumber',
  '/postalAddress/apartmentNumber': 'apartmentNumber',
  '/postalAddress/postalCode': 'postalCode',
  '/postalAddress/city': 'city',
  '/notes': 'notes',
};

/** The field an error of the server points at (`undefined` for a pointer the dialog has no field for). */
export const fieldOf = (error: FieldError): FieldName | undefined => POINTERS[error.pointer];

/** The first field in the dialog's order that has an error. */
export function firstInvalid(errors: FieldErrors): FieldName | undefined {
  return FIELD_ORDER.find((field) => errors[field] !== undefined);
}

/**
 * The form of the dialog "Edytuj dane klienta" filled with the customer as the API sent it (EVM-039 AC3). The phone is shown
 * as `+48 600 000 001` (§ 6.3); the server normalises it again, so a phone that was not touched is never sent.
 */
export function formOf(customer: Customer): CustomerForm {
  const address = customer.postalAddress;
  return {
    kind: customer.kind,
    firstName: customer.firstName ?? '',
    lastName: customer.lastName ?? '',
    companyName: customer.companyName ?? '',
    taxId: customer.taxId ?? '',
    contactPersonName: customer.contactPersonName ?? '',
    phone: formatPhone(customer.phone),
    email: customer.email ?? '',
    street: address?.street ?? '',
    buildingNumber: address?.buildingNumber ?? '',
    apartmentNumber: address?.apartmentNumber ?? '',
    postalCode: address?.postalCode ?? '',
    city: address?.city ?? '',
    notes: customer.notes ?? '',
  };
}

const NAME_FIELDS: Readonly<Record<CustomerKind, readonly FieldName[]>> = {
  person: ['firstName', 'lastName'],
  company: ['companyName'],
};
const COMPANY_ONLY: readonly FieldName[] = ['taxId', 'contactPersonName'];
const clean = (value: string): string => value.trim();

/** The fields whose text differs from the one the dialog was opened with (what the person has touched). */
export function changedFields(initial: CustomerForm, form: CustomerForm): FieldName[] {
  return FIELD_ORDER.filter((field) => clean(form[field]) !== clean(initial[field]));
}

/**
 * The merge-patch of `updateCustomer` (EVM-039 AC3, AC4): only what the person changed. An emptied optional field is `null`
 * (it is cleared), the address goes whole or as `null`, and a change of the kind names the fields of the new kind. Fields
 * of the server (`id`, `displayName`, `version`, …) are never sent.
 */
export function buildPatch(initial: CustomerForm, form: CustomerForm): CustomerPatch {
  const changed = new Set(changedFields(initial, form));
  const kindChanged = form.kind !== initial.kind;
  const patch: Record<string, unknown> = {};
  if (kindChanged) patch['kind'] = form.kind;
  for (const field of NAME_FIELDS[form.kind]) if (kindChanged || changed.has(field)) patch[field] = clean(form[field]);
  if (form.kind === 'company') {
    for (const field of COMPANY_ONLY) if (changed.has(field)) patch[field] = optional(form[field]) ?? null;
  }
  if (changed.has('phone')) patch['phone'] = clean(form.phone);
  if (changed.has('email')) patch['email'] = optional(form.email) ?? null;
  if (changed.has('notes')) patch['notes'] = optional(form.notes) ?? null;
  if (ADDRESS_FIELDS.some((field) => changed.has(field))) {
    patch['postalAddress'] = addressStarted(form)
      ? {
          street: clean(form.street),
          buildingNumber: clean(form.buildingNumber),
          ...present({ apartmentNumber: optional(form.apartmentNumber) }),
          postalCode: clean(form.postalCode),
          city: clean(form.city),
        }
      : null;
  }
  return patch;
}

/** The text of a field of the customer as the API holds it now — shown as "Aktualnie: …" after a `412` (plain text). */
export function currentText(customer: Customer, field: FieldName): string {
  return clean(formOf(customer)[field]);
}

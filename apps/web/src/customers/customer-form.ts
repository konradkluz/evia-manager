import type { CustomerKind, CustomerWritable, FieldError } from '@evia/contracts';

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

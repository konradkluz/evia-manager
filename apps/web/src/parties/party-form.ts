import type { FieldError, PartyKind, PartyLegalForm, PartyWritable } from '@evia/contracts';

/** The kinds of party each field of a site accepts (domain-model.md → Site; the API refuses any other: AC3). */
export const OSD_KINDS: readonly PartyKind[] = ['distribution_system_operator'];
export const MANAGER_KINDS: readonly PartyKind[] = ['building_administration', 'property_manager', 'housing_community'];

/** What a person types in the dialog "Dodaj stronę" (text only; the server normalises the phone and the e-mail). */
export interface PartyForm {
  readonly kind: PartyKind;
  readonly legalForm: PartyLegalForm;
  readonly displayName: string;
  readonly contactPersonName: string;
  readonly phone: string;
  readonly email: string;
  readonly notes: string;
}

export type PartyFieldName = Exclude<keyof PartyForm, 'kind' | 'legalForm'>;
export type PartyFieldErrors = Partial<Record<PartyFieldName, string>>;

export const emptyPartyForm = (kind: PartyKind): PartyForm => ({
  kind,
  legalForm: 'organization',
  displayName: '',
  contactPersonName: '',
  phone: '',
  email: '',
  notes: '',
});

const filled = (value: string): boolean => value.trim() !== '';

/** The only required field is the name; phone, e-mail, the contact person and notes are optional (AC4). */
export function missingPartyFields(form: PartyForm): PartyFieldName[] {
  return filled(form.displayName) ? [] : ['displayName'];
}

/** The body of `createParty`: the filled fields only (an emptied field is absent, never an empty text). */
export function buildPartyBody(form: PartyForm, id: string): PartyWritable {
  const optional = (value: string) => (filled(value) ? value.trim() : undefined);
  const contactPersonName = optional(form.contactPersonName);
  const phone = optional(form.phone);
  const email = optional(form.email);
  const notes = optional(form.notes);
  return {
    id,
    kind: form.kind,
    legalForm: form.legalForm,
    displayName: form.displayName.trim(),
    ...(contactPersonName === undefined ? {} : { contactPersonName }),
    ...(phone === undefined ? {} : { phone }),
    ...(email === undefined ? {} : { email }),
    ...(notes === undefined ? {} : { notes }),
  };
}

/** The same content (everything but the identifier) is the same request: a retry of it keeps the `id` and the key. */
export const partyFingerprint = (body: PartyWritable): string => JSON.stringify({ ...body, id: undefined });

const POINTERS: Readonly<Record<string, PartyFieldName>> = {
  '/displayName': 'displayName',
  '/contactPersonName': 'contactPersonName',
  '/phone': 'phone',
  '/email': 'email',
  '/notes': 'notes',
};

/** The field an error of the server points at (`undefined` for a pointer the dialog has no field for). */
export const partyFieldOf = (error: FieldError): PartyFieldName | undefined => POINTERS[error.pointer];

const ORDER: readonly PartyFieldName[] = ['displayName', 'contactPersonName', 'phone', 'email', 'notes'];

/** The first field in the dialog's order that has an error. */
export const firstInvalidParty = (errors: PartyFieldErrors): PartyFieldName | undefined =>
  ORDER.find((field) => errors[field] !== undefined);

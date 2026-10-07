/**
 * A new customer (EVM-020 AC2, AC5; SR-INPUT-01, SR-INPUT-05, SR-DATA-02): the rules the schema of the contract cannot state —
 * which fields belong to which `kind`, the normal form of the telephone, the e-mail and the NIP, plain text. The result is
 * either the normalised customer or the list of field errors: a JSON Pointer and a code, NEVER the value (SR-ERR-02). The
 * pointers and the codes are the vocabulary of `errors[]` of the contract.
 */
import { normalizeEmail } from '../../../platform/input/email.ts';
import { Collector, type FieldIssue } from '../../../platform/input/field-issues.ts';
import { normalizePhone } from '../../../platform/input/phone.ts';
import { normalizeTaxId } from './tax-id.ts';

export type CustomerKind = 'person' | 'company';

export interface PostalAddressInput {
  readonly street: string;
  readonly buildingNumber: string;
  readonly apartmentNumber?: string | undefined;
  readonly postalCode: string;
  readonly city: string;
}

/** The input after the schema of the contract (types and bounds are checked; the rules below are not). */
export interface CustomerInput {
  readonly id: string;
  readonly kind: CustomerKind;
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
  readonly companyName?: string | undefined;
  readonly taxId?: string | undefined;
  readonly contactPersonName?: string | undefined;
  readonly phone: string;
  readonly email?: string | undefined;
  readonly postalAddress?: PostalAddressInput | undefined;
  readonly notes?: string | undefined;
}

export interface NewCustomer {
  readonly id: string;
  readonly kind: CustomerKind;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly companyName: string | null;
  readonly taxId: string | null;
  readonly contactPersonName: string | null;
  readonly phone: string;
  readonly email: string | null;
  readonly address: {
    readonly street: string;
    readonly buildingNumber: string;
    readonly apartmentNumber: string | null;
    readonly postalCode: string;
    readonly city: string;
  } | null;
  readonly notes: string | null;
}

export type NewCustomerResult =
  { readonly ok: true; readonly customer: NewCustomer } | { readonly ok: false; readonly errors: readonly FieldIssue[] };

const NAME = { maxLength: 200 } as const;

export function normalizeNewCustomer(input: CustomerInput): NewCustomerResult {
  const issues = new Collector();
  const person = input.kind === 'person';

  const firstName = person ? issues.required('/firstName', input.firstName, NAME) : forbidden(issues, '/firstName', input.firstName);
  const lastName = person ? issues.required('/lastName', input.lastName, NAME) : forbidden(issues, '/lastName', input.lastName);
  const companyName = person
    ? forbidden(issues, '/companyName', input.companyName)
    : issues.required('/companyName', input.companyName, NAME);
  const taxId = person ? forbidden(issues, '/taxId', input.taxId) : normalizedTaxId(issues, input.taxId);
  const contactPersonName = person
    ? forbidden(issues, '/contactPersonName', input.contactPersonName)
    : issues.text('/contactPersonName', input.contactPersonName, NAME);

  const phone = normalizePhone(input.phone);
  if (phone === undefined) issues.fail('/phone', 'invalid_format');
  const email = issues.shaped('/email', input.email, normalizeEmail);
  const address = normalizedAddress(issues, input.postalAddress);
  const notes = issues.text('/notes', input.notes, { maxLength: 2000, multiline: true });

  if (issues.errors.length > 0 || phone === undefined) return { ok: false, errors: issues.errors };
  return {
    ok: true,
    customer: { id: input.id, kind: input.kind, firstName, lastName, companyName, taxId, contactPersonName, phone, email, address, notes },
  };
}

/** A field of the other kind must be absent (an empty text counts as absent). */
function forbidden(issues: Collector, pointer: string, raw: string | undefined): null {
  if (raw !== undefined && raw.trim() !== '') issues.fail(pointer, 'not_allowed_for_kind');
  return null;
}

function normalizedTaxId(issues: Collector, raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === '') return null;
  const taxId = normalizeTaxId(raw);
  if (taxId === undefined) issues.fail('/taxId', 'invalid_format');
  return taxId ?? null;
}

function normalizedAddress(issues: Collector, address: PostalAddressInput | undefined): NewCustomer['address'] {
  if (address === undefined) return null;
  const street = issues.required('/postalAddress/street', address.street, NAME);
  const buildingNumber = issues.required('/postalAddress/buildingNumber', address.buildingNumber, { maxLength: 20 });
  const apartmentNumber = issues.text('/postalAddress/apartmentNumber', address.apartmentNumber, { maxLength: 20 });
  const postalCode = address.postalCode.normalize('NFC').trim();
  if (!/^\d{2}-\d{3}$/.test(postalCode)) issues.fail('/postalAddress/postalCode', 'invalid_format');
  const city = issues.required('/postalAddress/city', address.city, { maxLength: 100 });
  if (street === null || buildingNumber === null || city === null) return null;
  return { street, buildingNumber, apartmentNumber, postalCode, city };
}

/**
 * The edit of a customer as a merge-patch (EVM-039 AC3, AC4; SR-INPUT-01, SR-INPUT-05): the stored customer plus the fields the patch
 * names — a field absent stays, a field of `null` is cleared (only the optional ones can be: the schema of the contract refuses `null`
 * elsewhere), any other value replaces it. The merged input then goes through the SAME `normalizeNewCustomer` as the creation, so the
 * rules cannot drift apart (telephone E.164, NIP with its checksum, e-mail, plain text, the fields that belong to the kind).
 *
 * A change of `kind` does not carry over the fields of the previous one (the hint of the mock-up): "Anna Nowak" turned into a company
 * keeps the telephone, the e-mail, the address and the notes — and needs a company name, which the patch must name.
 */
import type { CustomerInput, CustomerKind, PostalAddressInput } from './customer.ts';

/** The patch after the schema of the contract: `null` clears an optional field, a missing key leaves it. */
export interface CustomerPatchInput {
  readonly kind?: CustomerKind | undefined;
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
  readonly companyName?: string | undefined;
  readonly taxId?: string | null | undefined;
  readonly contactPersonName?: string | null | undefined;
  readonly phone?: string | undefined;
  readonly email?: string | null | undefined;
  readonly postalAddress?: PostalAddressInput | null | undefined;
  readonly notes?: string | null | undefined;
}

const merged = <T>(patched: T | null | undefined, stored: T | undefined): T | undefined =>
  patched === undefined ? stored : (patched ?? undefined);

export function mergeCustomerPatch(stored: CustomerInput, patch: CustomerPatchInput): CustomerInput {
  const kind = patch.kind ?? stored.kind;
  const base: CustomerInput =
    kind === stored.kind
      ? stored
      : { id: stored.id, kind, phone: stored.phone, email: stored.email, postalAddress: stored.postalAddress, notes: stored.notes };
  return {
    id: stored.id,
    kind,
    firstName: merged(patch.firstName, base.firstName),
    lastName: merged(patch.lastName, base.lastName),
    companyName: merged(patch.companyName, base.companyName),
    taxId: merged(patch.taxId, base.taxId),
    contactPersonName: merged(patch.contactPersonName, base.contactPersonName),
    phone: patch.phone ?? stored.phone,
    email: merged(patch.email, base.email),
    postalAddress: merged(patch.postalAddress, base.postalAddress),
    notes: merged(patch.notes, base.notes),
  };
}

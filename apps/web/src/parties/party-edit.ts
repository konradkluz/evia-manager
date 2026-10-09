import type { Party, PartyPatch } from '@evia/contracts';
import { formatPhone } from '../customers/format.ts';
import type { PartyFieldName, PartyForm } from './party-form.ts';

/** The form of a party as the API holds it; the phone is shown as `+48 600 000 001` (§ 6.3), the server normalises it again. */
export function partyFormOf(party: Party): PartyForm {
  return {
    kind: party.kind,
    legalForm: party.legalForm,
    displayName: party.displayName,
    contactPersonName: party.contactPersonName ?? '',
    phone: party.phone === undefined ? '' : formatPhone(party.phone),
    email: party.email ?? '',
    notes: party.notes ?? '',
  };
}

const clean = (value: string): string => value.trim();
const FIELDS: readonly PartyFieldName[] = ['displayName', 'contactPersonName', 'phone', 'email', 'notes'];
const OPTIONAL: readonly PartyFieldName[] = ['contactPersonName', 'phone', 'email', 'notes'];

/** The text fields the person changed since the dialog was opened ("Aktualnie: …" may be shown for them after a conflict). */
export const changedPartyFields = (initial: PartyForm, form: PartyForm): PartyFieldName[] =>
  FIELDS.filter((field) => clean(form[field]) !== clean(initial[field]));

/**
 * The merge-patch of `updateParty` (EVM-036 AC3): only what the person changed; an emptied optional field is `null`. The kind is
 * never sent — it cannot be changed (the API answers `read_only_field`), and fields of the server are never sent either.
 */
export function buildPartyPatch(initial: PartyForm, form: PartyForm): PartyPatch {
  const patch: Record<string, unknown> = {};
  if (form.legalForm !== initial.legalForm) patch['legalForm'] = form.legalForm;
  for (const field of changedPartyFields(initial, form)) {
    patch[field] = OPTIONAL.includes(field) && clean(form[field]) === '' ? null : clean(form[field]);
  }
  return patch;
}

/** The text of a field of the party as the API holds it now — shown as "Aktualnie: …" after a `412` (plain text). */
export const currentPartyText = (party: Party, field: PartyFieldName): string => clean(partyFormOf(party)[field]);

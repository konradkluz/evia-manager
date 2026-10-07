/**
 * A new party (EVM-021 AC3, AC4, AC5; SR-INPUT-01, SR-INPUT-05, SR-DATA-02): the rules the schema of the contract cannot state —
 * the normal form of the telephone and the e-mail, plain text. The result is either the normalised party or the list of field
 * errors: a JSON Pointer and a code, NEVER the value (SR-ERR-02).
 */
import { normalizeEmail } from '../../../platform/input/email.ts';
import { Collector, type FieldIssue } from '../../../platform/input/field-issues.ts';
import { normalizePhone } from '../../../platform/input/phone.ts';

/** The ten values of `PartyKind` (domain-model.md → Party). OSD is a kind, not an entity (D4). */
export const PARTY_KINDS = [
  'building_administration',
  'property_manager',
  'housing_community',
  'designer',
  'fire_safety_expert',
  'technical_expert',
  'distribution_system_operator',
  'subcontractor',
  'supplier',
  'other',
] as const;
export const PARTY_LEGAL_FORMS = ['organization', 'natural_person'] as const;

export type PartyKind = (typeof PARTY_KINDS)[number];
export type PartyLegalForm = (typeof PARTY_LEGAL_FORMS)[number];

/** The input after the schema of the contract (types and bounds are checked; the rules below are not). */
export interface PartyInput {
  readonly id: string;
  readonly kind: PartyKind;
  readonly legalForm: PartyLegalForm;
  readonly displayName: string;
  readonly contactPersonName?: string | undefined;
  readonly phone?: string | undefined;
  readonly email?: string | undefined;
  readonly notes?: string | undefined;
}

export interface NewParty {
  readonly id: string;
  readonly kind: PartyKind;
  readonly legalForm: PartyLegalForm;
  readonly displayName: string;
  readonly contactPersonName: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly notes: string | null;
}

export type NewPartyResult =
  { readonly ok: true; readonly party: NewParty } | { readonly ok: false; readonly errors: readonly FieldIssue[] };

const NAME = { maxLength: 200 } as const;

export function normalizeNewParty(input: PartyInput): NewPartyResult {
  const issues = new Collector();
  const displayName = issues.required('/displayName', input.displayName, NAME);
  const contactPersonName = issues.text('/contactPersonName', input.contactPersonName, NAME);
  const phone = issues.shaped('/phone', input.phone, normalizePhone);
  const email = issues.shaped('/email', input.email, normalizeEmail);
  const notes = issues.text('/notes', input.notes, { maxLength: 2000, multiline: true });

  if (issues.errors.length > 0 || displayName === null) return { ok: false, errors: issues.errors };
  return {
    ok: true,
    party: { id: input.id, kind: input.kind, legalForm: input.legalForm, displayName, contactPersonName, phone, email, notes },
  };
}

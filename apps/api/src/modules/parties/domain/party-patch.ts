/**
 * The edit of a party as a merge-patch (EVM-036 AC3, AC4; SR-INPUT-01, SR-INPUT-05, SR-DATA-02): the stored party plus the fields the
 * patch names — a field absent stays, a field of `null` is cleared (only the optional ones can be), any other value replaces it. The
 * KIND is immutable (the contract has no `kind` in the patch: naming it is `read_only_field`), so the merged input keeps the stored
 * kind and the rule of the kind of the OSD and the manager of a site cannot be broken from here. The merged input goes through the
 * SAME `normalizeNewParty` as the creation (telephone E.164, e-mail, plain text).
 */
import type { PartyInput, PartyLegalForm } from './party.ts';

/** The patch after the schema of the contract: `null` clears an optional field, a missing key leaves it. */
export interface PartyPatchInput {
  readonly legalForm?: PartyLegalForm | undefined;
  readonly displayName?: string | undefined;
  readonly contactPersonName?: string | null | undefined;
  readonly phone?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly notes?: string | null | undefined;
}

const merged = <T>(patched: T | null | undefined, stored: T | undefined): T | undefined =>
  patched === undefined ? stored : (patched ?? undefined);

export function mergePartyPatch(stored: PartyInput, patch: PartyPatchInput): PartyInput {
  return {
    id: stored.id,
    kind: stored.kind,
    legalForm: patch.legalForm ?? stored.legalForm,
    displayName: patch.displayName ?? stored.displayName,
    contactPersonName: merged(patch.contactPersonName, stored.contactPersonName),
    phone: merged(patch.phone, stored.phone),
    email: merged(patch.email, stored.email),
    notes: merged(patch.notes, stored.notes),
  };
}

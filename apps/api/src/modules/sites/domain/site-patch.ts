/**
 * The edit of a site as a merge-patch (EVM-036 AC1, AC2, AC4; SR-INPUT-01, SR-INPUT-02, SR-INPUT-05): the stored site plus the fields
 * the patch names — a field absent stays, a field of `null` is cleared (only the optional ones can be: the schema of the contract
 * refuses `null` elsewhere), any other value replaces it. The merged input then goes through the SAME `normalizeNewSite` as the
 * creation, so the rules cannot drift apart (the parking spot and the level only for a garage — a change of the type away from a
 * garage must clear them in the same patch —, the scale of the power, plain text).
 */
import { PARTY_FIELD_KINDS, type NewSite, type PartyField, type SiteInput, type SiteType } from './site.ts';

/** The patch after the schema of the contract: `null` clears an optional field, a missing key leaves it. */
export interface SitePatchInput {
  readonly siteType?: SiteType | undefined;
  readonly street?: string | undefined;
  readonly buildingNumber?: string | undefined;
  readonly apartmentNumber?: string | null | undefined;
  readonly postalCode?: string | undefined;
  readonly city?: string | undefined;
  readonly parkingSpotNumber?: string | null | undefined;
  readonly garageLevel?: string | null | undefined;
  readonly connectionPowerKw?: number | null | undefined;
  readonly meteringPointId?: string | null | undefined;
  readonly distributionSystemOperatorPartyId?: string | null | undefined;
  readonly managerPartyId?: string | null | undefined;
  readonly notes?: string | null | undefined;
}

const merged = <T>(patched: T | null | undefined, stored: T | undefined): T | undefined =>
  patched === undefined ? stored : (patched ?? undefined);

export function mergeSitePatch(stored: SiteInput, patch: SitePatchInput): SiteInput {
  return {
    id: stored.id,
    siteType: patch.siteType ?? stored.siteType,
    street: patch.street ?? stored.street,
    buildingNumber: patch.buildingNumber ?? stored.buildingNumber,
    apartmentNumber: merged(patch.apartmentNumber, stored.apartmentNumber),
    postalCode: patch.postalCode ?? stored.postalCode,
    city: patch.city ?? stored.city,
    parkingSpotNumber: merged(patch.parkingSpotNumber, stored.parkingSpotNumber),
    garageLevel: merged(patch.garageLevel, stored.garageLevel),
    connectionPowerKw: merged(patch.connectionPowerKw, stored.connectionPowerKw),
    meteringPointId: merged(patch.meteringPointId, stored.meteringPointId),
    distributionSystemOperatorPartyId: merged(patch.distributionSystemOperatorPartyId, stored.distributionSystemOperatorPartyId),
    managerPartyId: merged(patch.managerPartyId, stored.managerPartyId),
    notes: merged(patch.notes, stored.notes),
  };
}

/**
 * The parties the PATCH names, as the pair of fields the kind check reads: a party the patch does not touch is not checked again — an
 * OSD that was deleted since must not stop the owner of the site from correcting the PPE (the kind was checked when it was set).
 */
export function partiesNamedByPatch(patch: SitePatchInput, site: Pick<NewSite, PartyField>): Pick<NewSite, PartyField> {
  const fields = Object.keys(PARTY_FIELD_KINDS) as PartyField[];
  const touched = Object.fromEntries(fields.map((field) => [field, patch[field] === undefined ? null : site[field]]));
  return touched as Pick<NewSite, PartyField>;
}

/**
 * A new site (EVM-021 AC2, AC3, AC5; SR-INPUT-01, SR-INPUT-02, SR-INPUT-05, SR-DATA-02): the rules the schema of the contract
 * cannot state — the parking spot and the level only for a garage, the scale of the connection power, plain text, and the KIND of
 * the party in each `…PartyId` field. The result is either the normalised site or the list of field errors: a JSON Pointer and a
 * code, NEVER the value (SR-ERR-02) — and never the actual kind of a party (no oracle of what a party is, T6).
 */
import { Collector, type FieldIssue } from '../../../platform/input/field-issues.ts';
import type { PartyKind } from '../../parties/index.ts';

export const SITE_TYPES = ['single_family_house', 'multi_family_garage', 'commercial', 'other'] as const;
export type SiteType = (typeof SITE_TYPES)[number];

/** The only type of site that has a parking spot and a level. */
export const GARAGE_SITE_TYPE: SiteType = 'multi_family_garage';

/** The kinds of party each field accepts (domain-model.md → Site): OSD is a kind of its own; a manager is one of three. */
export const PARTY_FIELD_KINDS = Object.freeze({
  distributionSystemOperatorPartyId: ['distribution_system_operator'],
  managerPartyId: ['building_administration', 'property_manager', 'housing_community'],
} as const satisfies Record<string, readonly PartyKind[]>);

export type PartyField = keyof typeof PARTY_FIELD_KINDS;

/** The input after the schema of the contract (types and bounds are checked; the rules below are not). */
export interface SiteInput {
  readonly id: string;
  readonly siteType: SiteType;
  readonly street: string;
  readonly buildingNumber: string;
  readonly apartmentNumber?: string | undefined;
  readonly postalCode: string;
  readonly city: string;
  readonly parkingSpotNumber?: string | undefined;
  readonly garageLevel?: string | undefined;
  readonly connectionPowerKw?: number | undefined;
  readonly meteringPointId?: string | undefined;
  readonly distributionSystemOperatorPartyId?: string | undefined;
  readonly managerPartyId?: string | undefined;
  readonly notes?: string | undefined;
}

export interface NewSite {
  readonly id: string;
  readonly siteType: SiteType;
  readonly street: string;
  readonly buildingNumber: string;
  readonly apartmentNumber: string | null;
  readonly postalCode: string;
  readonly city: string;
  readonly parkingSpotNumber: string | null;
  readonly garageLevel: string | null;
  readonly connectionPowerKw: number | null;
  readonly meteringPointId: string | null;
  readonly distributionSystemOperatorPartyId: string | null;
  readonly managerPartyId: string | null;
  readonly notes: string | null;
}

export type NewSiteResult = { readonly ok: true; readonly site: NewSite } | { readonly ok: false; readonly errors: readonly FieldIssue[] };

const POSTAL_CODE = /^\d{2}-\d{3}$/;

export function normalizeNewSite(input: SiteInput): NewSiteResult {
  const issues = new Collector();
  const street = issues.required('/street', input.street, { maxLength: 200 });
  const buildingNumber = issues.required('/buildingNumber', input.buildingNumber, { maxLength: 20 });
  const apartmentNumber = issues.text('/apartmentNumber', input.apartmentNumber, { maxLength: 20 });
  const postalCode = input.postalCode.normalize('NFC').trim();
  if (!POSTAL_CODE.test(postalCode)) issues.fail('/postalCode', 'invalid_format');
  const city = issues.required('/city', input.city, { maxLength: 100 });
  const parkingSpotNumber = issues.text('/parkingSpotNumber', input.parkingSpotNumber, { maxLength: 20 });
  const garageLevel = issues.text('/garageLevel', input.garageLevel, { maxLength: 20 });
  if (input.siteType !== GARAGE_SITE_TYPE) {
    if (parkingSpotNumber !== null) issues.fail('/parkingSpotNumber', 'not_allowed_for_site_type');
    if (garageLevel !== null) issues.fail('/garageLevel', 'not_allowed_for_site_type');
  }
  const connectionPowerKw = input.connectionPowerKw ?? null;
  if (connectionPowerKw !== null && !hasAtMostTwoDecimals(connectionPowerKw)) issues.fail('/connectionPowerKw', 'invalid_format');
  const meteringPointId = issues.text('/meteringPointId', input.meteringPointId, { maxLength: 40 });
  const notes = issues.text('/notes', input.notes, { maxLength: 2000, multiline: true });

  if (issues.errors.length > 0 || street === null || buildingNumber === null || city === null) {
    return { ok: false, errors: issues.errors };
  }
  return {
    ok: true,
    site: {
      id: input.id,
      siteType: input.siteType,
      street,
      buildingNumber,
      apartmentNumber,
      postalCode,
      city,
      parkingSpotNumber,
      garageLevel,
      connectionPowerKw,
      meteringPointId,
      distributionSystemOperatorPartyId: input.distributionSystemOperatorPartyId ?? null,
      managerPartyId: input.managerPartyId ?? null,
      notes,
    },
  };
}

/** The scale is a rule of the domain, not `multipleOf` of the contract (that is not exact on a float). */
function hasAtMostTwoDecimals(value: number): boolean {
  return Number(value.toFixed(2)) === value;
}

/** The parties a site names, as `[field, id]` pairs in the order of the fields. */
export function namedParties(site: Pick<NewSite, PartyField>): Array<readonly [PartyField, string]> {
  const named: Array<readonly [PartyField, string]> = [];
  for (const field of Object.keys(PARTY_FIELD_KINDS) as PartyField[]) {
    const id = site[field];
    if (id !== null) named.push([field, id]);
  }
  return named;
}

/**
 * Checks each named party against the kinds its field accepts. A party that is not in `kinds` (it does not exist or is deleted — the
 * same answer for both) is `unknown_party`; one of another kind is `wrong_party_kind`. The errors carry the pointer of the field and
 * the code only — never the id and never the kind that was found.
 */
export function checkPartyKinds(site: Pick<NewSite, PartyField>, kinds: ReadonlyMap<string, PartyKind>): FieldIssue[] {
  const issues: FieldIssue[] = [];
  for (const [field, id] of namedParties(site)) {
    const kind = kinds.get(id);
    const accepted: readonly PartyKind[] = PARTY_FIELD_KINDS[field];
    if (kind === undefined) issues.push({ pointer: `/${field}`, code: 'unknown_party' });
    else if (!accepted.includes(kind)) issues.push({ pointer: `/${field}`, code: 'wrong_party_kind' });
  }
  return issues;
}

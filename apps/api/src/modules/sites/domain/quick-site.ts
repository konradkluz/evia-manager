/**
 * The new site of a quick work order from the phone (EVM-099 AC2; SR-INPUT-01, SR-INPUT-05, SR-DATA-02): the type, the street, the building number, the optional
 * apartment and parking spot numbers, the postal code and the city - the rules are the panel's (`normalizeNewSite`) applied to these fields; everything else
 * (the level of the garage, the power, the PPE, the OSD, the manager, the notes) stays empty. Pure, no database. The errors are a JSON Pointer of the payload and a
 * code, NEVER the value (an address is personal data).
 */
import type { FieldIssue } from '../../../platform/input/field-issues.ts';
import { normalizeNewSite, type NewSite, type SiteType } from './site.ts';

export interface QuickSiteInput {
  readonly id: string;
  readonly siteType: SiteType;
  readonly street: string;
  readonly buildingNumber: string;
  readonly apartmentNumber?: string | undefined;
  readonly postalCode: string;
  readonly city: string;
  readonly parkingSpotNumber?: string | undefined;
}

export type QuickSiteResult =
  { readonly ok: true; readonly site: NewSite } | { readonly ok: false; readonly errors: readonly FieldIssue[] };

export function normalizeQuickSite(input: QuickSiteInput): QuickSiteResult {
  const normalized = normalizeNewSite(input);
  if (normalized.ok) return normalized;
  return { ok: false, errors: normalized.errors.map((issue) => ({ pointer: `/newSite${issue.pointer}`, code: issue.code })) };
}

import type { Site, SitePatch } from '@evia/contracts';
import type { PickedParty } from '../parties/party-picker.tsx';
import { GARAGE_SITE_TYPE, parsePower, type SiteFieldName, type SiteForm } from './site-form.ts';

/** What the dialog "Edytuj lokalizację" holds: the text of the form and the two parties the comboboxes chose. */
export interface SiteEdit {
  readonly form: SiteForm;
  readonly osd: PickedParty | null;
  readonly manager: PickedParty | null;
}

const power = (value: number | undefined): string => (value === undefined ? '' : String(value).replace('.', ','));

/** The form of a site as the API holds it; the parties are the ones the dialog read (`null` when none or gone). */
export function siteEditOf(site: Site, osd: PickedParty | null, manager: PickedParty | null): SiteEdit {
  return {
    form: {
      siteType: site.siteType,
      street: site.street,
      buildingNumber: site.buildingNumber,
      apartmentNumber: site.apartmentNumber ?? '',
      postalCode: site.postalCode,
      city: site.city,
      parkingSpotNumber: site.parkingSpotNumber ?? '',
      garageLevel: site.garageLevel ?? '',
      connectionPowerKw: power(site.connectionPowerKw),
      meteringPointId: site.meteringPointId ?? '',
      notes: site.notes ?? '',
    },
    osd,
    manager,
  };
}

const clean = (value: string): string => value.trim();

/** The form as it is saved: a spot and a level exist only for a garage, so for any other type they are empty. */
function effective(form: SiteForm): SiteForm {
  return form.siteType === GARAGE_SITE_TYPE ? form : { ...form, parkingSpotNumber: '', garageLevel: '' };
}

const REQUIRED = ['street', 'buildingNumber', 'postalCode', 'city'] as const;
const OPTIONAL = ['apartmentNumber', 'parkingSpotNumber', 'garageLevel', 'meteringPointId', 'notes'] as const;

const sameValue = (field: keyof SiteForm, left: SiteForm, right: SiteForm): boolean =>
  field === 'connectionPowerKw'
    ? (parsePower(left[field]) ?? clean(left[field])) === (parsePower(right[field]) ?? clean(right[field]))
    : clean(left[field]) === clean(right[field]);

/** The order of the fields in the dialog. */
const ORDER: readonly SiteFieldName[] = [
  'siteType',
  'street',
  'buildingNumber',
  'apartmentNumber',
  'postalCode',
  'city',
  'parkingSpotNumber',
  'garageLevel',
  'osd',
  'manager',
  'connectionPowerKw',
  'meteringPointId',
  'notes',
];

/** The fields the person changed since the dialog was opened (what "Aktualnie: …" may be shown for after a conflict). */
export function changedSiteFields(initial: SiteEdit, current: SiteEdit): SiteFieldName[] {
  const before = effective(initial.form);
  const after = effective(current.form);
  return ORDER.filter((field) => {
    if (field === 'osd') return initial.osd?.id !== current.osd?.id;
    if (field === 'manager') return initial.manager?.id !== current.manager?.id;
    return !sameValue(field, before, after);
  });
}

/**
 * The merge-patch of `updateSite` (EVM-036 AC1, AC2): only what the person changed. An emptied optional field is `null` (it is
 * cleared), the power is a number, the parties are identifiers (`null` removes one), and a change of the type away from a garage
 * clears the spot and the level in the same request (the API demands it). Fields of the server are never sent.
 */
export function buildSitePatch(initial: SiteEdit, current: SiteEdit): SitePatch {
  const changed = new Set(changedSiteFields(initial, current));
  const form = effective(current.form);
  const patch: Record<string, unknown> = {};
  if (changed.has('siteType')) patch['siteType'] = form.siteType;
  for (const field of REQUIRED) if (changed.has(field)) patch[field] = clean(form[field]);
  for (const field of OPTIONAL) if (changed.has(field)) patch[field] = clean(form[field]) === '' ? null : clean(form[field]);
  if (changed.has('connectionPowerKw')) patch['connectionPowerKw'] = parsePower(form.connectionPowerKw) ?? null;
  if (changed.has('osd')) patch['distributionSystemOperatorPartyId'] = current.osd?.id ?? null;
  if (changed.has('manager')) patch['managerPartyId'] = current.manager?.id ?? null;
  return patch;
}

/** The text of a field of the site as the API holds it now — shown as "Aktualnie: …" after a `412` (plain text). */
export function currentSiteText(site: Site, field: keyof SiteForm): string {
  return clean(effective(siteEditOf(site, null, null).form)[field]);
}

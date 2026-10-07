import type { FieldError, SiteSearchItem, SiteType, SiteWritable } from '@evia/contracts';
import type { PickedParty } from '../parties/party-picker.tsx';

/** The one type of site that has a parking spot and a level (the API refuses them for any other: AC2). */
export const GARAGE_SITE_TYPE: SiteType = 'multi_family_garage';

export const SITE_TYPES: readonly SiteType[] = ['single_family_house', 'multi_family_garage', 'commercial', 'other'];

/** What a person types in the section "Nowa lokalizacja" (text only). The type is empty until a person chooses one. */
export interface SiteForm {
  readonly siteType: SiteType | '';
  readonly street: string;
  readonly buildingNumber: string;
  readonly apartmentNumber: string;
  readonly postalCode: string;
  readonly city: string;
  readonly parkingSpotNumber: string;
  readonly garageLevel: string;
  readonly connectionPowerKw: string;
  readonly meteringPointId: string;
  readonly notes: string;
}

/** Text fields (and the type) that can carry an error under them. */
export type SiteFieldName = keyof SiteForm | 'osd' | 'manager';
export type SiteFieldErrors = Partial<Record<SiteFieldName, string>>;

export const EMPTY_SITE_FORM: SiteForm = {
  siteType: '',
  street: '',
  buildingNumber: '',
  apartmentNumber: '',
  postalCode: '',
  city: '',
  parkingSpotNumber: '',
  garageLevel: '',
  connectionPowerKw: '',
  meteringPointId: '',
  notes: '',
};

const filled = (value: string): boolean => value.trim() !== '';

/** The order of the fields in the section: the first invalid one gets the focus. */
const FIELD_ORDER: readonly SiteFieldName[] = [
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

const TEXT_FIELDS = [
  'street',
  'buildingNumber',
  'apartmentNumber',
  'postalCode',
  'city',
  'parkingSpotNumber',
  'garageLevel',
  'connectionPowerKw',
  'meteringPointId',
  'notes',
] as const;

/** Has the person typed or chosen anything of a new site (a draft is worth keeping, "Anuluj" asks before dropping it). */
export function siteStarted(form: SiteForm, osd: PickedParty | null, manager: PickedParty | null): boolean {
  return osd !== null || manager !== null || form.siteType !== '' || TEXT_FIELDS.some((field) => filled(form[field]));
}

/** The power as a number: `11`, `11.5` and `11,5` are numbers (a Polish keyboard types a comma); anything else is not. */
export function parsePower(text: string): number | undefined {
  const value = text.trim();
  if (!/^\d+([.,]\d+)?$/.test(value)) return undefined;
  return Number(value.replace(',', '.'));
}

/** Codes of the fields that must be filled, and of the shapes the panel can check before anything is sent (the API checks all again). */
export function invalidFields(form: SiteForm): Partial<Record<SiteFieldName, 'required' | 'invalid_format'>> {
  const errors: Partial<Record<SiteFieldName, 'required' | 'invalid_format'>> = {};
  if (form.siteType === '') errors.siteType = 'required';
  for (const field of ['street', 'buildingNumber', 'city'] as const) if (!filled(form[field])) errors[field] = 'required';
  if (!filled(form.postalCode)) errors.postalCode = 'required';
  else if (!/^\d{2}-\d{3}$/.test(form.postalCode.trim())) errors.postalCode = 'invalid_format';
  if (filled(form.connectionPowerKw) && parsePower(form.connectionPowerKw) === undefined) errors.connectionPowerKw = 'invalid_format';
  return errors;
}

/**
 * The body of `createSite`: only the filled fields (an emptied field is absent, never an empty text); the parking spot and the level
 * only for a garage; the parties as identifiers. There is no customer in it — a site is independent of any customer.
 */
export function buildSiteBody(form: SiteForm, id: string, osd: PickedParty | null, manager: PickedParty | null): SiteWritable {
  const optional = (value: string) => (filled(value) ? value.trim() : undefined);
  const garage = form.siteType === GARAGE_SITE_TYPE;
  const optionals: Record<string, string | number | undefined> = {
    apartmentNumber: optional(form.apartmentNumber),
    parkingSpotNumber: garage ? optional(form.parkingSpotNumber) : undefined,
    garageLevel: garage ? optional(form.garageLevel) : undefined,
    connectionPowerKw: filled(form.connectionPowerKw) ? parsePower(form.connectionPowerKw) : undefined,
    meteringPointId: optional(form.meteringPointId),
    distributionSystemOperatorPartyId: osd?.id,
    managerPartyId: manager?.id,
    notes: optional(form.notes),
  };
  return {
    id,
    siteType: form.siteType === '' ? 'other' : form.siteType,
    street: form.street.trim(),
    buildingNumber: form.buildingNumber.trim(),
    postalCode: form.postalCode.trim(),
    city: form.city.trim(),
    ...Object.fromEntries(Object.entries(optionals).filter(([, value]) => value !== undefined)),
  };
}

/** The same content (everything but the identifier) is the same request: a retry of it keeps the `id` and the key. */
export const siteFingerprint = (body: SiteWritable): string => JSON.stringify({ ...body, id: undefined });

const POINTERS: Readonly<Record<string, SiteFieldName>> = {
  '/siteType': 'siteType',
  '/street': 'street',
  '/buildingNumber': 'buildingNumber',
  '/apartmentNumber': 'apartmentNumber',
  '/postalCode': 'postalCode',
  '/city': 'city',
  '/parkingSpotNumber': 'parkingSpotNumber',
  '/garageLevel': 'garageLevel',
  '/connectionPowerKw': 'connectionPowerKw',
  '/meteringPointId': 'meteringPointId',
  '/distributionSystemOperatorPartyId': 'osd',
  '/managerPartyId': 'manager',
  '/notes': 'notes',
};

/** The field an error of the server points at (`undefined` for a pointer the section has no field for). */
export const siteFieldOf = (error: FieldError): SiteFieldName | undefined => POINTERS[error.pointer];

/** The first field in the order of the section that has an error. */
export const firstInvalidSite = (errors: SiteFieldErrors): SiteFieldName | undefined =>
  FIELD_ORDER.find((field) => errors[field] !== undefined);

/** A site found by the search or just saved, as the form shows it. */
export type PickedSite = SiteSearchItem;

/**
 * The NEUTRAL values of an anonymized location (EVM-139 AC2; ADR-0024 pt 9; migration 0068; the pattern of `anonymized-customer.ts`). A location that was created for a
 * site survey and is held by nothing else is anonymized when the survey is purged: the address - the personal data of the survey - goes, the row stays (an order of the
 * tombstone points at it). The CHECK `sites_anonymized_neutral` of 0068 pins the same values; a test keeps the two equal. Pure, no framework.
 */
import type { SiteType } from './site.ts';

/** The text that stands for the removed address (a column that is NOT NULL needs a value; the postal code and the building number have a format). */
export const ANONYMIZED_SITE_TEXT = 'Adres usunięty';

export interface AnonymizedSiteValues {
  readonly site_type: SiteType;
  readonly street: string;
  readonly building_number: string;
  readonly postal_code: string;
  readonly city: string;
  readonly apartment_number: null;
  readonly parking_spot_number: null;
  readonly garage_level: null;
  readonly connection_power_kw: null;
  readonly metering_point_id: null;
  readonly distribution_system_operator_party_id: null;
  readonly manager_party_id: null;
  readonly notes: null;
}

export const ANONYMIZED_SITE_VALUES: AnonymizedSiteValues = Object.freeze({
  site_type: 'other',
  street: ANONYMIZED_SITE_TEXT,
  building_number: '0',
  postal_code: '00-000',
  city: ANONYMIZED_SITE_TEXT,
  apartment_number: null,
  parking_spot_number: null,
  garage_level: null,
  connection_power_kw: null,
  metering_point_id: null,
  distribution_system_operator_party_id: null,
  manager_party_id: null,
  notes: null,
});

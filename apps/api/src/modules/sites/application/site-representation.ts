/**
 * The representations of a site as the contract has them (SR-DATA-03), each parsed with the schema of the contract before it leaves:
 * the full site (only the author of a creation gets it) and the item of a search (the type, the address and the parking spot — never
 * the notes, the PPE, the connection power or the parties).
 */
import type { Site, SiteSearchItem } from '@evia/contracts';
import { zSite, zSiteSearchItem } from '@evia/contracts/zod';
import { ProblemException } from '../../../platform/http/problem.ts';
import type { SiteRow, SiteSearchRow } from '../infrastructure/site-store.ts';

const present = <K extends string>(key: K, value: string | null): { [P in K]?: string } =>
  (value === null ? {} : { [key]: value }) as { [P in K]?: string };

export function toSite(row: SiteRow): Site {
  const site = {
    id: row.id,
    siteType: row.site_type,
    street: row.street,
    buildingNumber: row.building_number,
    ...present('apartmentNumber', row.apartment_number),
    postalCode: row.postal_code,
    city: row.city,
    ...present('parkingSpotNumber', row.parking_spot_number),
    ...present('garageLevel', row.garage_level),
    ...(row.connection_power_kw === null ? {} : { connectionPowerKw: Number(row.connection_power_kw) }),
    ...present('meteringPointId', row.metering_point_id),
    ...present('distributionSystemOperatorPartyId', row.distribution_system_operator_party_id),
    ...present('managerPartyId', row.manager_party_id),
    ...present('notes', row.notes),
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
  const checked = zSite.safeParse(site);
  if (!checked.success) throw new ProblemException('internal_error');
  return checked.data;
}

export function toSiteSearchItem(row: SiteSearchRow): SiteSearchItem {
  const item = {
    id: row.id,
    siteType: row.site_type,
    street: row.street,
    buildingNumber: row.building_number,
    ...present('apartmentNumber', row.apartment_number),
    postalCode: row.postal_code,
    city: row.city,
    ...present('parkingSpotNumber', row.parking_spot_number),
    ...present('garageLevel', row.garage_level),
  };
  const checked = zSiteSearchItem.safeParse(item);
  if (!checked.success) throw new ProblemException('internal_error');
  return checked.data;
}

/**
 * Queries of the `sites` module (EVM-021). Every value reaches the database as a bound parameter; the read policy is a condition of
 * the query, never a filter of the result (SR-AUTHZ-03).
 */
import { sql } from 'kysely';
import { searchTextMatches } from '../../../platform/database/search-text.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import type { NewSite, SiteType } from '../domain/site.ts';
import { visibleSites } from './read-policy.ts';
import type { SitesDb } from './tables.ts';

const COLUMNS = [
  'id',
  'site_type',
  'street',
  'building_number',
  'apartment_number',
  'postal_code',
  'city',
  'parking_spot_number',
  'garage_level',
  'connection_power_kw',
  'metering_point_id',
  'distribution_system_operator_party_id',
  'manager_party_id',
  'notes',
  'version',
  'created_at',
  'updated_at',
] as const;

export interface SiteSearchRow {
  readonly id: string;
  readonly site_type: SiteType;
  readonly street: string;
  readonly building_number: string;
  readonly apartment_number: string | null;
  readonly postal_code: string;
  readonly city: string;
  readonly parking_spot_number: string | null;
  readonly garage_level: string | null;
}

/**
 * Sites whose search text (the address and the parking spot) contains the phrase (see `searchTextMatches`). The notes, the PPE, the
 * connection power and the parties are not selected: the result of a search never carries them (SR-DATA-03). A hard LIMIT and the
 * statement timeout of the pool bound the cost (TM-22); the order is fixed (city, street, building, then identifier).
 */
export function searchVisibleSites(db: SitesDb, principal: Principal, term: string, limit: number): Promise<SiteSearchRow[]> {
  return db
    .selectFrom('sites.sites')
    .select([
      'id',
      'site_type',
      'street',
      'building_number',
      'apartment_number',
      'postal_code',
      'city',
      'parking_spot_number',
      'garage_level',
    ])
    .where(visibleSites(principal))
    .where(searchTextMatches(term))
    .orderBy('city')
    .orderBy('street')
    .orderBy('building_number')
    .orderBy('id')
    .limit(limit)
    .execute();
}

/**
 * INSERT only: an existing identifier — also of a soft-deleted site — inserts nothing (`undefined`), whatever the content, and the
 * caller answers `409 id_conflict` without a word about the existing row.
 */
export function insertSite(db: SitesDb, site: NewSite, actorUserId: string, now: Date) {
  return db
    .insertInto('sites.sites')
    .values({
      id: site.id,
      site_type: site.siteType,
      street: site.street,
      building_number: site.buildingNumber,
      apartment_number: site.apartmentNumber,
      postal_code: site.postalCode,
      city: site.city,
      parking_spot_number: site.parkingSpotNumber,
      garage_level: site.garageLevel,
      connection_power_kw: site.connectionPowerKw,
      metering_point_id: site.meteringPointId,
      distribution_system_operator_party_id: site.distributionSystemOperatorPartyId,
      manager_party_id: site.managerPartyId,
      notes: site.notes,
      created_at: now,
      created_by: actorUserId,
      updated_at: now,
      updated_by: actorUserId,
      deleted_at: null,
      deleted_by: null,
    })
    .onConflict((conflict) => conflict.column('id').doNothing())
    .returning(COLUMNS)
    .executeTakeFirst();
}

export function findVisibleSite(db: SitesDb, principal: Principal, id: string) {
  return db.selectFrom('sites.sites').select(COLUMNS).where('id', '=', id).where(visibleSites(principal)).executeTakeFirst();
}

export type SiteRow = NonNullable<Awaited<ReturnType<typeof findVisibleSite>>>;

/**
 * The site LOCKED for update (`SELECT … FOR UPDATE`) with the read policy IN the query: a missing or soft-deleted site is `undefined`
 * for every role — one answer, no oracle (SR-AUTHZ-02). Every decision of the edit is taken on this row, never on an earlier read
 * (TOCTOU, ASVS V2.3.3).
 */
export function lockVisibleSite(db: SitesDb, principal: Principal, id: string) {
  return db.selectFrom('sites.sites').select(COLUMNS).where('id', '=', id).where(visibleSites(principal)).forUpdate().executeTakeFirst();
}

/**
 * Writes the normalised site over the row and raises the version by one — only for the version the command decided on (the lock
 * already guarantees it; the condition is the second line of defence). Every column the site owns is written. `undefined` — nothing
 * was updated.
 */
export function updateSiteRow(db: SitesDb, id: string, expectedVersion: number, site: NewSite, actorUserId: string, now: Date) {
  return db
    .updateTable('sites.sites')
    .set({
      site_type: site.siteType,
      street: site.street,
      building_number: site.buildingNumber,
      apartment_number: site.apartmentNumber,
      postal_code: site.postalCode,
      city: site.city,
      parking_spot_number: site.parkingSpotNumber,
      garage_level: site.garageLevel,
      connection_power_kw: site.connectionPowerKw,
      metering_point_id: site.meteringPointId,
      distribution_system_operator_party_id: site.distributionSystemOperatorPartyId,
      manager_party_id: site.managerPartyId,
      notes: site.notes,
      version: sql<number>`version + 1`,
      updated_at: now,
      updated_by: actorUserId,
    })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .where('deleted_at', 'is', null)
    .returning(COLUMNS)
    .executeTakeFirst();
}

/** The address columns only (the facade `SiteDirectory`): no notes, PPE, power or parties are selected (SR-DATA-03). */
export function findVisibleSiteSummary(db: SitesDb, principal: Principal, id: string) {
  return db
    .selectFrom('sites.sites')
    .select([
      'id',
      'site_type',
      'street',
      'building_number',
      'apartment_number',
      'postal_code',
      'city',
      'parking_spot_number',
      'garage_level',
    ])
    .where('id', '=', id)
    .where(visibleSites(principal))
    .executeTakeFirst();
}

/**
 * The columns of the card "Lokalizacja" (the facade `SiteDirectory`): the key of the site, the address, the spot, the power, the PPE, the notes and the
 * keys of the two parties — named columns, never the entity (SR-DATA-03). `connection_power_kw` is `numeric(6,2)` (a string here).
 */
export function findVisibleSiteCard(db: SitesDb, principal: Principal, id: string) {
  return db
    .selectFrom('sites.sites')
    .select([
      'id',
      'site_type',
      'street',
      'building_number',
      'apartment_number',
      'postal_code',
      'city',
      'parking_spot_number',
      'garage_level',
      'connection_power_kw',
      'metering_point_id',
      'distribution_system_operator_party_id',
      'manager_party_id',
      'notes',
    ])
    .where('id', '=', id)
    .where(visibleSites(principal))
    .executeTakeFirst();
}

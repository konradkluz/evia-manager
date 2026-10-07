/**
 * Synthetic sites and parties written straight into the database (EVM-021) — owner connection, so the API under test has to find
 * them through its own queries. A TEST helper outside `src`; everything is synthetic (names, numbers and addresses are invented).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../src/platform/database/database.ts';
import { uuidv7 } from './uuid.ts';

export interface PartySpec {
  readonly id?: string;
  readonly kind?: string;
  readonly legalForm?: 'organization' | 'natural_person';
  readonly displayName?: string;
  readonly contactPersonName?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly notes?: string;
  readonly deletedAt?: string;
}

export interface SiteSpec {
  readonly id?: string;
  readonly siteType?: 'single_family_house' | 'multi_family_garage' | 'commercial' | 'other';
  readonly street?: string;
  readonly buildingNumber?: string;
  readonly apartmentNumber?: string;
  readonly postalCode?: string;
  readonly city?: string;
  readonly parkingSpotNumber?: string;
  readonly garageLevel?: string;
  readonly connectionPowerKw?: number;
  readonly meteringPointId?: string;
  readonly osdPartyId?: string;
  readonly managerPartyId?: string;
  readonly notes?: string;
  readonly deletedAt?: string;
}

const T = '2026-10-07T08:00:00Z';

/** Inserts a party (an OSD, an organisation by default) and returns its identifier. */
export async function insertParty(db: Kysely<Database>, spec: PartySpec = {}): Promise<string> {
  const id = spec.id ?? uuidv7();
  await sql`
    insert into parties.parties (id, kind, legal_form, display_name, contact_person_name, phone, email, notes, created_at, updated_at, deleted_at)
    values (${id}, ${spec.kind ?? 'distribution_system_operator'}, ${spec.legalForm ?? 'organization'}, ${spec.displayName ?? 'Operator Testowy'},
      ${spec.contactPersonName ?? null}, ${spec.phone ?? null}, ${spec.email ?? null}, ${spec.notes ?? null}, ${T}, ${T}, ${spec.deletedAt ?? null})`.execute(
    db,
  );
  return id;
}

/** Inserts a site (a house at "ul. Testowa 7, 00-001 Warszawa" by default) and returns its identifier. */
export async function insertSite(db: Kysely<Database>, spec: SiteSpec = {}): Promise<string> {
  const id = spec.id ?? uuidv7();
  await sql`
    insert into sites.sites (id, site_type, street, building_number, apartment_number, postal_code, city, parking_spot_number, garage_level,
      connection_power_kw, metering_point_id, distribution_system_operator_party_id, manager_party_id, notes, created_at, updated_at, deleted_at)
    values (${id}, ${spec.siteType ?? 'single_family_house'}, ${spec.street ?? 'ul. Testowa'}, ${spec.buildingNumber ?? '7'},
      ${spec.apartmentNumber ?? null}, ${spec.postalCode ?? '00-001'}, ${spec.city ?? 'Warszawa'}, ${spec.parkingSpotNumber ?? null},
      ${spec.garageLevel ?? null}, ${spec.connectionPowerKw ?? null}, ${spec.meteringPointId ?? null}, ${spec.osdPartyId ?? null},
      ${spec.managerPartyId ?? null}, ${spec.notes ?? null}, ${T}, ${T}, ${spec.deletedAt ?? null})`.execute(db);
  return id;
}

export const clearSitesAndParties = async (db: Kysely<Database>): Promise<void> => {
  await sql`delete from sites.sites`.execute(db);
  await sql`delete from parties.parties`.execute(db);
  await sql`delete from platform.idempotency_records`.execute(db);
};

/**
 * The facade of `sites` for the other modules (ADR-0001: a module reaches another one through its `index.ts` only). Its first
 * consumer is `work-orders`, which must know that the site of a new order exists and is visible to the caller, and show its address
 * in the header of the order (EVM-022 AC1, AC3, SR-AUTHZ-02). The caller passes ITS transaction, so the check and the insert that
 * depends on it are one unit of work; the read policy of sites applies to EVERY role, the Administrator included: a deleted site
 * is as unknown as one that never existed (T6). Only the type, the address and the parking spot come back — never the notes, the
 * PPE, the connection power or the parties (SR-DATA-03).
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';
import type { Principal } from '../../platform/http/principal.ts';
import type { SiteType } from './domain/site.ts';

export const SITE_DIRECTORY = Symbol('SITE_DIRECTORY');

export interface SiteSummary {
  readonly id: string;
  readonly siteType: SiteType;
  readonly street: string;
  readonly buildingNumber: string;
  readonly apartmentNumber: string | null;
  readonly postalCode: string;
  readonly city: string;
  readonly parkingSpotNumber: string | null;
  readonly garageLevel: string | null;
}

export interface SiteDirectory {
  /** @returns the site when it exists and is visible to the caller; `undefined` otherwise (the same for both) */
  findVisible(tx: Kysely<Database>, principal: Principal, id: string): Promise<SiteSummary | undefined>;
}

/** The implementation of the `SiteDirectory` facade (see `site-directory.ts`): one query under the read policy of sites. */
import { Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { findVisibleSiteSummary } from '../infrastructure/site-store.ts';
import { siteTables } from '../infrastructure/tables.ts';
import type { SiteDirectory, SiteSummary } from '../site-directory.ts';

@Injectable()
export class SiteDirectoryService implements SiteDirectory {
  async findVisible(tx: Kysely<Database>, principal: Principal, id: string): Promise<SiteSummary | undefined> {
    const row = await findVisibleSiteSummary(siteTables(tx), principal, id);
    if (row === undefined) return undefined;
    return {
      id: row.id,
      siteType: row.site_type,
      street: row.street,
      buildingNumber: row.building_number,
      apartmentNumber: row.apartment_number,
      postalCode: row.postal_code,
      city: row.city,
      parkingSpotNumber: row.parking_spot_number,
      garageLevel: row.garage_level,
    };
  }
}

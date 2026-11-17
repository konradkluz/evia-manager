/** The implementation of the `SiteAnonymization` facade (see `site-anonymization.ts`): lock and decide, then one update. */
import { Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { anonymizeSite, lockSite } from '../infrastructure/site-anonymization-store.ts';
import { siteTables } from '../infrastructure/tables.ts';
import type { SiteAnonymization, SiteClaim } from '../site-anonymization.ts';

@Injectable()
export class SiteAnonymizationService implements SiteAnonymization {
  async claimCreatedFor(tx: Kysely<Database>, claim: SiteClaim): Promise<boolean> {
    const site = await lockSite(siteTables(tx), claim.siteId);
    if (site === undefined || site.anonymized) return false;
    const madeForTheSurvey =
      claim.createdBy !== null &&
      site.createdBy === claim.createdBy &&
      site.createdAt.getTime() >= claim.createdNotBefore.getTime() &&
      site.createdAt.getTime() <= claim.createdNotAfter.getTime();
    return madeForTheSurvey && (await claim.unshared());
  }

  async anonymize(tx: Kysely<Database>, siteId: string, actorUserId: string, now: Date): Promise<void> {
    if (!(await anonymizeSite(siteTables(tx), siteId, actorUserId, now)))
      throw new Error('site anonymization: the location was not claimed');
  }
}

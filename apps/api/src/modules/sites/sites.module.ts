/**
 * Module `sites` (ADR-0001, ADR-0017; D7): the places where work is done, independent of any customer; owner of the `sites` schema.
 * In EVM-021 it serves the search and the creation of a site for the new-work-order form (W-05); the edit, the deletion and the
 * `Charger` arrive with EVM-036, EVM-060 and M4. It depends on `platform` (idempotency, rate limit, mass-read control, event bus) and
 * on `parties` through its facade `PartyDirectory` (the kind of the OSD and the manager of a site); the audit trail subscribes to
 * its events (`sites` never imports `audit`). The facade `SiteDirectory` serves `work-orders` (EVM-022): it tells whether a site
 * exists and is visible to the caller and gives its address, in the transaction of the caller.
 */
import { Module } from '@nestjs/common';
import { PartiesModule } from '../parties/index.ts';
import { CreateSiteService } from './application/create-site.service.ts';
import { SearchSitesService } from './application/search-sites.service.ts';
import { SiteDirectoryService } from './application/site-directory.service.ts';
import { SitesController } from './http/sites.controller.ts';
import { SITE_DIRECTORY } from './site-directory.ts';

@Module({
  imports: [PartiesModule],
  controllers: [SitesController],
  providers: [SearchSitesService, CreateSiteService, { provide: SITE_DIRECTORY, useClass: SiteDirectoryService }],
  exports: [SITE_DIRECTORY],
})
export class SitesModule {}

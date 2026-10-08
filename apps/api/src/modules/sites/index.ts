/** Public API of the `sites` module (other modules reach it only through this file — ADR-0001). */
export { SitesModule } from './sites.module.ts';
export { SITE_EVENT_TYPES, type SiteEvent } from './events.ts';
export { SITE_DIRECTORY, type SiteDirectory, type SiteSummary } from './site-directory.ts';

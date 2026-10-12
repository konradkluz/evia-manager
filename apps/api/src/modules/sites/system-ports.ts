/**
 * The SYSTEM port of `sites` for the read model (ADR-0017 W5; EVM-034): the type of the site of the orders, nothing else. Not part of
 * `index.ts` (see `work-orders/system-ports.ts`): only `overview` may import it, so no controller can reach a read that skips the
 * read policy. A deleted site keeps its type — the projection of an order is about the order, not about who may see the site.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';

export const SITE_PROJECTION_SOURCE = Symbol('SITE_PROJECTION_SOURCE');

export interface SiteProjectionSource {
  /** The `siteType` code of every site among `ids` that exists (ONE query); the others are absent. */
  siteTypesOf(tx: Kysely<Database>, ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

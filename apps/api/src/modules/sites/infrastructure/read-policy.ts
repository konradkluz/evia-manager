/**
 * The read policy of sites as a condition of the query (EVM-021 AC6; SR-AUTHZ-02, SR-AUTHZ-03, ASVS V8.2.2): the ONE place that says
 * which sites a caller may see. The search and the replay of a creation use it, so a rule changed here changes them all — and
 * nobody filters a result after it was read. Today every signed-in role sees every site that is not soft deleted, the Administrator
 * included: the view of deleted sites is a story of its own (EVM-060). The switch over the role is exhaustive: a role added later
 * (the installer of M4) does not compile until this policy says what it may see.
 */
import type { ExpressionBuilder } from 'kysely';
import type { Principal } from '../../../platform/http/principal.ts';
import type { SiteTables } from './tables.ts';

export const visibleSites = (principal: Principal) => (eb: ExpressionBuilder<SiteTables, 'sites.sites'>) => {
  switch (principal.role) {
    case 'administrator':
    case 'editor':
    case 'read_only':
      return eb('sites.sites.deleted_at', 'is', null);
  }
};

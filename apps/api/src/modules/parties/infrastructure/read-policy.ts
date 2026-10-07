/**
 * The read policy of parties as a condition of the query (EVM-021 AC6; SR-AUTHZ-02, SR-AUTHZ-03, ASVS V8.2.2): the ONE place that
 * says which parties a caller may see. The search, the replay of a creation and the check of a site's parties use it, so a rule
 * changed here changes them all — and nobody filters a result after it was read. Today every signed-in role sees every party that
 * is not soft deleted, the Administrator included: the view of deleted parties is a story of its own (EVM-060). The switch over
 * the role is exhaustive: a role added later (the installer of M4) does not compile until this policy says what it may see.
 */
import type { ExpressionBuilder } from 'kysely';
import type { Principal } from '../../../platform/http/principal.ts';
import type { PartyTables } from './tables.ts';

export const visibleParties = (principal: Principal) => (eb: ExpressionBuilder<PartyTables, 'parties.parties'>) => {
  switch (principal.role) {
    case 'administrator':
    case 'editor':
    case 'read_only':
      return eb('parties.parties.deleted_at', 'is', null);
  }
};

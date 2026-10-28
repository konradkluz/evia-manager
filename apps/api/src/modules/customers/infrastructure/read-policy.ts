/**
 * The read policies of customers as conditions of the query (EVM-020 AC7, EVM-041 AC1; SR-AUTHZ-02, SR-AUTHZ-03, ASVS V8.2.2): the ONE
 * place that says which customers a caller may see. A rule changed here changes every read - and nobody filters a result after it was
 * read. Every switch over the role is exhaustive: a role added later (the installer of M4) does not compile until the policy says what
 * it may see.
 * - {@link visibleCustomers}: the customers that are not soft deleted - for EVERY role, the Administrator included. The facade
 *   `CustomerDirectory` (the other modules: an order, the list of orders, the overview), the edit and the live view of the list and of
 *   the search use ONLY this policy, so a deleted customer is as unknown as one who never existed (no oracle; TM-18);
 * - {@link readableCustomers}: what the module reads for ITSELF - the detail `GET /customers/{id}` and the locks of the deletion, the
 *   restoration and the anonymization: the Administrator also reads a deleted customer (the view "Usunięci", W-14); the Editor and
 *   Read-only never do (`404`);
 * - {@link deletedCustomers}: the view "Usunięci" of the list and of the search - the deleted customers, for the Administrator ALONE (the
 *   service refuses the other roles with `403` before it asks; this condition is the second line: it matches nothing for them).
 */
import type { ExpressionBuilder } from 'kysely';
import type { Principal } from '../../../platform/http/principal.ts';
import type { CustomerTables } from './tables.ts';

type CustomerBuilder = ExpressionBuilder<CustomerTables, 'customers.customers'>;

export const visibleCustomers = (principal: Principal) => (eb: CustomerBuilder) => {
  switch (principal.role) {
    case 'administrator':
    case 'editor':
    case 'read_only':
      return eb('customers.customers.deleted_at', 'is', null);
  }
};

export const readableCustomers = (principal: Principal) => (eb: CustomerBuilder) => {
  switch (principal.role) {
    case 'administrator':
      return eb.lit(true);
    case 'editor':
    case 'read_only':
      return eb('customers.customers.deleted_at', 'is', null);
  }
};

export const deletedCustomers = (principal: Principal) => (eb: CustomerBuilder) => {
  switch (principal.role) {
    case 'administrator':
      return eb('customers.customers.deleted_at', 'is not', null);
    case 'editor':
    case 'read_only':
      return eb.lit(false);
  }
};

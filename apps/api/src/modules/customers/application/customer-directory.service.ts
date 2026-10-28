/** The implementation of the `CustomerDirectory` facade (see `customer-directory.ts`): one query under the read policy of customers. */
import { Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { resolveSearchQuery } from '../domain/search-query.ts';
import type { CustomerCard, CustomerDirectory, CustomerSummary } from '../customer-directory.ts';
import {
  findVisibleCustomerCard,
  findVisibleCustomerNames,
  findVisibleCustomerSummary,
  lockVisibleCustomerForOrder,
  searchVisibleCustomerIds,
} from '../infrastructure/customer-store.ts';
import { customerTables } from '../infrastructure/tables.ts';

@Injectable()
export class CustomerDirectoryService implements CustomerDirectory {
  async findVisible(tx: Kysely<Database>, principal: Principal, id: string): Promise<CustomerSummary | undefined> {
    const row = await findVisibleCustomerSummary(customerTables(tx), principal, id);
    return row === undefined ? undefined : { id: row.id, displayName: row.display_name };
  }

  async lockVisible(tx: Kysely<Database>, principal: Principal, id: string): Promise<CustomerSummary | undefined> {
    const row = await lockVisibleCustomerForOrder(customerTables(tx), principal, id);
    return row === undefined ? undefined : { id: row.id, displayName: row.display_name };
  }

  async getCard(tx: Kysely<Database>, principal: Principal, id: string): Promise<CustomerCard | undefined> {
    const row = await findVisibleCustomerCard(customerTables(tx), principal, id);
    return row === undefined
      ? undefined
      : { displayName: row.display_name, phone: row.phone, email: row.email, anonymized: row.anonymized_at !== null };
  }

  async searchIds(tx: Kysely<Database>, principal: Principal, phrase: string, limit: number): Promise<string[]> {
    const resolved = resolveSearchQuery(phrase);
    return resolved.ok ? searchVisibleCustomerIds(customerTables(tx), principal, resolved.term, limit) : [];
  }

  displayNamesOf(tx: Kysely<Database>, principal: Principal, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    return findVisibleCustomerNames(customerTables(tx), principal, ids);
  }
}

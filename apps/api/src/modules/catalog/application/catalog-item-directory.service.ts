/** The implementation of the `CatalogItemDirectory` facade (see `catalog-item-directory.ts`): reads in the transaction of the caller. */
import { Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { CatalogItemDirectory, CatalogItemForScope } from '../catalog-item-directory.ts';
import { findActiveCatalogItem, findCatalogItemProcedures } from '../infrastructure/queries.ts';
import { catalogTables } from '../infrastructure/tables.ts';
import type { TemplateProcedureForCopy } from '../template-directory.ts';

@Injectable()
export class CatalogItemDirectoryService implements CatalogItemDirectory {
  findActiveByCode(tx: Kysely<Database>, code: string): Promise<CatalogItemForScope | undefined> {
    return findActiveCatalogItem(catalogTables(tx), code);
  }

  findProcedures(tx: Kysely<Database>, catalogItemId: string): Promise<TemplateProcedureForCopy[]> {
    return findCatalogItemProcedures(catalogTables(tx), catalogItemId);
  }
}

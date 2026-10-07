/** The implementation of the `TemplateDirectory` facade (see `template-directory.ts`): two reads in the transaction of the caller. */
import { Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { findActiveTemplateItems } from '../infrastructure/queries.ts';
import { catalogTables } from '../infrastructure/tables.ts';
import type { TemplateDirectory, TemplateForCopy } from '../template-directory.ts';

@Injectable()
export class TemplateDirectoryService implements TemplateDirectory {
  async findActiveForCopy(tx: Kysely<Database>, id: string): Promise<TemplateForCopy | undefined> {
    return findActiveTemplateItems(catalogTables(tx), id);
  }
}

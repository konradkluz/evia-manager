/** The implementation of the `TemplateDirectory` facade (see `template-directory.ts`): reads in the transaction of the caller. */
import { Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { findActiveTemplateItems, findTemplateProcedures } from '../infrastructure/queries.ts';
import { catalogTables } from '../infrastructure/tables.ts';
import type { TemplateDirectory, TemplateForCopy, TemplateProcedureForCopy } from '../template-directory.ts';

@Injectable()
export class TemplateDirectoryService implements TemplateDirectory {
  async findActiveForCopy(tx: Kysely<Database>, id: string): Promise<TemplateForCopy | undefined> {
    return findActiveTemplateItems(catalogTables(tx), id);
  }

  async findProceduresForCopy(tx: Kysely<Database>, templateId: string): Promise<TemplateProcedureForCopy[]> {
    return findTemplateProcedures(catalogTables(tx), templateId);
  }
}

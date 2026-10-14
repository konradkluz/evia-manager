/** The implementation of the `TemplateDirectory` facade (see `template-directory.ts`): reads in the transaction of the caller. */
import { Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import {
  findActiveProcedureTemplate,
  findActiveTemplateItems,
  findTemplatePaymentPlan,
  findTemplateProcedures,
} from '../infrastructure/queries.ts';
import { catalogTables } from '../infrastructure/tables.ts';
import type {
  ProcedureTemplateForCopy,
  TemplateDirectory,
  TemplateForCopy,
  TemplatePaymentMilestoneForCopy,
  TemplateProcedureForCopy,
} from '../template-directory.ts';

@Injectable()
export class TemplateDirectoryService implements TemplateDirectory {
  async findActiveForCopy(tx: Kysely<Database>, id: string): Promise<TemplateForCopy | undefined> {
    return findActiveTemplateItems(catalogTables(tx), id);
  }

  async findProceduresForCopy(tx: Kysely<Database>, templateId: string): Promise<TemplateProcedureForCopy[]> {
    return findTemplateProcedures(catalogTables(tx), templateId);
  }

  async findActiveProcedureForCopy(tx: Kysely<Database>, code: string): Promise<ProcedureTemplateForCopy | undefined> {
    return findActiveProcedureTemplate(catalogTables(tx), code);
  }

  async findPaymentPlanForCopy(tx: Kysely<Database>, templateId: string): Promise<TemplatePaymentMilestoneForCopy[]> {
    return findTemplatePaymentPlan(catalogTables(tx), templateId);
  }
}

/**
 * HTTP surface of the catalog module (EVM-019): five read operations, no operation that changes the configuration
 * (AC6). Handlers contain no authorization — the global guard decides before they run (operation in the manifest,
 * enrolment state, role, web channel); here only input validation, the call and the validated response (SR-DATA-03:
 * the response is parsed with the schema of the contract, so only the fields of the contract can leave).
 */
import {
  zDocumentKindList,
  zGetWorkOrderTemplatePath,
  zListWorkOrderTemplatesQuery,
  zProcedureTemplateList,
  zServiceItemList,
  zWorkOrderTemplate,
  zWorkOrderTemplateList,
} from '@evia/contracts/zod';
import type { DocumentKindList, ProcedureTemplateList, ServiceItemList, WorkOrderTemplate, WorkOrderTemplateList } from '@evia/contracts';
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { CatalogReadService } from '../application/catalog-read.service.ts';

const listQuery = strictObjects(zListWorkOrderTemplatesQuery);
const templatePath = strictObjects(zGetWorkOrderTemplatePath);

@Controller()
export class CatalogController {
  readonly #catalog: CatalogReadService;

  constructor(@Inject(CatalogReadService) catalog: CatalogReadService) {
    this.#catalog = catalog;
  }

  @Get('/api/v1/catalog/work-order-templates')
  @OperationId('listWorkOrderTemplates')
  async listWorkOrderTemplates(@Query() query: unknown): Promise<WorkOrderTemplateList> {
    const { siteTypeHint } = parseInput(listQuery, query) as { siteTypeHint?: string };
    return zWorkOrderTemplateList.parse(await this.#catalog.activeTemplates(siteTypeHint));
  }

  @Get('/api/v1/catalog/work-order-templates/:templateId')
  @OperationId('getWorkOrderTemplate')
  async getWorkOrderTemplate(@Param() params: unknown): Promise<WorkOrderTemplate> {
    const { templateId } = parseInput(templatePath, params) as { templateId: string };
    const template = await this.#catalog.templateById(templateId);
    if (template === undefined) throw new ProblemException('not_found');
    return zWorkOrderTemplate.parse(template);
  }

  @Get('/api/v1/catalog/service-items')
  @OperationId('listServiceItems')
  async listServiceItems(): Promise<ServiceItemList> {
    return zServiceItemList.parse(await this.#catalog.serviceItems());
  }

  @Get('/api/v1/catalog/procedure-templates')
  @OperationId('listProcedureTemplates')
  async listProcedureTemplates(): Promise<ProcedureTemplateList> {
    return zProcedureTemplateList.parse(await this.#catalog.procedureTemplates());
  }

  @Get('/api/v1/catalog/document-kinds')
  @OperationId('listDocumentKinds')
  async listDocumentKinds(): Promise<DocumentKindList> {
    return zDocumentKindList.parse(await this.#catalog.documentKinds());
  }
}

/** Public API of the `catalog` module (other modules reach it only through this file — ADR-0001). */
export { CatalogModule } from './catalog.module.ts';
export { CatalogReadService } from './application/catalog-read.service.ts';
export {
  TEMPLATE_DIRECTORY,
  type ProcedureTemplateForCopy,
  type TemplateDirectory,
  type TemplateForCopy,
  type TemplatePaymentMilestoneForCopy,
  type TemplateProcedureForCopy,
  type TemplateScopeItem,
  type TemplateStageForCopy,
} from './template-directory.ts';
export { CATALOG_ITEM_DIRECTORY, type CatalogItemDirectory, type CatalogItemForScope } from './catalog-item-directory.ts';
export { MAX_PARAMETERS_BYTES, parseParameters, type ParameterIssue, type ParameterResult } from './domain/parameter-sets.ts';

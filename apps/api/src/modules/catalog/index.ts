/** Public API of the `catalog` module (other modules reach it only through this file — ADR-0001). */
export { CatalogModule } from './catalog.module.ts';
export { CatalogReadService } from './application/catalog-read.service.ts';
export {
  TEMPLATE_DIRECTORY,
  type TemplateDirectory,
  type TemplateForCopy,
  type TemplateProcedureForCopy,
  type TemplateScopeItem,
  type TemplateStageForCopy,
} from './template-directory.ts';

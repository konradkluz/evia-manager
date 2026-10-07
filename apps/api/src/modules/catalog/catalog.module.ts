/**
 * Module `catalog` (ADR-0001): the service catalogue, process and work order templates and document kinds — read-only
 * configuration in M1, owner of the `catalog` schema. It depends only on `platform`; the vocabulary of party kinds is
 * kept in its own code until `parties` exists. The data arrives by data migration (`0008_catalog_seed`). The facade
 * `TemplateDirectory` serves `work-orders` (EVM-022): the items of an active template to copy, in the transaction of the caller.
 */
import { Module } from '@nestjs/common';
import { CatalogReadService } from './application/catalog-read.service.ts';
import { TemplateDirectoryService } from './application/template-directory.service.ts';
import { CatalogController } from './http/catalog.controller.ts';
import { TEMPLATE_DIRECTORY } from './template-directory.ts';

@Module({
  controllers: [CatalogController],
  providers: [CatalogReadService, { provide: TEMPLATE_DIRECTORY, useClass: TemplateDirectoryService }],
  exports: [TEMPLATE_DIRECTORY],
})
export class CatalogModule {}

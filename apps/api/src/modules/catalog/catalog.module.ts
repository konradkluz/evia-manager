/**
 * Module `catalog` (ADR-0001): the service catalogue, process and work order templates and document kinds — read-only
 * configuration in M1, owner of the `catalog` schema. It depends only on `platform`; the vocabulary of party kinds is
 * kept in its own code until `parties` exists. The data arrives by data migration (`0008_catalog_seed`). The facade
 * `TemplateDirectory` serves `work-orders` (EVM-022): the items of an active template to copy, in the transaction of the caller;
 * the facade `CatalogItemDirectory` (EVM-035) the active item of the catalogue and the processes it brings, for the editing of
 * the scope of an order (`work-orders`, `procedures`); the facade `DocumentKindDirectory` (EVM-047) the kind of a document and its class
 * of confidentiality (`media`).
 */
import { Module } from '@nestjs/common';
import { DocumentKindDirectoryService } from './application/document-kind-directory.service.ts';
import { CatalogItemDirectoryService } from './application/catalog-item-directory.service.ts';
import { CatalogReadService } from './application/catalog-read.service.ts';
import { TemplateDirectoryService } from './application/template-directory.service.ts';
import { CATALOG_ITEM_DIRECTORY } from './catalog-item-directory.ts';
import { CatalogController } from './http/catalog.controller.ts';
import { DOCUMENT_KIND_DIRECTORY } from './document-kind-directory.ts';
import { TEMPLATE_DIRECTORY } from './template-directory.ts';

@Module({
  controllers: [CatalogController],
  providers: [
    CatalogReadService,
    { provide: TEMPLATE_DIRECTORY, useClass: TemplateDirectoryService },
    { provide: CATALOG_ITEM_DIRECTORY, useClass: CatalogItemDirectoryService },
    { provide: DOCUMENT_KIND_DIRECTORY, useClass: DocumentKindDirectoryService },
  ],
  exports: [TEMPLATE_DIRECTORY, CATALOG_ITEM_DIRECTORY, DOCUMENT_KIND_DIRECTORY],
})
export class CatalogModule {}

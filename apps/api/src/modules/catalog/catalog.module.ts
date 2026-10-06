/**
 * Module `catalog` (ADR-0001): the service catalogue, process and work order templates and document kinds — read-only
 * configuration in M1, owner of the `catalog` schema. It depends only on `platform`; the vocabulary of party kinds is
 * kept in its own code until `parties` exists. The data arrives by data migration (`0008_catalog_seed`).
 */
import { Module } from '@nestjs/common';
import { CatalogReadService } from './application/catalog-read.service.ts';
import { CatalogController } from './http/catalog.controller.ts';

@Module({
  controllers: [CatalogController],
  providers: [CatalogReadService],
})
export class CatalogModule {}

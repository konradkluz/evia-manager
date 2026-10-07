/**
 * Module `work-orders` (ADR-0001, ADR-0017): work orders and their assignments; owner of the `work_orders` schema. In EVM-017
 * it serves the list (W-10); in EVM-022 the creation from a template (the order, its scope copied from the template, the
 * coordinator and the yearly number); the detail and the status commands arrive with EVM-018 and later. It reaches other modules
 * only through their facades: the names of people and the active users through `identity` (`UserDirectory`), the customer through
 * `customers` (`CustomerDirectory`), the site through `sites` (`SiteDirectory`), the template through `catalog`
 * (`TemplateDirectory`). The port `WorkOrderCompositionContributor` lets `procedures` and `payments` join the creation later
 * (they depend on this module, not the other way round).
 */
import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/index.ts';
import { CustomersModule } from '../customers/index.ts';
import { IdentityModule } from '../identity/index.ts';
import { SitesModule } from '../sites/index.ts';
import { CreateWorkOrderService } from './application/create-work-order.service.ts';
import { ListWorkOrdersService } from './application/list-work-orders.service.ts';
import { WorkOrderCompositionRegistry } from './composition-contributor.ts';
import { WorkOrdersController } from './http/work-orders.controller.ts';

@Module({
  imports: [IdentityModule, CatalogModule, CustomersModule, SitesModule],
  controllers: [WorkOrdersController],
  providers: [ListWorkOrdersService, CreateWorkOrderService, WorkOrderCompositionRegistry],
  exports: [WorkOrderCompositionRegistry],
})
export class WorkOrdersModule {}

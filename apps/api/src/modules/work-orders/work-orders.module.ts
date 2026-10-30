/**
 * Module `work-orders` (ADR-0001, ADR-0017): work orders and their assignments; owner of the `work_orders` schema. In EVM-017
 * its list (W-10, EVM-017) moved to `overview` in EVM-034; in EVM-022 the creation from a template (the order, its scope copied from the template, the
 * coordinator and the yearly number); in EVM-018 the four reads of one order for W-06 (header, scope, customer card, site card); in EVM-036
 * the metadata of the other orders of the same site (the section "Inne zlecenia w tej lokalizacji"); in EVM-030 the status command (the table
 * of transitions, `If-Match`, the restoration with a step-up, the audit of a cancellation and a restoration). It reaches other modules
 * only through their facades: the names of people and the active users through `identity` (`UserDirectory`), the customer through
 * `customers` (`CustomerDirectory`), the site through `sites` (`SiteDirectory`), the parties of a site through `parties` (`PartyDirectory`), the template through `catalog`
 * (`TemplateDirectory`). The facade `WorkOrderDirectory` tells `procedures` (EVM-031) whether the caller may see an order and whether it is closed. The port `WorkOrderCompositionContributor` lets `procedures` and `payments` join the creation later
 * (they depend on this module, not the other way round); the port `WorkOrderTransitionParticipant` lets `payments` add the condition and the effect of a
 * status change (EVM-053, EVM-054). In EVM-035 it serves the editing of the data of an order (`PATCH`, `If-Match`) and of its scope (add an item of
 * the catalogue with the processes it brings, change the parameters and the notes, remove an item); the port `WorkOrderScopeParticipant` lets
 * `procedures` add the processes in the same transaction (EVM-060: the deletion and the restoration of an order, Administrator only; the port
 * `WorkOrderDeletionParticipant` lets `payments` block the deletion of an order with an issued invoice and ask for a step-up for a paid one), and the item of the catalogue and its processes come through the facade `CatalogItemDirectory`.
 * In EVM-041 it fills the port of `customers` (`OpenOrdersDependentsGuard`): the open orders of a customer block its deletion and anonymization, and a new order locks its customer `FOR KEY SHARE`.
 */
import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/index.ts';
import { CustomersModule } from '../customers/index.ts';
import { IdentityModule } from '../identity/index.ts';
import { PartiesModule } from '../parties/index.ts';
import { SitesModule } from '../sites/index.ts';
import { CreateScopeItemService } from './application/create-scope-item.service.ts';
import { CreateWorkOrderService } from './application/create-work-order.service.ts';
import { DeleteWorkOrderService } from './application/delete-work-order.service.ts';
import { DeleteScopeItemService } from './application/delete-scope-item.service.ts';
import { OpenOrdersDependentsGuard } from './application/open-orders-dependents-guard.ts';
import { ListSiteOrdersService } from './application/list-site-orders.service.ts';
import { ReadWorkOrderService } from './application/read-work-order.service.ts';
import { RestoreWorkOrderService } from './application/restore-work-order.service.ts';
import { TransitionWorkOrderService } from './application/transition-work-order.service.ts';
import { UpdateScopeItemService } from './application/update-scope-item.service.ts';
import { UpdateWorkOrderService } from './application/update-work-order.service.ts';
import { WorkOrderDirectoryService } from './application/work-order-directory.service.ts';
import { WorkOrderCompositionRegistry } from './composition-contributor.ts';
import { WorkOrdersController } from './http/work-orders.controller.ts';
import { WorkOrderDeletionRegistry } from './deletion-participant.ts';
import { WorkOrderScopeRegistry } from './scope-participant.ts';
import { WorkOrderTransitionRegistry } from './transition-participant.ts';
import { WORK_ORDER_DIRECTORY } from './work-order-directory.ts';
import { WorkOrderProjectionSourceService } from './infrastructure/projection-source.ts';
import { ScopeItemSyncSourceService, WorkOrderSyncSourceService } from './infrastructure/sync-source.ts';
import { SCOPE_ITEM_SYNC_SOURCE, WORK_ORDER_PROJECTION_SOURCE, WORK_ORDER_SYNC_SOURCE } from './system-ports.ts';

@Module({
  imports: [IdentityModule, CatalogModule, CustomersModule, SitesModule, PartiesModule],
  controllers: [WorkOrdersController],
  providers: [
    CreateWorkOrderService,
    ReadWorkOrderService,
    ListSiteOrdersService,
    TransitionWorkOrderService,
    DeleteWorkOrderService,
    RestoreWorkOrderService,
    UpdateWorkOrderService,
    CreateScopeItemService,
    UpdateScopeItemService,
    DeleteScopeItemService,
    WorkOrderCompositionRegistry,
    WorkOrderScopeRegistry,
    WorkOrderTransitionRegistry,
    WorkOrderDeletionRegistry,
    OpenOrdersDependentsGuard,
    { provide: WORK_ORDER_DIRECTORY, useClass: WorkOrderDirectoryService },
    { provide: WORK_ORDER_PROJECTION_SOURCE, useClass: WorkOrderProjectionSourceService },
    { provide: WORK_ORDER_SYNC_SOURCE, useClass: WorkOrderSyncSourceService },
    { provide: SCOPE_ITEM_SYNC_SOURCE, useClass: ScopeItemSyncSourceService },
  ],
  exports: [
    WorkOrderCompositionRegistry,
    WorkOrderScopeRegistry,
    WorkOrderTransitionRegistry,
    WorkOrderDeletionRegistry,
    WORK_ORDER_DIRECTORY,
    WORK_ORDER_PROJECTION_SOURCE,
    WORK_ORDER_SYNC_SOURCE,
    SCOPE_ITEM_SYNC_SOURCE,
  ],
})
export class WorkOrdersModule {}

/**
 * Module `overview` (ADR-0001, ADR-0017; EVM-034): the read model of the list of work orders and of the summary of an order, and
 * owner of the `overview` schema. It holds a PROJECTION — keys, codes, dates and counters per order — that is kept current in the
 * transaction of every change: the handlers of the domain events of `work-orders`, `procedures`, `sites` and `parties` name the
 * orders in the registry of the transaction (`platform`), which recomputes them before COMMIT. The sources are read through the
 * SYSTEM ports of the modules (`modules/<name>/system-ports.ts`: minimal data, no role, no read policy); the list (W-10) applies the read
 * policy of work orders in its own query, and takes the titles from `work-orders` and the names from `identity` in batches. `rebuild` and `verify` are server commands (the CLI), not routes.
 * Nothing depends on this module: the composition root registers it, and no other module imports it.
 */
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/index.ts';
import { PartiesModule } from '../parties/index.ts';
import { ProceduresModule } from '../procedures/index.ts';
import { SitesModule } from '../sites/index.ts';
import { WorkOrdersModule } from '../work-orders/index.ts';
import { ListWorkOrdersService } from './application/list-work-orders.service.ts';
import { ProjectionMaintenance } from './application/projection-maintenance.ts';
import { ProjectionRecomputer } from './application/projection-recomputer.ts';
import { ProjectionRecorder } from './application/projection-recorder.ts';
import { VerifyProjectionJob } from './application/verify-projection.job.ts';
import { WorkOrdersListController } from './http/work-orders-list.controller.ts';

@Module({
  imports: [IdentityModule, WorkOrdersModule, SitesModule, PartiesModule, ProceduresModule],
  controllers: [WorkOrdersListController],
  providers: [ProjectionRecomputer, ProjectionRecorder, ProjectionMaintenance, ListWorkOrdersService, VerifyProjectionJob],
  exports: [ProjectionMaintenance, VerifyProjectionJob],
})
export class OverviewModule {}

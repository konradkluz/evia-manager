/**
 * Module `work-orders` (ADR-0001, ADR-0017): work orders and their assignments; owner of the `work_orders` schema. In EVM-017
 * it serves the list (W-10); creation, the detail and the status commands arrive with EVM-018 – EVM-022. It reads names of
 * people only through the `identity` facade (`UserDirectory`), and customers and sites will come through their own facades.
 */
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/index.ts';
import { ListWorkOrdersService } from './application/list-work-orders.service.ts';
import { WorkOrdersController } from './http/work-orders.controller.ts';

@Module({ imports: [IdentityModule], controllers: [WorkOrdersController], providers: [ListWorkOrdersService] })
export class WorkOrdersModule {}

/**
 * Module `procedures` (ADR-0001, ADR-0017): the processes of a work order and their stages; owner of the `procedures` schema. In
 * EVM-031 it joins the creation of an order (the contributor of the composition: the processes and stages copied from the template),
 * serves the list of the processes for W-06 and the change of the person responsible and the due date of a stage. The status of a
 * stage ("Czekamy na…") arrives with EVM-032, the adding and removing of processes and stages with EVM-042 and EVM-035. It reaches
 * other modules only through their facades: the order and its status through `work-orders` (`WorkOrderDirectory`, and the port
 * `WorkOrderCompositionContributor`), the template through `catalog` (`TemplateDirectory`), the people through `identity`
 * (`UserDirectory`). The audit trail subscribes to its events (`procedures` never imports `audit`).
 */
import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/index.ts';
import { IdentityModule } from '../identity/index.ts';
import { WorkOrdersModule } from '../work-orders/index.ts';
import { ListProceduresService } from './application/list-procedures.service.ts';
import { ProceduresCompositionContributor } from './application/procedures-contributor.ts';
import { UpdateStageService } from './application/update-stage.service.ts';
import { ProceduresController } from './http/procedures.controller.ts';

@Module({
  imports: [IdentityModule, CatalogModule, WorkOrdersModule],
  controllers: [ProceduresController],
  providers: [ListProceduresService, UpdateStageService, ProceduresCompositionContributor],
})
export class ProceduresModule {}

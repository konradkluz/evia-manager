/**
 * Module `procedures` (ADR-0001, ADR-0017): the processes of a work order and their stages; owner of the `procedures` schema. In
 * EVM-031 it joins the creation of an order (the contributor of the composition: the processes and stages copied from the template),
 * serves the list of the processes for W-06, the change of the person responsible, the due date and the party waited for of a stage, and
 * (EVM-032) the status of a stage ("Czekamy na…") as the command of a transition. The processes a scope item brings are added with the item (EVM-035: `ProceduresScopeParticipant`, the port `WorkOrderScopeParticipant`, in the transaction of the item); the manual adding and removing of processes and stages is EVM-042. It reaches
 * other modules only through their facades: the order and its status through `work-orders` (`WorkOrderDirectory`, and the port
 * `WorkOrderCompositionContributor`), the template through `catalog` (`TemplateDirectory`), the people through `identity`
 * (`UserDirectory`), the parties waited for through `parties` (`PartyDirectory`). The audit trail subscribes to its events (`procedures` never imports `audit`).
 * The facade `ProcedureStageDirectory` tells `timeline` (EVM-037) whether a stage is a live stage of an order and names the stages.
 */
import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/index.ts';
import { IdentityModule } from '../identity/index.ts';
import { PartiesModule } from '../parties/index.ts';
import { WorkOrdersModule } from '../work-orders/index.ts';
import { ListProceduresService } from './application/list-procedures.service.ts';
import { ProceduresCompositionContributor } from './application/procedures-contributor.ts';
import { ProceduresScopeParticipant } from './application/procedures-scope-participant.ts';
import { ProcedureStageDirectoryService } from './application/stage-directory.service.ts';
import { TransitionStageService } from './application/transition-stage.service.ts';
import { UpdateStageService } from './application/update-stage.service.ts';
import { ProceduresController } from './http/procedures.controller.ts';
import { PROCEDURE_STAGE_DIRECTORY } from './stage-directory.ts';

@Module({
  imports: [IdentityModule, CatalogModule, WorkOrdersModule, PartiesModule],
  controllers: [ProceduresController],
  providers: [
    ListProceduresService,
    UpdateStageService,
    TransitionStageService,
    ProceduresCompositionContributor,
    ProceduresScopeParticipant,
    { provide: PROCEDURE_STAGE_DIRECTORY, useClass: ProcedureStageDirectoryService },
  ],
  exports: [PROCEDURE_STAGE_DIRECTORY],
})
export class ProceduresModule {}

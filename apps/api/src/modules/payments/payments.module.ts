/**
 * Module `payments` (ADR-0001, ADR-0017; domain-model.md → `PaymentMilestone`): the payment milestones of a work order; owner of the
 * `payments` schema. In EVM-053 it joins the creation of an order (the contributor of the composition: the milestones copied from the
 * payment plan of the template), takes part in the status change of an order (the participant of the transitions: the condition of a
 * settlement and the effect of a cancellation), and serves the section "Płatności" of W-06 — the list with the totals, "Dodaj transzę"
 * and "Zmień kwotę" — on the web channel only (P3). It reaches other modules only through their facades: the order and its status
 * through `work-orders` (`WorkOrderDirectory` and the ports `WorkOrderCompositionContributor`, `WorkOrderTransitionParticipant`), the
 * payment plan through `catalog` (`TemplateDirectory`). The audit trail subscribes to its events (`payments` never imports `audit`).
 * Every write of a milestone goes through ONE point (`infrastructure/milestone-store.ts`), where EVM-056 hooks the read model.
 */
import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/index.ts';
import { WorkOrdersModule } from '../work-orders/index.ts';
import { CreateMilestoneService } from './application/create-milestone.service.ts';
import { ListMilestonesService } from './application/list-milestones.service.ts';
import { PaymentsCompositionContributor } from './application/payments-contributor.ts';
import { PaymentsTransitionParticipant } from './application/payments-transition-participant.ts';
import { UpdateMilestoneService } from './application/update-milestone.service.ts';
import { PaymentsController } from './http/payments.controller.ts';

@Module({
  imports: [CatalogModule, WorkOrdersModule],
  controllers: [PaymentsController],
  providers: [
    ListMilestonesService,
    CreateMilestoneService,
    UpdateMilestoneService,
    PaymentsCompositionContributor,
    PaymentsTransitionParticipant,
  ],
})
export class PaymentsModule {}

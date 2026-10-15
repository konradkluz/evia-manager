/**
 * Module `payments` (ADR-0001, ADR-0017; domain-model.md → `PaymentMilestone`): the payment milestones of a work order; owner of the
 * `payments` schema. In EVM-053 it joins the creation of an order (the contributor of the composition: the milestones copied from the
 * payment plan of the template), takes part in the status change of an order (the participant of the transitions: the condition of a
 * settlement, the block of a cancellation by an invoiced milestone and the effect of a cancellation), and serves the section
 * "Płatności" of W-06 — the list with the totals, "Dodaj transzę", the change of a milestone and its transitions (EVM-054) — on the
 * web channel only (P3). It gives `timeline` the names of its milestones (`PaymentMilestoneDirectory`). It reaches other modules only through their facades: the order and its status
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
import { PaymentMilestoneDirectoryService } from './application/milestone-directory.service.ts';
import { TransitionMilestoneService } from './application/transition-milestone.service.ts';
import { UpdateMilestoneService } from './application/update-milestone.service.ts';
import { PaymentsController } from './http/payments.controller.ts';
import { PAYMENT_MILESTONE_DIRECTORY } from './milestone-directory.ts';

@Module({
  imports: [CatalogModule, WorkOrdersModule],
  controllers: [PaymentsController],
  providers: [
    ListMilestonesService,
    CreateMilestoneService,
    UpdateMilestoneService,
    TransitionMilestoneService,
    PaymentsCompositionContributor,
    PaymentsTransitionParticipant,
    { provide: PAYMENT_MILESTONE_DIRECTORY, useClass: PaymentMilestoneDirectoryService },
  ],
  exports: [PAYMENT_MILESTONE_DIRECTORY],
})
export class PaymentsModule {}

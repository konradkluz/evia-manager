/**
 * Module `payments` (ADR-0001, ADR-0017; domain-model.md → `PaymentMilestone`): the payment milestones of a work order; owner of the
 * `payments` schema. In EVM-053 it joins the creation of an order (the contributor of the composition: the milestones copied from the
 * payment plan of the template), takes part in the status change of an order (the participant of the transitions: the condition of a
 * settlement, the block of a cancellation by an invoiced milestone and the effect of a cancellation), and serves the section
 * "Płatności" of W-06 — the list with the totals, "Dodaj transzę", the change of a milestone and its transitions (EVM-054), the corrections of the Administrator
 * with a step-up and the deletion of a milestone (EVM-057) — on the web channel only (P3). It gives `timeline` the names of its milestones (`PaymentMilestoneDirectory`). It reaches other modules only through their facades: the order and its status
 * through `work-orders` (`WorkOrderDirectory` and the ports `WorkOrderCompositionContributor`, `WorkOrderTransitionParticipant`), the
 * payment plan through `catalog` (`TemplateDirectory`). The audit trail subscribes to its events (`payments` never imports `audit`).
 * Every write of a milestone goes through ONE point (`infrastructure/milestone-store.ts`), and every command that calls it publishes an
 * event naming the order, so the read model (`overview`, EVM-056; P4) recomputes the signals of payments in the same transaction. The
 * read model reads the statuses and the due dates through the system port (`system-ports.ts`, no amount) and the totals of a page
 * through the facade `PaymentTotalsDirectory` (`payment-totals.ts`, under the right to read payments of the caller).
 */
import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/index.ts';
import { CustomersModule } from '../customers/index.ts';
import { WorkOrdersModule } from '../work-orders/index.ts';
import { CreateMilestoneService } from './application/create-milestone.service.ts';
import { DeleteMilestoneService } from './application/delete-milestone.service.ts';
import { ListMilestonesService } from './application/list-milestones.service.ts';
import { ListUnpaidMilestonesService } from './application/list-unpaid-milestones.service.ts';
import { PaymentsCompositionContributor } from './application/payments-contributor.ts';
import { PaymentsDeletionParticipant } from './application/payments-deletion-participant.ts';
import { PaymentsTransitionParticipant } from './application/payments-transition-participant.ts';
import { PaymentMilestoneDirectoryService } from './application/milestone-directory.service.ts';
import { TransitionMilestoneService } from './application/transition-milestone.service.ts';
import { UpdateMilestoneService } from './application/update-milestone.service.ts';
import { PaymentsController } from './http/payments.controller.ts';
import { PaymentTotalsDirectoryService } from './application/payment-totals.service.ts';
import { PaymentProjectionSourceService } from './infrastructure/projection-source.ts';
import { PAYMENT_TOTALS_DIRECTORY } from './payment-totals.ts';
import { PAYMENT_MILESTONE_DIRECTORY } from './milestone-directory.ts';
import { PAYMENT_PROJECTION_SOURCE } from './system-ports.ts';

@Module({
  imports: [CatalogModule, CustomersModule, WorkOrdersModule],
  controllers: [PaymentsController],
  providers: [
    ListMilestonesService,
    ListUnpaidMilestonesService,
    CreateMilestoneService,
    UpdateMilestoneService,
    TransitionMilestoneService,
    DeleteMilestoneService,
    PaymentsCompositionContributor,
    PaymentsTransitionParticipant,
    PaymentsDeletionParticipant,
    { provide: PAYMENT_MILESTONE_DIRECTORY, useClass: PaymentMilestoneDirectoryService },
    { provide: PAYMENT_PROJECTION_SOURCE, useClass: PaymentProjectionSourceService },
    { provide: PAYMENT_TOTALS_DIRECTORY, useClass: PaymentTotalsDirectoryService },
  ],
  exports: [PAYMENT_MILESTONE_DIRECTORY, PAYMENT_PROJECTION_SOURCE, PAYMENT_TOTALS_DIRECTORY],
})
export class PaymentsModule {}

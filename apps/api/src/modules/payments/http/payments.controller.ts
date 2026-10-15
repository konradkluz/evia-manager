/**
 * HTTP surface of the payments module (EVM-053: the milestones of an order with their totals, "Dodaj transzę", "Zmień kwotę"; EVM-054:
 * the transitions of a milestone, the change of the invoice and of the payment; EVM-057: the corrections and the deletion). The handlers
 * contain no authorization — the global guard decides before they run (operation in the manifest, CSRF, channel, role, step-up); here
 * only the call and the headers of the answer. The answers are never cached (the global `Cache-Control: no-store`).
 */
import type { PaymentMilestone, PaymentMilestoneList, UnpaidPaymentMilestoneList } from '@evia/contracts';
import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { entityTag } from '../../../platform/http/if-match.ts';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { requestEventContext, webEventContext } from '../../../platform/http/request-context.ts';
import { CreateMilestoneService } from '../application/create-milestone.service.ts';
import { DeleteMilestoneService } from '../application/delete-milestone.service.ts';
import { ListMilestonesService } from '../application/list-milestones.service.ts';
import { ListUnpaidMilestonesService } from '../application/list-unpaid-milestones.service.ts';
import { TransitionMilestoneService } from '../application/transition-milestone.service.ts';
import { UpdateMilestoneService } from '../application/update-milestone.service.ts';

function requirePrincipal(request: Request): Principal {
  const principal = principalOf(request);
  if (principal === null) throw new ProblemException('unauthenticated');
  return principal;
}

const UNPAID = '/api/v1/payment-milestones';
const MILESTONES = '/api/v1/work-orders/:workOrderId/payment-milestones';

@Controller()
export class PaymentsController {
  readonly #lists: ListMilestonesService;
  readonly #unpaid: ListUnpaidMilestonesService;
  readonly #creations: CreateMilestoneService;
  readonly #updates: UpdateMilestoneService;
  readonly #transitions: TransitionMilestoneService;
  readonly #deletions: DeleteMilestoneService;

  constructor(
    @Inject(ListMilestonesService) lists: ListMilestonesService,
    @Inject(ListUnpaidMilestonesService) unpaid: ListUnpaidMilestonesService,
    @Inject(CreateMilestoneService) creations: CreateMilestoneService,
    @Inject(UpdateMilestoneService) updates: UpdateMilestoneService,
    @Inject(TransitionMilestoneService) transitions: TransitionMilestoneService,
    @Inject(DeleteMilestoneService) deletions: DeleteMilestoneService,
  ) {
    this.#lists = lists;
    this.#unpaid = unpaid;
    this.#creations = creations;
    this.#updates = updates;
    this.#transitions = transitions;
    this.#deletions = deletions;
  }

  @Get(UNPAID)
  @OperationId('listUnpaidPaymentMilestones')
  listUnpaidPaymentMilestones(@Query() query: unknown, @Req() request: Request): Promise<UnpaidPaymentMilestoneList> {
    return this.#unpaid.list(requirePrincipal(request), query, requestEventContext(request));
  }

  @Get(MILESTONES)
  @OperationId('listPaymentMilestones')
  listPaymentMilestones(@Param() params: unknown, @Req() request: Request): Promise<PaymentMilestoneList> {
    return this.#lists.list(requirePrincipal(request), params);
  }

  @Post(MILESTONES)
  @OperationId('createPaymentMilestone')
  @HttpCode(201)
  async createPaymentMilestone(
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PaymentMilestone> {
    const { workOrderId, milestone, replayed } = await this.#creations.create(
      requirePrincipal(request),
      params,
      body,
      idempotencyKey,
      webEventContext(request, response),
    );
    response.set('ETag', entityTag(milestone.version));
    response.set('Location', `/api/v1/work-orders/${workOrderId}/payment-milestones/${milestone.id}`);
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return milestone;
  }

  @Patch(`${MILESTONES}/:milestoneId`)
  @OperationId('updatePaymentMilestone')
  @HttpCode(200)
  async updatePaymentMilestone(
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PaymentMilestone> {
    const { milestone, replayed } = await this.#updates.update(
      requirePrincipal(request),
      params,
      ifMatch,
      body,
      idempotencyKey,
      webEventContext(request, response),
    );
    response.set('ETag', entityTag(milestone.version));
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return milestone;
  }

  @Post(`${MILESTONES}/:milestoneId/transitions`)
  @OperationId('transitionPaymentMilestone')
  @HttpCode(200)
  async transitionPaymentMilestone(
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PaymentMilestone> {
    const { milestone, replayed } = await this.#transitions.transition(
      requirePrincipal(request),
      params,
      ifMatch,
      body,
      idempotencyKey,
      webEventContext(request, response),
    );
    response.set('ETag', entityTag(milestone.version));
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return milestone;
  }

  /** "Usuń transzę…" — a correction of the Administrator with a step-up (EVM-057 AC4): `204`, `Idempotent-Replayed` on a repeat. */
  @Delete(`${MILESTONES}/:milestoneId`)
  @OperationId('deletePaymentMilestone')
  @HttpCode(204)
  async deletePaymentMilestone(
    @Param() params: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const replayed = await this.#deletions.delete(
      requirePrincipal(request),
      params,
      ifMatch,
      idempotencyKey,
      webEventContext(request, response),
    );
    if (replayed) response.set('Idempotent-Replayed', 'true');
  }
}

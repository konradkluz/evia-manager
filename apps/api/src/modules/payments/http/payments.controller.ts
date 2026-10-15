/**
 * HTTP surface of the payments module (EVM-053: the milestones of an order with their totals, "Dodaj transzę", "Zmień kwotę"). The
 * handlers contain no authorization — the global guard decides before they run (operation in the manifest, CSRF, channel, role); here
 * only the call and the headers of the answer. The answers are never cached (the global `Cache-Control: no-store`).
 */
import type { PaymentMilestone, PaymentMilestoneList } from '@evia/contracts';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { entityTag } from '../../../platform/http/if-match.ts';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { webEventContext } from '../../../platform/http/request-context.ts';
import { CreateMilestoneService } from '../application/create-milestone.service.ts';
import { ListMilestonesService } from '../application/list-milestones.service.ts';
import { UpdateMilestoneService } from '../application/update-milestone.service.ts';

function requirePrincipal(request: Request): Principal {
  const principal = principalOf(request);
  if (principal === null) throw new ProblemException('unauthenticated');
  return principal;
}

const MILESTONES = '/api/v1/work-orders/:workOrderId/payment-milestones';

@Controller()
export class PaymentsController {
  readonly #lists: ListMilestonesService;
  readonly #creations: CreateMilestoneService;
  readonly #updates: UpdateMilestoneService;

  constructor(
    @Inject(ListMilestonesService) lists: ListMilestonesService,
    @Inject(CreateMilestoneService) creations: CreateMilestoneService,
    @Inject(UpdateMilestoneService) updates: UpdateMilestoneService,
  ) {
    this.#lists = lists;
    this.#creations = creations;
    this.#updates = updates;
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
}

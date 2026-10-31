/**
 * HTTP surface of the `sync` module (EVM-096): the pull of changes of the phone. The handler contains no authorization - the global guard decides before it runs
 * (the operation in the manifest, the `mobile` channel, the role: Administrator and Editor only, the Bearer token checked in the database, the version of the
 * app). The query is validated here; the user and the device come from the session, never from the query. Every answer is `no-store` (the security headers of
 * the whole API), the `400` and `429` included.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { bearerPrincipalOf } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { RATE_LIMITER, RATE_LIMITS, type RateLimiter } from '../../../platform/http/rate-limiter.ts';
import { webEventContext } from '../../../platform/http/request-context.ts';
import { parseInput } from '../../../platform/http/validation.ts';
import { PushMutationsService, type PushResponse } from '../application/push-mutations.service.ts';
import { SyncChangesService, type PullResponse } from '../application/sync-changes.service.ts';
import { SyncSnapshotService, type WorkOrderSnapshot } from '../application/sync-snapshot.service.ts';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

const query = z.strictObject({
  cursor: z
    .string()
    .min(16)
    .max(1024)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  // A decimal integer from 1: `0`, `-1`, `1.5` and text are a validation error; a value above the maximum is lowered to it (EVM-096 AC7).
  limit: z
    .string()
    .regex(/^[1-9][0-9]{0,8}$/)
    .optional(),
  pendingItems: z
    .string()
    .regex(/^[0-9]{1,7}$/)
    .refine((value) => Number(value) <= 1_000_000)
    .optional(),
});

const snapshotPath = z.strictObject({ workOrderId: z.uuid() });

@Controller()
export class SyncController {
  readonly #changes: SyncChangesService;
  readonly #snapshots: SyncSnapshotService;
  readonly #mutations: PushMutationsService;
  readonly #limiter: RateLimiter;

  constructor(
    @Inject(SyncChangesService) changes: SyncChangesService,
    @Inject(SyncSnapshotService) snapshots: SyncSnapshotService,
    @Inject(PushMutationsService) mutations: PushMutationsService,
    @Inject(RATE_LIMITER) limiter: RateLimiter,
  ) {
    this.#changes = changes;
    this.#snapshots = snapshots;
    this.#mutations = mutations;
    this.#limiter = limiter;
  }

  @Get('/api/v1/sync/changes')
  @OperationId('getSyncChanges')
  getSyncChanges(@Query() raw: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<PullResponse> {
    const principal = bearerPrincipalOf(request);
    if (principal === null) throw new ProblemException('unauthenticated');
    const parsed = parseInput(query, raw);
    const limit = Math.min(parsed.limit === undefined ? DEFAULT_LIMIT : Number(parsed.limit), MAX_LIMIT);
    return this.#changes.pull(principal, { cursor: parsed.cursor, limit }, webEventContext(request, response));
  }

  /** The identifier is validated by the schema (a text that is not a UUID is `400 validation_failed`, never a cast error of the database), then the service decides. */
  @Get('/api/v1/sync/work-orders/:workOrderId')
  @OperationId('getSyncWorkOrder')
  getSyncWorkOrder(
    @Param('workOrderId') workOrderId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WorkOrderSnapshot> {
    const principal = bearerPrincipalOf(request);
    if (principal === null) throw new ProblemException('unauthenticated');
    const parsed = parseInput(snapshotPath, { workOrderId });
    return this.#snapshots.snapshot(principal, parsed.workOrderId, webEventContext(request, response));
  }

  /**
   * The push of a batch of mutations (EVM-098). After the guard (401 / 426 / 403), the batch is counted in the bucket of the DEVICE of the session - 60 per
   * minute, beside the 300 per user of the guard; the key is never a value of the request - and a batch over the limit is `429` with `Retry-After` and no
   * effect at all (not even `pendingItems`), before its envelope is read. A body over 1 MB is `413` from the parser, before the guard.
   */
  @Post('/api/v1/sync/mutations')
  @OperationId('pushSyncMutations')
  @HttpCode(200)
  pushSyncMutations(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<PushResponse> {
    const principal = bearerPrincipalOf(request);
    if (principal?.deviceId === undefined) throw new ProblemException('unauthenticated');
    const decision = this.#limiter.consumeSubject('syncMutationsDevice', principal.deviceId, RATE_LIMITS.syncMutationsDevice);
    if (!decision.allowed) throw new ProblemException('rate_limited', { retryAfterSeconds: decision.retryAfterSeconds });
    return this.#mutations.push(principal, principal.deviceId, body, {
      ...webEventContext(request, response),
      sessionId: principal.sessionId,
    });
  }
}

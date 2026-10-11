/**
 * HTTP surface of the timeline module (EVM-037: the journal of an order — the list, one entry, the creation of an entry, a comment
 * or a correction). The handlers contain no authorization — the global guard decides before they run (operation in the manifest,
 * CSRF, channel, role); here only the call and the headers of the answer. There is NO route that changes or removes an entry: the
 * journal is append-only (D3), so a PATCH, a PUT or a DELETE is a `404` of the router. The answers are never cached (the global
 * `Cache-Control: no-store`).
 */
import type { TimelineEntry, TimelineEntryList } from '@evia/contracts';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { webEventContext } from '../../../platform/http/request-context.ts';
import { CreateEntryService } from '../application/create-entry.service.ts';
import { ListEntriesService } from '../application/list-entries.service.ts';
import { ReadEntryService } from '../application/read-entry.service.ts';

function requirePrincipal(request: Request): Principal {
  const principal = principalOf(request);
  if (principal === null) throw new ProblemException('unauthenticated');
  return principal;
}

@Controller()
export class TimelineController {
  readonly #lists: ListEntriesService;
  readonly #reads: ReadEntryService;
  readonly #creations: CreateEntryService;

  constructor(
    @Inject(ListEntriesService) lists: ListEntriesService,
    @Inject(ReadEntryService) reads: ReadEntryService,
    @Inject(CreateEntryService) creations: CreateEntryService,
  ) {
    this.#lists = lists;
    this.#reads = reads;
    this.#creations = creations;
  }

  @Get('/api/v1/work-orders/:workOrderId/timeline')
  @OperationId('listTimelineEntries')
  listTimelineEntries(@Param() params: unknown, @Query() query: unknown, @Req() request: Request): Promise<TimelineEntryList> {
    return this.#lists.list(requirePrincipal(request), params, query);
  }

  @Get('/api/v1/work-orders/:workOrderId/timeline/:entryId')
  @OperationId('getTimelineEntry')
  getTimelineEntry(@Param() params: unknown, @Req() request: Request): Promise<TimelineEntry> {
    return this.#reads.get(requirePrincipal(request), params);
  }

  @Post('/api/v1/work-orders/:workOrderId/timeline')
  @OperationId('createTimelineEntry')
  @HttpCode(201)
  async createTimelineEntry(
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TimelineEntry> {
    const { entry, replayed } = await this.#creations.create(
      requirePrincipal(request),
      params,
      body,
      idempotencyKey,
      webEventContext(request, response),
    );
    const workOrderId = (params as { workOrderId: string }).workOrderId;
    response.set('Location', `/api/v1/work-orders/${workOrderId}/timeline/${entry.id}`);
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return entry;
  }
}

/**
 * HTTP surface of the audit module (EVM-029): ONE read operation. There is no operation that changes or deletes an event —
 * the trail is append-only (AC6). The handler contains no authorization: the global guard decides before it runs
 * (Administrator, web channel, a step-up within 15 minutes); here only the validation of the query, the call and the response.
 */
import type { AuditEventList } from '@evia/contracts';
import { Controller, Get, Inject, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { webEventContext } from '../../../platform/http/request-context.ts';
import { AuditReadService } from '../application/audit-read.service.ts';

@Controller()
export class AuditController {
  readonly #reads: AuditReadService;

  constructor(@Inject(AuditReadService) reads: AuditReadService) {
    this.#reads = reads;
  }

  @Get('/api/v1/audit/events')
  @OperationId('listAuditEvents')
  listAuditEvents(
    @Query() query: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuditEventList> {
    const principal = principalOf(request);
    if (principal === null) throw new ProblemException('unauthenticated');
    return this.#reads.list(principal, query, webEventContext(request, response));
  }
}

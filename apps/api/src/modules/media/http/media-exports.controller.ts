/**
 * HTTP surface of the ZIP export (EVM-052): the order of an export, its list and state, and the address of the finished archive. The handlers contain no
 * authorization - the global guard decides before they run (operation in the manifest, CSRF, web channel, role, step-up); here only the call and the headers of the
 * answer. The answers are never cached (the global `Cache-Control: no-store`, which also covers the signed address).
 */
import type { CreatedMediaExport, MediaDerivativeUrl, MediaExport, MediaExportList } from '@evia/contracts';
import { Controller, Get, Headers, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { webEventContext } from '../../../platform/http/request-context.ts';
import { MediaExportReadService } from '../application/media-export-read.service.ts';
import { RequestMediaExportService } from '../application/request-media-export.service.ts';

function requirePrincipal(request: Request): Principal {
  const principal = principalOf(request);
  if (principal === null) throw new ProblemException('unauthenticated');
  return principal;
}

const BASE = '/api/v1/work-orders/:workOrderId/media-exports';

@Controller()
export class MediaExportsController {
  readonly #requests: RequestMediaExportService;
  readonly #reads: MediaExportReadService;

  constructor(
    @Inject(RequestMediaExportService) requests: RequestMediaExportService,
    @Inject(MediaExportReadService) reads: MediaExportReadService,
  ) {
    this.#requests = requests;
    this.#reads = reads;
  }

  @Get(BASE)
  @OperationId('listMediaExports')
  listMediaExports(@Param() params: unknown, @Req() request: Request): Promise<MediaExportList> {
    return this.#reads.list(requirePrincipal(request), params);
  }

  @Post(BASE)
  @OperationId('createMediaExport')
  @HttpCode(202)
  async createMediaExport(
    @Param() params: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CreatedMediaExport> {
    const { created, replayed } = await this.#requests.create(
      requirePrincipal(request),
      params,
      idempotencyKey,
      webEventContext(request, response),
    );
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return created;
  }

  @Get(`${BASE}/:exportId`)
  @OperationId('getMediaExport')
  getMediaExport(@Param() params: unknown, @Req() request: Request): Promise<MediaExport> {
    return this.#reads.get(requirePrincipal(request), params);
  }

  @Post(`${BASE}/:exportId/download-url`)
  @OperationId('createMediaExportDownloadUrl')
  @HttpCode(200)
  createMediaExportDownloadUrl(
    @Param() params: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MediaDerivativeUrl> {
    return this.#reads.createDownloadUrl(requirePrincipal(request), params, webEventContext(request, response));
  }
}

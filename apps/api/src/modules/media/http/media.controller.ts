/**
 * HTTP surface of the media module (EVM-044): the batch of media, the list, and the six operations of a multipart upload session. The
 * handlers contain no authorization — the global guard decides before they run (operation in the manifest, CSRF, channel, role); here
 * only the call and the headers of the answer. The answers are never cached (the global `Cache-Control: no-store`, which also covers the
 * signed URL of a part).
 */
import type { MediaAsset, MediaAssetBatch, MediaAssetList, UploadPartList, UploadPartUrl, UploadSession } from '@evia/contracts';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { webEventContext } from '../../../platform/http/request-context.ts';
import { CreateMediaAssetsService } from '../application/create-media-assets.service.ts';
import { CreateUploadSessionService } from '../application/create-upload-session.service.ts';
import { FinishUploadService } from '../application/finish-upload.service.ts';
import { ListMediaAssetsService } from '../application/list-media-assets.service.ts';
import { UploadPartsService } from '../application/upload-parts.service.ts';

function requirePrincipal(request: Request): Principal {
  const principal = principalOf(request);
  if (principal === null) throw new ProblemException('unauthenticated');
  return principal;
}

const BASE = '/api/v1/work-orders/:workOrderId/media-assets';
const SESSION = `${BASE}/:mediaAssetId/upload-sessions/:sessionId`;

@Controller()
export class MediaController {
  readonly #creations: CreateMediaAssetsService;
  readonly #lists: ListMediaAssetsService;
  readonly #sessions: CreateUploadSessionService;
  readonly #parts: UploadPartsService;
  readonly #finish: FinishUploadService;

  constructor(
    @Inject(CreateMediaAssetsService) creations: CreateMediaAssetsService,
    @Inject(ListMediaAssetsService) lists: ListMediaAssetsService,
    @Inject(CreateUploadSessionService) sessions: CreateUploadSessionService,
    @Inject(UploadPartsService) parts: UploadPartsService,
    @Inject(FinishUploadService) finish: FinishUploadService,
  ) {
    this.#creations = creations;
    this.#lists = lists;
    this.#sessions = sessions;
    this.#parts = parts;
    this.#finish = finish;
  }

  @Get(BASE)
  @OperationId('listMediaAssets')
  listMediaAssets(@Param() params: unknown, @Query() query: unknown, @Req() request: Request): Promise<MediaAssetList> {
    return this.#lists.list(requirePrincipal(request), params, query);
  }

  @Post(BASE)
  @OperationId('createMediaAssets')
  @HttpCode(201)
  async createMediaAssets(
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MediaAssetBatch> {
    const { batch, replayed } = await this.#creations.create(
      requirePrincipal(request),
      params,
      body,
      idempotencyKey,
      webEventContext(request, response),
    );
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return batch;
  }

  @Post(`${BASE}/:mediaAssetId/upload-sessions`)
  @OperationId('createUploadSession')
  async createUploadSession(
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UploadSession> {
    const { session, status, replayed } = await this.#sessions.create(requirePrincipal(request), params, body, idempotencyKey);
    response.status(status);
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return session;
  }

  @Get(`${SESSION}/parts`)
  @OperationId('listUploadParts')
  listUploadParts(@Param() params: unknown, @Req() request: Request): Promise<UploadPartList> {
    return this.#parts.list(requirePrincipal(request), params);
  }

  @Get(`${SESSION}/parts/:partNumber/url`)
  @OperationId('getUploadPartUrl')
  getUploadPartUrl(@Param() params: unknown, @Req() request: Request): Promise<UploadPartUrl> {
    return this.#parts.url(requirePrincipal(request), params);
  }

  @Post(`${SESSION}/complete`)
  @OperationId('completeUploadSession')
  @HttpCode(200)
  completeUploadSession(@Param() params: unknown, @Req() request: Request): Promise<MediaAsset> {
    return this.#finish.complete(requirePrincipal(request), params);
  }

  @Post(`${SESSION}/abort`)
  @OperationId('abortUploadSession')
  @HttpCode(204)
  abortUploadSession(@Param() params: unknown, @Req() request: Request): Promise<void> {
    return this.#finish.abort(requirePrincipal(request), params);
  }
}

/**
 * HTTP surface of the documents of an order (EVM-047): the list, the creation, the change (the class of confidentiality, the title, the description, the stage), the six operations of the upload session of the
 * file and the signed address of the download. The handlers contain no authorization - the global guard decides before they run (operation in the
 * manifest, CSRF, channel, role); here only the call and the headers of the answer. The answers are never cached (the global `Cache-Control: no-store`).
 */
import type {
  Document,
  DocumentDownloadUrl,
  DocumentList,
  DocumentUploadSession,
  UploadPartList,
  UploadPartUrl,
  UploadSession,
} from '@evia/contracts';
import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { entityTag } from '../../../platform/http/if-match.ts';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { webEventContext } from '../../../platform/http/request-context.ts';
import { CreateDocumentService } from '../application/create-document.service.ts';
import { CreateUploadSessionService } from '../application/create-upload-session.service.ts';
import { DocumentDownloadUrlService } from '../application/document-download-url.service.ts';
import { FinishUploadService } from '../application/finish-upload.service.ts';
import { ListDocumentsService } from '../application/list-documents.service.ts';
import { MediaErasureService } from '../application/media-erasure.service.ts';
import { UpdateDocumentService } from '../application/update-document.service.ts';
import { UploadPartsService } from '../application/upload-parts.service.ts';

function requirePrincipal(request: Request): Principal {
  const principal = principalOf(request);
  if (principal === null) throw new ProblemException('unauthenticated');
  return principal;
}

const BASE = '/api/v1/work-orders/:workOrderId/documents';
const SESSION = `${BASE}/:documentId/upload-sessions/:sessionId`;

@Controller()
export class DocumentsController {
  readonly #lists: ListDocumentsService;
  readonly #creations: CreateDocumentService;
  readonly #updates: UpdateDocumentService;
  readonly #sessions: CreateUploadSessionService;
  readonly #parts: UploadPartsService;
  readonly #finish: FinishUploadService;
  readonly #downloads: DocumentDownloadUrlService;
  readonly #erasure: MediaErasureService;

  constructor(
    @Inject(ListDocumentsService) lists: ListDocumentsService,
    @Inject(CreateDocumentService) creations: CreateDocumentService,
    @Inject(UpdateDocumentService) updates: UpdateDocumentService,
    @Inject(CreateUploadSessionService) sessions: CreateUploadSessionService,
    @Inject(UploadPartsService) parts: UploadPartsService,
    @Inject(FinishUploadService) finish: FinishUploadService,
    @Inject(DocumentDownloadUrlService) downloads: DocumentDownloadUrlService,
    @Inject(MediaErasureService) erasure: MediaErasureService,
  ) {
    this.#lists = lists;
    this.#creations = creations;
    this.#updates = updates;
    this.#sessions = sessions;
    this.#parts = parts;
    this.#finish = finish;
    this.#downloads = downloads;
    this.#erasure = erasure;
  }

  @Get(BASE)
  @OperationId('listDocuments')
  listDocuments(@Param() params: unknown, @Query() query: unknown, @Req() request: Request): Promise<DocumentList> {
    return this.#lists.list(requirePrincipal(request), params, query);
  }

  @Post(BASE)
  @OperationId('createDocument')
  @HttpCode(201)
  async createDocument(
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Document> {
    const { document, replayed } = await this.#creations.create(
      requirePrincipal(request),
      params,
      body,
      idempotencyKey,
      webEventContext(request, response),
    );
    response.set('ETag', entityTag(document.version));
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return document;
  }

  @Patch(`${BASE}/:documentId`)
  @OperationId('updateDocument')
  async updateDocument(
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Document> {
    const { document } = await this.#updates.update(requirePrincipal(request), params, body, ifMatch, webEventContext(request, response));
    response.set('ETag', entityTag(document.version));
    return document;
  }

  @Delete(`${BASE}/:documentId`)
  @OperationId('deleteDocument')
  @HttpCode(204)
  deleteDocument(@Param() params: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    return this.#erasure.deleteDocument(requirePrincipal(request), params, webEventContext(request, response));
  }

  @Post(`${BASE}/:documentId/restore`)
  @OperationId('restoreDocument')
  @HttpCode(204)
  restoreDocument(@Param() params: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    return this.#erasure.restoreDocument(requirePrincipal(request), params, webEventContext(request, response));
  }

  @Post(`${BASE}/:documentId/purge-file`)
  @OperationId('purgeDocumentFile')
  @HttpCode(204)
  purgeDocumentFile(
    @Param() params: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    return this.#erasure.purgeDocumentFile(requirePrincipal(request), params, ifMatch, webEventContext(request, response));
  }

  @Post(`${BASE}/:documentId/upload-sessions`)
  @OperationId('createDocumentUploadSession')
  async createDocumentUploadSession(
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UploadSession | DocumentUploadSession> {
    const { session, status, replayed } = await this.#sessions.create(requirePrincipal(request), params, body, idempotencyKey, 'document');
    response.status(status);
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return session;
  }

  @Get(`${SESSION}/parts`)
  @OperationId('listDocumentUploadParts')
  listDocumentUploadParts(@Param() params: unknown, @Req() request: Request): Promise<UploadPartList> {
    return this.#parts.list(requirePrincipal(request), params, 'document');
  }

  @Get(`${SESSION}/parts/:partNumber/url`)
  @OperationId('getDocumentUploadPartUrl')
  getDocumentUploadPartUrl(@Param() params: unknown, @Req() request: Request): Promise<UploadPartUrl> {
    return this.#parts.url(requirePrincipal(request), params, 'document');
  }

  @Post(`${SESSION}/complete`)
  @OperationId('completeDocumentUploadSession')
  @HttpCode(200)
  completeDocumentUploadSession(@Param() params: unknown, @Req() request: Request): Promise<Document> {
    return this.#finish.completeDocument(requirePrincipal(request), params);
  }

  @Post(`${SESSION}/abort`)
  @OperationId('abortDocumentUploadSession')
  @HttpCode(204)
  abortDocumentUploadSession(@Param() params: unknown, @Req() request: Request): Promise<void> {
    return this.#finish.abort(requirePrincipal(request), params, 'document');
  }

  @Post(`${BASE}/:documentId/download-url`)
  @OperationId('createDocumentDownloadUrl')
  @HttpCode(200)
  createDocumentDownloadUrl(
    @Param() params: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DocumentDownloadUrl> {
    return this.#downloads.create(requirePrincipal(request), params, webEventContext(request, response));
  }
}

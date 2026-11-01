/**
 * HTTP surface of the documents anchored to a site or a customer (EVM-050): the list and the signed address of the file, for each. Web channel, three roles;
 * the handlers contain no authorization - the global guard decides before they run (operation in the manifest, CSRF, channel, role). Nothing here is under
 * `/sites/{id}/media` or `/sites/{id}/work-orders`: a site never opens the media or the documents of its orders (SR-AUTHZ-08, AB-19).
 */
import type { DocumentDownloadUrl, DocumentList } from '@evia/contracts';
import { Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { webEventContext } from '../../../platform/http/request-context.ts';
import { AnchoredDocumentDownloadUrlService } from '../application/anchored-document-download-url.service.ts';
import { ListAnchoredDocumentsService } from '../application/list-anchored-documents.service.ts';

function requirePrincipal(request: Request): Principal {
  const principal = principalOf(request);
  if (principal === null) throw new ProblemException('unauthenticated');
  return principal;
}

const SITE = '/api/v1/sites/:siteId/documents';
const CUSTOMER = '/api/v1/customers/:customerId/documents';

@Controller()
export class AnchoredDocumentsController {
  readonly #lists: ListAnchoredDocumentsService;
  readonly #downloads: AnchoredDocumentDownloadUrlService;

  constructor(
    @Inject(ListAnchoredDocumentsService) lists: ListAnchoredDocumentsService,
    @Inject(AnchoredDocumentDownloadUrlService) downloads: AnchoredDocumentDownloadUrlService,
  ) {
    this.#lists = lists;
    this.#downloads = downloads;
  }

  @Get(SITE)
  @OperationId('listSiteDocuments')
  listSiteDocuments(@Param() params: unknown, @Query() query: unknown, @Req() request: Request): Promise<DocumentList> {
    return this.#lists.listForSite(requirePrincipal(request), params, query);
  }

  @Post(`${SITE}/:documentId/download-url`)
  @OperationId('createSiteDocumentDownloadUrl')
  @HttpCode(200)
  createSiteDocumentDownloadUrl(
    @Param() params: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DocumentDownloadUrl> {
    return this.#downloads.createForSite(requirePrincipal(request), params, webEventContext(request, response));
  }

  @Get(CUSTOMER)
  @OperationId('listCustomerDocuments')
  listCustomerDocuments(@Param() params: unknown, @Query() query: unknown, @Req() request: Request): Promise<DocumentList> {
    return this.#lists.listForCustomer(requirePrincipal(request), params, query);
  }

  @Post(`${CUSTOMER}/:documentId/download-url`)
  @OperationId('createCustomerDocumentDownloadUrl')
  @HttpCode(200)
  createCustomerDocumentDownloadUrl(
    @Param() params: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DocumentDownloadUrl> {
    return this.#downloads.createForCustomer(requirePrincipal(request), params, webEventContext(request, response));
  }
}

/**
 * HTTP surface of the sites module (EVM-021): the search and the creation. The handlers contain no authorization — the global guard
 * decides before they run (operation in the manifest, CSRF, channel, role); here only the call and the headers of the answer. The
 * answers are never cached (the global `Cache-Control: no-store`).
 */
import type { Site, SiteSearchResult } from '@evia/contracts';
import { Body, Controller, Headers, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { webEventContext } from '../../../platform/http/request-context.ts';
import { CreateSiteService } from '../application/create-site.service.ts';
import { SearchSitesService } from '../application/search-sites.service.ts';

function requirePrincipal(request: Request): Principal {
  const principal = principalOf(request);
  if (principal === null) throw new ProblemException('unauthenticated');
  return principal;
}

@Controller()
export class SitesController {
  readonly #searches: SearchSitesService;
  readonly #creations: CreateSiteService;

  constructor(@Inject(SearchSitesService) searches: SearchSitesService, @Inject(CreateSiteService) creations: CreateSiteService) {
    this.#searches = searches;
    this.#creations = creations;
  }

  @Post('/api/v1/sites/search')
  @OperationId('searchSites')
  @HttpCode(200)
  searchSites(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<SiteSearchResult> {
    return this.#searches.search(requirePrincipal(request), body, webEventContext(request, response));
  }

  @Post('/api/v1/sites')
  @OperationId('createSite')
  @HttpCode(201)
  async createSite(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Site> {
    const { site, replayed } = await this.#creations.create(
      requirePrincipal(request),
      body,
      idempotencyKey,
      webEventContext(request, response),
    );
    response.set('ETag', `"${site.version}"`);
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return site;
  }
}

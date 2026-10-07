/**
 * HTTP surface of the parties module (EVM-021): the search and the creation. The handlers contain no authorization — the global
 * guard decides before they run (operation in the manifest, CSRF, channel, role); here only the call and the headers of the answer.
 * The answers are never cached (the global `Cache-Control: no-store`).
 */
import type { Party, PartySearchResult } from '@evia/contracts';
import { Body, Controller, Headers, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { webEventContext } from '../../../platform/http/request-context.ts';
import { CreatePartyService } from '../application/create-party.service.ts';
import { SearchPartiesService } from '../application/search-parties.service.ts';

function requirePrincipal(request: Request): Principal {
  const principal = principalOf(request);
  if (principal === null) throw new ProblemException('unauthenticated');
  return principal;
}

@Controller()
export class PartiesController {
  readonly #searches: SearchPartiesService;
  readonly #creations: CreatePartyService;

  constructor(@Inject(SearchPartiesService) searches: SearchPartiesService, @Inject(CreatePartyService) creations: CreatePartyService) {
    this.#searches = searches;
    this.#creations = creations;
  }

  @Post('/api/v1/parties/search')
  @OperationId('searchParties')
  @HttpCode(200)
  searchParties(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PartySearchResult> {
    return this.#searches.search(requirePrincipal(request), body, webEventContext(request, response));
  }

  @Post('/api/v1/parties')
  @OperationId('createParty')
  @HttpCode(201)
  async createParty(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Party> {
    const { party, replayed } = await this.#creations.create(
      requirePrincipal(request),
      body,
      idempotencyKey,
      webEventContext(request, response),
    );
    response.set('ETag', `"${party.version}"`);
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return party;
  }
}

/**
 * HTTP surface of the parties module (EVM-021: the search and the creation; EVM-036: the detail and the edit). The handlers contain
 * no authorization — the global guard decides before they run (operation in the manifest, CSRF, channel, role); here only the call
 * and the headers of the answer. The answers are never cached (the global `Cache-Control: no-store`).
 */
import type { Party, PartySearchResult } from '@evia/contracts';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { entityTag } from '../../../platform/http/if-match.ts';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { webEventContext } from '../../../platform/http/request-context.ts';
import { CreatePartyService } from '../application/create-party.service.ts';
import { ReadPartyService } from '../application/read-party.service.ts';
import { SearchPartiesService } from '../application/search-parties.service.ts';
import { UpdatePartyService } from '../application/update-party.service.ts';

function requirePrincipal(request: Request): Principal {
  const principal = principalOf(request);
  if (principal === null) throw new ProblemException('unauthenticated');
  return principal;
}

@Controller()
export class PartiesController {
  readonly #searches: SearchPartiesService;
  readonly #creations: CreatePartyService;
  readonly #reads: ReadPartyService;
  readonly #updates: UpdatePartyService;

  constructor(
    @Inject(SearchPartiesService) searches: SearchPartiesService,
    @Inject(CreatePartyService) creations: CreatePartyService,
    @Inject(ReadPartyService) reads: ReadPartyService,
    @Inject(UpdatePartyService) updates: UpdatePartyService,
  ) {
    this.#searches = searches;
    this.#creations = creations;
    this.#reads = reads;
    this.#updates = updates;
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

  @Get('/api/v1/parties/:partyId')
  @OperationId('getParty')
  async getParty(@Param() params: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<Party> {
    const party = await this.#reads.get(requirePrincipal(request), params);
    response.set('ETag', entityTag(party.version));
    return party;
  }

  @Patch('/api/v1/parties/:partyId')
  @OperationId('updateParty')
  @HttpCode(200)
  async updateParty(
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Party> {
    const { party, replayed } = await this.#updates.update(
      requirePrincipal(request),
      params,
      ifMatch,
      body,
      idempotencyKey,
      webEventContext(request, response),
    );
    response.set('ETag', entityTag(party.version));
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return party;
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

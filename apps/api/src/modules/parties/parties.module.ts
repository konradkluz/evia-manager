/**
 * Module `parties` (ADR-0001, ADR-0017; D4): the counterparties of the company — the distribution system operators (OSD), building
 * managers, experts — as ONE entity with a `kind`; owner of the `parties` schema. In EVM-021 it serves the search and the creation
 * of a party for the new-work-order form (W-05) and, through the `PartyDirectory` facade, the check of the parties of a site; the
 * list, the detail, the edit and the deletion arrive with EVM-036 and EVM-060. It depends on `platform` only (idempotency, rate
 * limit, mass-read control, event bus); the audit trail subscribes to its events (`parties` never imports `audit`).
 */
import { Module } from '@nestjs/common';
import { CreatePartyService } from './application/create-party.service.ts';
import { PartyDirectoryService } from './application/party-directory.service.ts';
import { SearchPartiesService } from './application/search-parties.service.ts';
import { PartiesController } from './http/parties.controller.ts';
import { PARTY_DIRECTORY } from './party-directory.ts';

@Module({
  controllers: [PartiesController],
  providers: [SearchPartiesService, CreatePartyService, { provide: PARTY_DIRECTORY, useClass: PartyDirectoryService }],
  exports: [PARTY_DIRECTORY],
})
export class PartiesModule {}

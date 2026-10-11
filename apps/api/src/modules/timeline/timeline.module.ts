/**
 * Module `timeline` (ADR-0001, ADR-0017; EVM-037): the journal of a work order and owner of the `timeline` schema. In EVM-037 it
 * serves the list of the entries for W-08 (from the newest, a cursor, filters of the kind and the stage), one entry, and the
 * creation of a note, a comment or a correction; the journal is append-only (D3) — the text of an entry cannot be changed by
 * any operation, a correction is a new entry that points at the old one. The events of the journal (EVM-038), the soft delete and
 * the redaction (EVM-040) come with their stories. It reaches other modules only through their facades: the order and its read
 * policy through `work-orders` (`WorkOrderDirectory`), the stage of the order through `procedures` (`ProcedureStageDirectory`), the
 * names of the authors through `identity` (`UserDirectory`). The audit trail subscribes to its events (`timeline` never imports
 * `audit`).
 */
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/index.ts';
import { ProceduresModule } from '../procedures/index.ts';
import { WorkOrdersModule } from '../work-orders/index.ts';
import { CreateEntryService } from './application/create-entry.service.ts';
import { ListEntriesService } from './application/list-entries.service.ts';
import { ReadEntryService } from './application/read-entry.service.ts';
import { TimelineController } from './http/timeline.controller.ts';

@Module({
  imports: [IdentityModule, WorkOrdersModule, ProceduresModule],
  controllers: [TimelineController],
  providers: [ListEntriesService, ReadEntryService, CreateEntryService],
})
export class TimelineModule {}

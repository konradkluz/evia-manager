/**
 * Module `timeline` (ADR-0001, ADR-0017; EVM-037): the journal of a work order and owner of the `timeline` schema. In EVM-037 it
 * serves the list of the entries for W-08 (from the newest, a cursor, filters of the kind and the stage), one entry, and the
 * creation of a note, a comment or a correction; the journal is append-only (D3) — the text of an entry cannot be changed by
 * any operation, a correction is a new entry that points at the old one. The events of the journal (EVM-038: the creation of an order, the
 * status of an order and of a stage, "waiting for", the person responsible and the due date) are written by `JournalEventRecorder`,
 * which subscribes to the domain events of `work-orders` and `procedures` and writes in the transaction of the change. The Administrator hides an
 * entry (soft delete), brings it back and redacts its text (EVM-040; the text becomes a marker, after the record in the register of deletions
 * of `platform`, which `timeline` reaches through the port only). It reaches other modules only through their facades: the order and its read
 * policy through `work-orders` (`WorkOrderDirectory`), the stage of the order through `procedures` (`ProcedureStageDirectory`), the
 * names of the authors through `identity` (`UserDirectory`), the name and the kind of a party waited for through `parties`
 * (`PartyDirectory`, the read policy of the caller). The audit trail subscribes to its events (`timeline` never imports `audit`).
 */
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/index.ts';
import { PartiesModule } from '../parties/index.ts';
import { PaymentsModule } from '../payments/index.ts';
import { ProceduresModule } from '../procedures/index.ts';
import { WorkOrdersModule } from '../work-orders/index.ts';
import { CreateEntryService } from './application/create-entry.service.ts';
import { DeleteEntryService } from './application/delete-entry.service.ts';
import { EntryPresenter } from './application/entry-page.ts';
import { ListEntriesService } from './application/list-entries.service.ts';
import { JournalEventRecorder } from './application/record-journal-event.ts';
import { ReadEntryService } from './application/read-entry.service.ts';
import { RedactEntryService } from './application/redact-entry.service.ts';
import { RestoreEntryService } from './application/restore-entry.service.ts';
import { TimelineController } from './http/timeline.controller.ts';
import { TimelineEntrySyncSourceService } from './infrastructure/sync-source.ts';
import { TIMELINE_ENTRY_SYNC_SOURCE } from './system-ports.ts';

@Module({
  imports: [IdentityModule, PartiesModule, WorkOrdersModule, ProceduresModule, PaymentsModule],
  controllers: [TimelineController],
  providers: [
    EntryPresenter,
    JournalEventRecorder,
    ListEntriesService,
    ReadEntryService,
    CreateEntryService,
    DeleteEntryService,
    RestoreEntryService,
    RedactEntryService,
    { provide: TIMELINE_ENTRY_SYNC_SOURCE, useClass: TimelineEntrySyncSourceService },
  ],
  exports: [TIMELINE_ENTRY_SYNC_SOURCE],
})
export class TimelineModule {}

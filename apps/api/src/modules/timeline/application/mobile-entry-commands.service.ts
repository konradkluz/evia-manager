/**
 * A note or a comment written on the phone (EVM-098 AC2, AC3; SR-INPUT-01, SR-INPUT-02, SR-AUTHZ-04, CWE-915): the implementation of the port
 * `MOBILE_ENTRY_COMMANDS`. The same rules as the panel - `resolveCreateEntry` normalises and measures the text and checks the category, the stage must be a
 * live stage of THIS order - and the same write (`EntryWriter`: INSERT only, `timeline_entry.created`). The origin is `mobile`, the author and the device
 * are those of the session. Every refusal is a code, never a pointer or a value (the text may name a person, SR-ERR-02); nothing throws a problem of the
 * panel (`unknown_stage`, `read_only_field`), so the caller maps a result, not an exception.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { EventContext } from '../../../platform/events/event-bus.ts';
import { resolveCreateEntry } from '../domain/create-entry-rules.ts';
import { timelineTables } from '../infrastructure/tables.ts';
import { matchesOwnEntry } from '../infrastructure/timeline-store.ts';
import type { MobileAuthor, MobileEntryCommand, MobileEntryCommands, MobileEntryResult, OwnEntry } from '../system-ports.ts';
import { EntryWriter } from './entry-writer.ts';

@Injectable()
export class MobileEntryCommandsService implements MobileEntryCommands {
  readonly #writer: EntryWriter;

  constructor(@Inject(EntryWriter) writer: EntryWriter) {
    this.#writer = writer;
  }

  async create(tx: Kysely<Database>, author: MobileAuthor, command: MobileEntryCommand, context: EventContext): Promise<MobileEntryResult> {
    const resolved = resolveCreateEntry({
      id: command.id,
      kind: command.kind,
      noteCategory: command.noteCategory,
      body: command.body,
      procedureStageId: command.procedureStageId,
    });
    if (!resolved.ok) return 'invalid';
    const stageId = command.procedureStageId ?? null;
    if (stageId !== null && !(await this.#writer.stageInOrder(tx, command.workOrderId, stageId))) return 'invalid';
    const row = await this.#writer.write(
      tx,
      {
        id: resolved.command.id,
        workOrderId: command.workOrderId,
        kind: resolved.command.kind,
        noteCategory: resolved.command.noteCategory,
        body: resolved.command.body,
        procedureStageId: stageId,
        supersedesEntryId: null,
        authorUserId: author.userId,
        origin: 'mobile',
        capturedAt: command.capturedAt,
        createdViaDeviceId: author.deviceId,
      },
      context,
    );
    return row === undefined ? 'id_conflict' : 'applied';
  }

  matchesOwnEntry(tx: Kysely<Database>, query: OwnEntry): Promise<boolean> {
    return matchesOwnEntry(timelineTables(tx), {
      id: query.id,
      kind: query.kind,
      workOrderId: query.workOrderId,
      userId: query.author.userId,
      deviceId: query.author.deviceId,
      createdBefore: query.createdBefore,
    });
  }
}

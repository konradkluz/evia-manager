/**
 * The write of a new entry shared by the panel (`CreateEntryService`, EVM-037) and the phone (`MobileEntryCommandsService`, EVM-098): ONE place that
 * checks the stage against the order, inserts the row (INSERT only) and publishes `timeline_entry.created` for the audit trail, in the transaction of the
 * caller. The rules of the content (`resolveCreateEntry`) are applied by the caller before, so both channels normalise the text the same way.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { CLOCK, EVENT_BUS } from '../../../platform/tokens.ts';
import { PROCEDURE_STAGE_DIRECTORY, type ProcedureStageDirectory } from '../../procedures/index.ts';
import { timelineTables } from '../infrastructure/tables.ts';
import { insertEntry, type EntryRow, type NewEntry } from '../infrastructure/timeline-store.ts';
import { entryEvent } from './entry-event.ts';

@Injectable()
export class EntryWriter {
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #stages: ProcedureStageDirectory;

  constructor(
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(PROCEDURE_STAGE_DIRECTORY) stages: ProcedureStageDirectory,
  ) {
    this.#clock = clock;
    this.#events = events;
    this.#stages = stages;
  }

  /** Is the stage a live stage of THIS order? Locked `FOR SHARE` until the transaction ends; another order's, a missing and a deleted stage are all `false`. */
  stageInOrder(tx: Kysely<Database>, workOrderId: string, stageId: string): Promise<boolean> {
    return this.#stages.existsInOrder(tx, workOrderId, stageId, { lock: true });
  }

  /** @returns the inserted row, or `undefined` when the identifier exists already (nothing is written, no event) */
  async write(tx: Kysely<Database>, entry: NewEntry, context: EventContext): Promise<EntryRow | undefined> {
    const row = await insertEntry(timelineTables(tx), entry, this.#clock.now());
    if (row === undefined) return undefined;
    await this.#events.publish(tx, entryEvent('timeline_entry.created', { userId: entry.authorUserId }, row.id, 'success'), context);
    return row;
  }
}

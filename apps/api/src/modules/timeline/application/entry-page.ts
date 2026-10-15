/**
 * The lookups that an answer of the journal needs, in the transaction of the caller (EVM-037 AC1–AC3, AC6; EVM-038 AC3; SR-DATA-03):
 * the names of the authors (`identity`), the names of the stages (`procedures`), the names and the kinds of the parties that an event
 * says are waited for (`parties`, through the read policy of the CALLER) and the corrections of the entries — each looked up ONCE for
 * the whole page, so the number of queries does not depend on the number of entries (no N+1). The shape of the answer itself is
 * `entry-representation.ts`. A party the caller may not see, or one that is deleted, comes without name and kind: the event holds
 * only its identifier.
 */
import type { TimelineEntry, TimelineEntryList } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { UserDirectory } from '../../identity/index.ts';
import { PARTY_DIRECTORY, type PartyDirectory } from '../../parties/index.ts';
import { PAYMENT_MILESTONE_DIRECTORY, type PaymentMilestoneDirectory } from '../../payments/index.ts';
import { PROCEDURE_STAGE_DIRECTORY, type ProcedureStageDirectory } from '../../procedures/index.ts';
import { readJournalEvent } from '../domain/event-payload.ts';
import { timelineTables } from '../infrastructure/tables.ts';
import { correctionsOf, type EntryRow } from '../infrastructure/timeline-store.ts';
import { toTimelineEntry, toTimelineEntryList, type RepresentationBatch } from './entry-representation.ts';

/** The identifiers of the parties that the events among `rows` wait for and of the payment milestones they are about (each once). */
function referencedObjects(rows: readonly EntryRow[]): { readonly partyIds: string[]; readonly milestoneIds: string[] } {
  const parties = new Set<string>();
  const milestones = new Set<string>();
  for (const row of rows) {
    if (row.kind !== 'event' || row.event_code === null) continue;
    const { waitingOnPartyId, objectType, objectId } = readJournalEvent(row.event_code, row.event_payload);
    if (waitingOnPartyId !== null) parties.add(waitingOnPartyId);
    if (objectType === 'payment_milestone' && objectId !== null) milestones.add(objectId);
  }
  return { partyIds: [...parties], milestoneIds: [...milestones] };
}

@Injectable()
export class EntryPresenter {
  readonly #users: UserDirectory;
  readonly #stages: ProcedureStageDirectory;
  readonly #parties: PartyDirectory;
  readonly #milestones: PaymentMilestoneDirectory;

  constructor(
    @Inject(UserDirectory) users: UserDirectory,
    @Inject(PROCEDURE_STAGE_DIRECTORY) stages: ProcedureStageDirectory,
    @Inject(PARTY_DIRECTORY) parties: PartyDirectory,
    @Inject(PAYMENT_MILESTONE_DIRECTORY) milestones: PaymentMilestoneDirectory,
  ) {
    this.#users = users;
    this.#stages = stages;
    this.#parties = parties;
    this.#milestones = milestones;
  }

  async #batchFor(
    tx: Kysely<Database>,
    principal: Principal,
    workOrderId: string,
    rows: readonly EntryRow[],
  ): Promise<RepresentationBatch> {
    const authorIds = [...new Set(rows.flatMap((row) => (row.created_by === null ? [] : [row.created_by])))];
    const stageIds = [...new Set(rows.flatMap((row) => (row.procedure_stage_id === null ? [] : [row.procedure_stage_id])))];
    const { partyIds, milestoneIds } = referencedObjects(rows);
    return {
      authors: await this.#users.displayNamesOf(authorIds, tx),
      stageNames: await this.#stages.namesOf(tx, workOrderId, stageIds),
      partyNames: partyIds.length === 0 ? new Map() : await this.#parties.namesOf(tx, principal, partyIds),
      partyKinds: partyIds.length === 0 ? new Map() : await this.#parties.kindsOf(tx, principal, partyIds),
      // EVM-054 AC3: the CURRENT names of the milestones of THIS order (one query for the page; a deleted one has none)
      milestoneNames: milestoneIds.length === 0 ? new Map() : await this.#milestones.namesOf(tx, workOrderId, milestoneIds),
      corrections: await correctionsOf(
        timelineTables(tx),
        workOrderId,
        rows.map((row) => row.id),
      ),
    };
  }

  async entry(tx: Kysely<Database>, principal: Principal, workOrderId: string, row: EntryRow): Promise<TimelineEntry> {
    return toTimelineEntry(row, await this.#batchFor(tx, principal, workOrderId, [row]));
  }

  async page(
    tx: Kysely<Database>,
    principal: Principal,
    workOrderId: string,
    rows: readonly EntryRow[],
    nextCursor: string | null,
  ): Promise<TimelineEntryList> {
    return toTimelineEntryList(rows, await this.#batchFor(tx, principal, workOrderId, rows), nextCursor);
  }
}

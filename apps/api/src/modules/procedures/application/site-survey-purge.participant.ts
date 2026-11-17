/**
 * `procedures` as a participant of the automatic purge of a site survey (EVM-139 AC2; the port `SiteSurveyPurgeParticipant`; SR-PRIV-11, SR-PRIV-03; ADR-0024 pt 4 lets a
 * survey hold processes): the free text of the stages of the order - the reason of a block, the notes and the name of a stage typed by hand (EVM-042: free text that may name
 * a person; the names copied from a template are catalogue data and stay) - is erased in the transaction of the job, deleted stages too. The columns are nullable (`blocked_reason`,
 * `notes`) or `NOT NULL` with a CHECK of the length (`name`), so the name becomes the neutral word of the constant, not NULL. `version + 1`: the phones get the change through the
 * trigger of the change log. Nothing is returned or logged; there are no files, so no work after the commit.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { SYSTEM_ACTOR_ID } from '../../../platform/system-actor.ts';
import {
  SiteSurveyPurgeRegistry,
  type AfterCommit,
  type SiteSurveyPurgeParticipant,
  type SurveyPurgeContext,
  type SurveyPurgeIdentity,
} from '../../work-orders/index.ts';
import { procedureTables } from '../infrastructure/tables.ts';

/** The neutral name of a stage that was typed by hand and is erased (the column is `NOT NULL`). */
export const ERASED_STAGE_NAME = 'Etap';

@Injectable()
export class ProceduresSurveyPurgeParticipant implements SiteSurveyPurgeParticipant, OnModuleInit {
  readonly name = 'procedures';
  readonly order = 300;
  readonly #registry: SiteSurveyPurgeRegistry;

  constructor(@Inject(SiteSurveyPurgeRegistry) registry: SiteSurveyPurgeRegistry) {
    this.#registry = registry;
  }

  onModuleInit(): void {
    this.#registry.register(this);
  }

  identify(): Promise<SurveyPurgeIdentity> {
    return Promise.resolve({ mediaAssetIds: [], holdsSite: false });
  }

  async erase(tx: Kysely<Database>, context: SurveyPurgeContext): Promise<AfterCommit | undefined> {
    await procedureTables(tx)
      .updateTable('procedures.procedure_stages')
      .set({
        blocked_reason: null,
        notes: null,
        name: sql<string>`case when source_stage_template_id is null then ${ERASED_STAGE_NAME} else name end`,
        updated_at: context.now,
        updated_by: SYSTEM_ACTOR_ID,
        version: sql<number>`version + 1`,
      })
      .where('work_order_id', '=', context.workOrderId)
      .execute();
    return undefined;
  }
}

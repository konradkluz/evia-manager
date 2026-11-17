/**
 * `timeline` as a participant of the automatic purge of a site survey (EVM-139 AC2; the port `SiteSurveyPurgeParticipant`; SR-PRIV-11, SR-PRIV-03; ADR-0003): every note and
 * comment of the order - the free text that may name a person - is redacted the way of EVM-040 (the text becomes "Treść usunięta przez administratora DD.MM.RRRR.", the
 * time and the author of the redaction are written, the trigger of 0042 allows it once). The events of the journal hold no text and stay. Nothing is returned or logged.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { SYSTEM_ACTOR_ID } from '../../../platform/system-actor.ts';
import {
  SiteSurveyPurgeRegistry,
  type AfterCommit,
  type SiteSurveyPurgeParticipant,
  type SurveyPurgeContext,
  type SurveyPurgeIdentity,
} from '../../work-orders/index.ts';
import { redactionMarker } from '../domain/redaction-marker.ts';
import { timelineTables } from '../infrastructure/tables.ts';
import { redactEntriesOfOrder } from '../infrastructure/timeline-store.ts';

@Injectable()
export class TimelineSurveyPurgeParticipant implements SiteSurveyPurgeParticipant, OnModuleInit {
  readonly name = 'timeline';
  readonly order = 200;
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
    await redactEntriesOfOrder(timelineTables(tx), context.workOrderId, redactionMarker(context.now), SYSTEM_ACTOR_ID, context.now);
    return undefined;
  }
}

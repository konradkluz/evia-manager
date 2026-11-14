/**
 * A medium created on the phone (EVM-131 AC3; SR-SYNC-01, SR-SYNC-02, SR-SYNC-05, SR-INPUT-01, SR-INPUT-02, SR-LOG-03, CWE-639, CWE-915): the implementation of the port
 * `MOBILE_MEDIA_COMMANDS`. The rules of the metadata are the ones of the batch of the panel (`resolveNewMediaMetadata`), the stage must be a live stage of THIS order (read `FOR SHARE`,
 * ONE answer for a stranger's, a deleted and a missing one), and the write is INSERT only (`insertMediaAsset`: an existing identifier - of any order, of any user - is `id_conflict`,
 * never an upsert; nothing of the existing row is read). The origin is `mobile` and the creator is the user of the SESSION. The medium has NO file yet: the file is declared in
 * the upload session (`createUploadSession`, `file`). The audit event `media_asset.created` and the entry of the journal carry identifiers only - never the description.
 * Every refusal is a code, never a pointer or a value.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { CLOCK, EVENT_BUS } from '../../../platform/tokens.ts';
import { PROCEDURE_STAGE_DIRECTORY, type ProcedureStageDirectory } from '../../procedures/index.ts';
import { resolveNewMediaMetadata } from '../domain/media-metadata-rules.ts';
import type { MediaAssetsAddedEvent, MediaAuditEvent } from '../events.ts';
import { insertMediaAsset } from '../infrastructure/media-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';
import type { MobileMediaAuthor, MobileMediaCommand, MobileMediaCommands, MobileMediaResult } from '../system-ports.ts';

@Injectable()
export class MobileMediaCommandsService implements MobileMediaCommands {
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

  async create(
    tx: Kysely<Database>,
    author: MobileMediaAuthor,
    command: MobileMediaCommand,
    context: EventContext,
  ): Promise<MobileMediaResult> {
    const metadata = resolveNewMediaMetadata({ category: command.category, description: command.description });
    if (!metadata.ok) return 'invalid';
    if (
      command.procedureStageId !== undefined &&
      !(await this.#stages.existsInOrder(tx, command.workOrderId, command.procedureStageId, { lock: true }))
    ) {
      return 'invalid';
    }
    const inserted = await insertMediaAsset(
      mediaTables(tx),
      {
        id: command.id,
        workOrderId: command.workOrderId,
        mediaType: command.mediaType,
        category: metadata.category,
        description: metadata.description,
        procedureStageId: command.procedureStageId ?? null,
        createdBy: author.userId,
        origin: 'mobile',
        capturedAt: command.capturedAt,
      },
      this.#clock.now(),
    );
    if (!inserted) return 'id_conflict';
    const actor = { type: 'user', userId: author.userId } as const;
    const added: MediaAssetsAddedEvent = {
      type: 'media.assets_added',
      actor,
      outcome: 'success',
      workOrderId: command.workOrderId,
      mediaAssetIds: [command.id],
    };
    await this.#events.publish(tx, added, context);
    const audited: MediaAuditEvent = {
      type: 'media_asset.created',
      actor,
      outcome: 'success',
      objectType: 'media_asset',
      objectId: command.id,
    };
    await this.#events.publish(tx, audited, context);
    return 'applied';
  }
}

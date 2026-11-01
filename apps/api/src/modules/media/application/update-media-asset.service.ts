/**
 * "Edytuj opis", "Kategoria", "Etap" - the metadata of a medium (EVM-048 AC2, AC4, AC6, AC7; SR-AUTHZ-01, SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05, SR-INPUT-01,
 * SR-INPUT-02, SR-INPUT-05, SR-LOG-03, SR-ERR-01; TM-17, TM-18, TM-21). The guard has decided before this runs: a signed-in Administrator or Editor on the
 * web channel with a valid CSRF token - Read-only gets 403 and a mobile token 403 without reaching `If-Match` or the body.
 *
 * ONE transaction. The order: the path (`400`); the order through the read policy (`404`; a settled or cancelled order still accepts the change, PO-8);
 * `If-Match` (`428` missing, `400` malformed); the medium of THIS order under a row lock (`404`: another order's medium, a document with that id and a
 * missing one are the same absence); the body (`400`: the fields of the server are `read_only_field`, the others `unknown_field`, an empty body
 * `validation_failed`; the description is plain text); the version (`412 version_conflict`, the data stay); the stage - a live stage of THIS order, read
 * under a lock by the facade of `procedures` (`400 validation_failed` at `/procedureStageId`: a stranger's, a deleted and a missing stage are ONE answer);
 * the update (`version + 1`) and ONE audit event in the same transaction. A request that changes nothing is `200` without a new version and without an
 * event. The audit event names the actor and the medium - never the description or the name of the stage; an error of the facade rolls everything back.
 */
import type { MediaAsset } from '@evia/contracts';
import { zUpdateMediaAssetBody, zUpdateMediaAssetPath } from '@evia/contracts/zod';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { parseIfMatch } from '../../../platform/http/if-match.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { canManageQuarantine } from '../../authorization/index.ts';
import { PROCEDURE_STAGE_DIRECTORY, type ProcedureStageDirectory } from '../../procedures/index.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { MEDIA_DESCRIPTION_MAX, isEmpty, normaliseDescription, realChange } from '../domain/metadata-patch.ts';
import type { MediaAuditEvent } from '../events.ts';
import { findAssetWithFile, lockAssetOfOrder, updateAssetMetadata, type AssetChange } from '../infrastructure/media-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';
import { toMediaAsset } from './media-support.ts';
import { assertStageInOrder, stageNames } from './stage-support.ts';

const pathSchema = strictObjects(zUpdateMediaAssetPath);
const bodySchema = strictObjects(zUpdateMediaAssetBody);
/** Everything the client may name in vain: the fields of the medium that are the server's (`mediaType`, `fileState`, `workOrderId`, `version` ...). */
const READ_ONLY_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'workOrderId',
  'mediaType',
  'origin',
  'capturedAt',
  'createdAt',
  'createdBy',
  'updatedAt',
  'updatedBy',
  'version',
  'procedureStageName',
  'fileState',
  'stateReasonCode',
  'processingFailed',
  'needsAttention',
  'quarantine',
  'quarantineReasonCode',
  'declaredSize',
  'durationSeconds',
  'avScanned',
  'originalFilename',
  'uploadSession',
  'objectKey',
]);

interface Body {
  readonly category?: string;
  readonly description?: string | null;
  readonly procedureStageId?: string | null;
}

export interface UpdatedMedia {
  readonly asset: MediaAsset;
}

@Injectable()
export class UpdateMediaAssetService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #orders: WorkOrderDirectory;
  readonly #stages: ProcedureStageDirectory;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(PROCEDURE_STAGE_DIRECTORY) stages: ProcedureStageDirectory,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#orders = orders;
    this.#stages = stages;
  }

  async update(
    principal: Principal,
    rawParams: unknown,
    rawBody: unknown,
    ifMatch: string | undefined,
    context: EventContext,
  ): Promise<UpdatedMedia> {
    const { workOrderId, mediaAssetId } = parseInput(pathSchema, rawParams) as { workOrderId: string; mediaAssetId: string };
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.findVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');
      const expectedVersion = parseIfMatch(ifMatch);
      const tables = mediaTables(tx);
      const current = await lockAssetOfOrder(tables, order.id, mediaAssetId);
      if (current === undefined) throw new ProblemException('not_found');
      const body = parseInput(bodySchema, rawBody, READ_ONLY_FIELDS) as Body;
      if (Object.keys(body).length === 0) {
        throw new ProblemException('validation_failed', { errors: [{ pointer: '', code: 'required' }] });
      }
      const description = normaliseDescription(body.description, MEDIA_DESCRIPTION_MAX);
      if (!description.ok) throw new ProblemException('validation_failed', { errors: [description.issue] });
      if (current.version !== expectedVersion) throw new ProblemException('version_conflict');

      const change: AssetChange = realChange(
        { category: body.category, description: description.value, procedureStageId: body.procedureStageId },
        { category: current.category, description: current.description, procedureStageId: current.procedure_stage_id },
      );
      if (change.procedureStageId !== undefined && change.procedureStageId !== null) {
        await assertStageInOrder(tx, this.#stages, order.id, change.procedureStageId, '/procedureStageId');
      }
      if (!isEmpty(change)) {
        const version = await updateAssetMetadata(tables, mediaAssetId, expectedVersion, change, principal.userId, this.#clock.now());
        if (version === undefined) throw new ProblemException('version_conflict');
        const audited: MediaAuditEvent = {
          type: 'media_asset.metadata_updated',
          actor: { type: 'user', userId: principal.userId },
          outcome: 'success',
          objectType: 'media_asset',
          objectId: mediaAssetId,
        };
        await this.#events.publish(tx, audited, request);
      }
      const fresh = await findAssetWithFile(tables, order.id, mediaAssetId);
      if (fresh === undefined) throw new ProblemException('not_found');
      const names = await stageNames(tx, this.#stages, [{ workOrderId: order.id, stageId: fresh.asset.procedure_stage_id }]);
      return { asset: toMediaAsset(fresh, { unfinished: false, manageQuarantine: canManageQuarantine(principal), stageNames: names }) };
    });
  }
}

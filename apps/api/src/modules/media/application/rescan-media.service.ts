/**
 * "Skanuj ponownie" - the new scan of a file held in quarantine (EVM-049 AC3, AC4, AC8; P5; SR-SESS-08, SR-AUTHZ-02, SR-AUTHZ-05, SR-ERR-01, SR-API-07).
 * The only operation that changes the state of a quarantined file: there is no release and no bypass of the scan. The guard has decided before this
 * runs (Administrator, web channel, a fresh step-up, CSRF): an Editor and a Read-only user get `403 forbidden` without any read of the state, an
 * Administrator with an old authentication `403 step_up_required`.
 *
 * ONE transaction. The order: the path (`400`); the order of the path through the read policy (`404`); the chain order -> medium -> file in ONE statement
 * with the row of the file locked (`404`: a medium of another order is not found, and the answer is the one of a missing one); the `Idempotency-Key`
 * (`400`); the idempotency port (a repeat returns the stored result BEFORE the writes: no second event); then the compare-and-set of the file:
 * `quarantined` -> `scanning`, only while the file is not purged and before its deadline (30 days from the FIRST entry - a late request is `409
 * invalid_state_transition`, so a rescan cannot race the retention or extend it); every other state - `scanning`, `clean`, `purged` - is the same `409`.
 * The audit event `media_file.rescan_requested` (the Administrator as the actor) is written in the same transaction. The worker takes the file at once and
 * runs the SAME pipeline as the first scan; this service sends nothing to a queue (the table is the queue).
 */
import type { MediaAsset } from '@evia/contracts';
import { zRescanMediaAssetPath } from '@evia/contracts/zod';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';
import { IDEMPOTENCY, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { canManageQuarantine } from '../../authorization/index.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { PROCEDURE_STAGE_DIRECTORY, type ProcedureStageDirectory } from '../../procedures/index.ts';
import type { MediaAuditEvent } from '../events.ts';
import { findAssetWithFile, requestRescan } from '../infrastructure/media-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';
import { idempotencyKeyOf, toMediaAsset } from './media-support.ts';
import { stageNames } from './stage-support.ts';

export const RESCAN_SCOPE = 'POST /api/v1/work-orders/{workOrderId}/media-assets/{mediaAssetId}/rescan';
const scopeOf = (workOrderId: string, mediaAssetId: string): string =>
  RESCAN_SCOPE.replace('{workOrderId}', workOrderId).replace('{mediaAssetId}', mediaAssetId);

const pathSchema = strictObjects(zRescanMediaAssetPath);

export interface RescanRequested {
  readonly asset: MediaAsset;
  readonly replayed: boolean;
}

@Injectable()
export class RescanMediaService {
  readonly #db: Kysely<Database>;
  readonly #stages: ProcedureStageDirectory;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;
  readonly #orders: WorkOrderDirectory;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(PROCEDURE_STAGE_DIRECTORY) stages: ProcedureStageDirectory,
  ) {
    this.#stages = stages;
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
    this.#orders = orders;
  }

  async rescan(principal: Principal, rawParams: unknown, rawKey: string | undefined, context: EventContext): Promise<RescanRequested> {
    const { workOrderId, mediaAssetId } = parseInput(pathSchema, rawParams) as { workOrderId: string; mediaAssetId: string };
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.findVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');
      const tables = mediaTables(tx);
      const found = await findAssetWithFile(tables, order.id, mediaAssetId, true);
      if (found === undefined) throw new ProblemException('not_found');
      const key = idempotencyKeyOf(rawKey);

      const perform = async () => {
        if (!(await requestRescan(tables, found.file.id, this.#clock.now()))) throw new ProblemException('invalid_state_transition');
        const event: MediaAuditEvent = {
          type: 'media_file.rescan_requested',
          actor: { type: 'user', userId: principal.userId },
          outcome: 'success',
          objectType: 'media_asset',
          objectId: mediaAssetId,
        };
        await this.#events.publish(tx, event, request);
        return { value: undefined, result: { status: 202, code: 'rescan_requested', resourceId: mediaAssetId } };
      };
      const { replayed } = await this.#idempotency.run(
        tx,
        { userId: principal.userId, deviceId: null, key, scope: scopeOf(order.id, mediaAssetId), bodyHash: requestHash({}) },
        perform,
      );
      // read again with the order of the URL in the condition: the answer is the medium as it is now
      const current = await findAssetWithFile(tables, order.id, mediaAssetId);
      if (current === undefined) throw new ProblemException('not_found');
      const names = await stageNames(tx, this.#stages, [{ workOrderId: order.id, stageId: current.asset.procedure_stage_id }]);
      const asset = toMediaAsset(current, { unfinished: false, manageQuarantine: canManageQuarantine(principal), stageNames: names });
      return { asset, replayed };
    });
  }
}

/**
 * The restoration of an entry that was soft deleted (EVM-040 AC1, AC4, AC6; SR-AUTHZ-02, SR-AUTHZ-05, SR-API-05, SR-API-07, SR-LOG-03, CWE-639).
 * The guard has decided before this runs: a signed-in ADMINISTRATOR on the web channel with a valid CSRF token. There is no step-up: the return
 * of an entry is as reversible as its hiding ("Cofnij" of the toast), the redaction is the one with it.
 *
 * ONE transaction, the same order as the deletion (`delete-entry.service.ts`), mirrored: the ORDER (`404`), the idempotency port (a repeat
 * answers `200` with the entry as it is NOW, read with the policy of the moment), the ENTRY locked `FOR NO KEY UPDATE` with `id AND
 * work_order_id AND deleted_at is not null` in ONE condition (another order's, a missing and a live entry are the same `404`, BEFORE
 * `If-Match`), `If-Match` (`428` / `400`), the version (`412`), the restoration with `version + 1` and the audit record
 * `timeline_entry.restored`. The text, redacted or not, is as it was; the entry returns to its place on the line of time (`created_at`).
 */
import { zRestoreTimelineEntryHeaders, zRestoreTimelineEntryPath } from '@evia/contracts/zod';
import type { TimelineEntry } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { parseIfMatch } from '../../../platform/http/if-match.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';
import { IDEMPOTENCY, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import { DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { rethrowMapped } from '../domain/integrity-violation.ts';
import { timelineTables } from '../infrastructure/tables.ts';
import { findEntryAnyState, lockEntry, restoreEntry } from '../infrastructure/timeline-store.ts';
import { entryEvent } from './entry-event.ts';
import { EntryPresenter } from './entry-page.ts';
import type { ChangedEntry } from './redact-entry.service.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the order and the entry (see {@link restoreEntryScope}). */
export const RESTORE_TIMELINE_ENTRY_SCOPE = 'POST /api/v1/work-orders/{workOrderId}/timeline/{entryId}/restore';

/** What an idempotency key is bound to besides the user: the method, the route, THE ORDER and THE ENTRY (a restoration has no body). */
export const restoreEntryScope = (workOrderId: string, entryId: string): string =>
  RESTORE_TIMELINE_ENTRY_SCOPE.replace('{workOrderId}', workOrderId).replace('{entryId}', entryId);

const pathSchema = strictObjects(zRestoreTimelineEntryPath);
const idempotencyKeySchema = zRestoreTimelineEntryHeaders.shape['Idempotency-Key'];

export interface RestoredEntry extends ChangedEntry {
  /** True when the answer repeats an earlier restoration (same key, order and entry): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

@Injectable()
export class RestoreEntryService {
  readonly #db: Kysely<Database>;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;
  readonly #orders: WorkOrderDirectory;
  readonly #presenter: EntryPresenter;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(EntryPresenter) presenter: EntryPresenter,
  ) {
    this.#db = db;
    this.#events = events;
    this.#idempotency = idempotency;
    this.#orders = orders;
    this.#presenter = presenter;
  }

  /**
   * @param rawParams the path parameters as parsed by the framework
   * @param rawIfMatch the `If-Match` header as received (`undefined` when absent)
   * @param rawKey the `Idempotency-Key` header as received (`undefined` when absent)
   */
  async restore(
    principal: Principal,
    rawParams: unknown,
    rawIfMatch: string | undefined,
    rawKey: string | undefined,
    context: EventContext,
  ): Promise<RestoredEntry> {
    const { workOrderId, entryId } = parseInput(pathSchema, rawParams) as { workOrderId: string; entryId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.findVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');

      const perform = async () => {
        await this.#bringBack(tx, principal, order.id, entryId, rawIfMatch, request);
        return { value: undefined, result: { status: 200, code: 'restored', resourceId: entryId } };
      };
      const replayed =
        key === undefined
          ? (await perform(), false)
          : (
              await this.#idempotency.run(
                tx,
                { userId: principal.userId, deviceId: null, key, scope: restoreEntryScope(order.id, entryId), bodyHash: requestHash(null) },
                perform,
              )
            ).replayed;

      // the answer is read again with the order of the URL in the condition (a repeat never names an entry of another order)
      const row = await findEntryAnyState(timelineTables(tx), order.id, entryId);
      if (row === undefined) throw new ProblemException('not_found');
      const entry: TimelineEntry = await this.#presenter.entry(tx, principal, order.id, row);
      return { entry, version: row.version, replayed };
    }).catch(rethrowMapped);
  }

  async #bringBack(
    tx: Kysely<Database>,
    principal: Principal,
    workOrderId: string,
    entryId: string,
    rawIfMatch: string | undefined,
    request: EventContext,
  ): Promise<void> {
    const tables = timelineTables(tx);
    const locked = await lockEntry(tables, workOrderId, entryId, 'deleted');
    if (locked === undefined) throw new ProblemException('not_found');
    const expectedVersion = parseIfMatch(rawIfMatch);
    if (locked.version !== expectedVersion) throw new ProblemException('version_conflict');

    const row = await restoreEntry(tables, workOrderId, entryId, expectedVersion);
    if (row === undefined) throw new ProblemException('version_conflict');
    await this.#events.publish(tx, entryEvent('timeline_entry.restored', principal, entryId, 'success'), request);
  }
}

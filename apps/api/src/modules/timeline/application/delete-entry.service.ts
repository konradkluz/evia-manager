/**
 * The soft delete of an entry of the journal (EVM-040 AC1, AC4, AC5, AC6; SR-PRIV-03, SR-AUTHZ-02, SR-AUTHZ-05, SR-API-05, SR-API-07, SR-LOG-03,
 * ASVS V2.3.3, CWE-639). The guard has decided before this runs: a signed-in ADMINISTRATOR on the web channel with a valid CSRF token - the
 * Editor and Read-only get 403 and an anonymous caller 401 without reaching the headers. The entry is hidden, not erased: the text stays in the
 * database and the deletion is undone by `restore-entry.service.ts`.
 *
 * ONE transaction, and every decision in it is taken on a row LOCKED, never on an earlier read:
 *   1. the ORDER through the facade of `work-orders` (the read policy is in that query): missing or soft deleted is `404 not_found`;
 *   2. the idempotency port (when there is a key), BEFORE the entry is looked for: a repeat of the same key, order and entry answers `204`
 *      although the entry is hidden already. The key is bound to the ORDER and the ENTRY;
 *   3. the ENTRY locked `FOR NO KEY UPDATE` with `id AND work_order_id AND deleted_at is null` in ONE condition: an entry of another order, one
 *      that does not exist and one already deleted are the same `404 not_found` (IDOR), BEFORE `If-Match`;
 *   4. an automatic event is `409 entry_is_event` (no personal data, never deleted - the database refuses it too); `If-Match` (`428` / `400`);
 *      the version (`412 version_conflict`, no current values);
 *   5. the soft delete with `version + 1`, the audit record `timeline_entry.deleted` (identifiers only). An error anywhere rolls it all back.
 */
import { zDeleteTimelineEntryHeaders, zDeleteTimelineEntryPath } from '@evia/contracts/zod';
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
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';
import { IDEMPOTENCY, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { rethrowMapped } from '../domain/integrity-violation.ts';
import { timelineTables } from '../infrastructure/tables.ts';
import { lockEntry, softDeleteEntry } from '../infrastructure/timeline-store.ts';
import { entryEvent } from './entry-event.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the order and the entry (see {@link deleteEntryScope}). */
export const DELETE_TIMELINE_ENTRY_SCOPE = 'DELETE /api/v1/work-orders/{workOrderId}/timeline/{entryId}';

/** What an idempotency key is bound to besides the user: the method, the route, THE ORDER and THE ENTRY (a removal has no body). */
export const deleteEntryScope = (workOrderId: string, entryId: string): string =>
  DELETE_TIMELINE_ENTRY_SCOPE.replace('{workOrderId}', workOrderId).replace('{entryId}', entryId);

const pathSchema = strictObjects(zDeleteTimelineEntryPath);
const idempotencyKeySchema = zDeleteTimelineEntryHeaders.shape['Idempotency-Key'];

@Injectable()
export class DeleteEntryService {
  readonly #db: Kysely<Database>;
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
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
    this.#orders = orders;
  }

  /**
   * @param rawParams the path parameters as parsed by the framework
   * @param rawIfMatch the `If-Match` header as received (`undefined` when absent)
   * @param rawKey the `Idempotency-Key` header as received (`undefined` when absent)
   * @returns `true` when the answer repeats an earlier removal (`Idempotent-Replayed: true`)
   */
  async delete(
    principal: Principal,
    rawParams: unknown,
    rawIfMatch: string | undefined,
    rawKey: string | undefined,
    context: EventContext,
  ): Promise<boolean> {
    const { workOrderId, entryId } = parseInput(pathSchema, rawParams) as { workOrderId: string; entryId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.findVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');

      const perform = async () => {
        await this.#remove(tx, principal, order.id, entryId, rawIfMatch, request);
        return { value: undefined, result: { status: 204, code: 'deleted', resourceId: entryId } };
      };
      if (key === undefined) {
        await perform();
        return false;
      }
      const outcome = await this.#idempotency.run(
        tx,
        { userId: principal.userId, deviceId: null, key, scope: deleteEntryScope(order.id, entryId), bodyHash: requestHash(null) },
        perform,
      );
      return outcome.replayed;
    }).catch(rethrowMapped);
  }

  /** Steps 3-5 of the order described above, on the locked row. */
  async #remove(
    tx: Kysely<Database>,
    principal: Principal,
    workOrderId: string,
    entryId: string,
    rawIfMatch: string | undefined,
    request: EventContext,
  ): Promise<void> {
    const tables = timelineTables(tx);
    const locked = await lockEntry(tables, workOrderId, entryId, 'live');
    if (locked === undefined) throw new ProblemException('not_found');
    if (locked.kind === 'event') throw new ProblemException('entry_is_event');
    const expectedVersion = parseIfMatch(rawIfMatch);
    if (locked.version !== expectedVersion) throw new ProblemException('version_conflict');

    const row = await softDeleteEntry(tables, workOrderId, entryId, expectedVersion, principal.userId, this.#clock.now());
    if (row === undefined) throw new ProblemException('version_conflict');
    await this.#events.publish(tx, entryEvent('timeline_entry.deleted', principal, entryId, 'success'), request);
  }
}

/**
 * The redaction of the text of an entry (EVM-040 AC2, AC3, AC4, AC5, AC6; SR-PRIV-03, SR-PRIV-04, SR-SESS-08, SR-AUTHZ-02, SR-AUTHZ-05, SR-API-07,
 * SR-LOG-03, SR-DATA-08, SR-ERR-01, CWE-639). The guard has decided before this runs: a signed-in ADMINISTRATOR on the web channel with a valid CSRF
 * token and a passkey authentication in the last 15 minutes (`step_up_required`, after the role: the Editor and Read-only get `403 forbidden`,
 * so only an Administrator with a fresh key can ever see the `503` below).
 *
 * ONE transaction, in this order (the register is written AFTER every check and BEFORE the change, so a request that ends in 404, 409 or 412 leaves
 * no record, and the database never changes without the record):
 *   1. the ORDER through the facade of `work-orders`: missing or soft deleted is `404 not_found`;
 *   2. the ENTRY locked `FOR NO KEY UPDATE` with `id AND work_order_id` in ONE condition - ALSO a soft deleted one (its text is personal data that is
 *      still in the database); another order's entry and a missing one are the same `404` (IDOR), BEFORE `If-Match`;
 *   3. an automatic event is `409 entry_is_event`; `If-Match` (`428` / `400`); the version (`412`); a text already redacted is `409 already_redacted`;
 *   4. `DeletionRegister.record(...)`: one new object with the identifiers, the code of the operation, the actor and the time - NEVER the text. It
 *      has a short deadline (the lock is held for it: one row, and the lock does not block the foreign keys of a correction). A refusal is
 *      `503 deletion_register_unavailable`: the redaction does not start, the text and the version are untouched;
 *   5. the UPDATE (the marker, the time and author of the redaction, `version + 1`), the audit record `timeline_entry.redacted`; COMMIT.
 * The register is a journal of INTENT with at-least-once semantics: when step 5 or the COMMIT fails after step 4 the object stays (orphaned) - harmless,
 * the replay of the register (EVM-062) is idempotent and skips what it cannot apply. When step 4 fails the transaction is rolled back and a short
 * transaction of its own writes the audit record with the outcome `failed` (identifiers only), then the `503` is answered. The text of the entry
 * is never in the register, the audit trail, a log, a problem or an error message.
 */
import { zRedactTimelineEntryPath } from '@evia/contracts/zod';
import type { TimelineEntry } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import {
  DELETION_REGISTER,
  DeletionRegisterUnavailable,
  type DeletionRegister,
} from '../../../platform/deletion-register/deletion-register.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { parseIfMatch } from '../../../platform/http/if-match.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import type { Logger } from '../../../platform/logging/logger.ts';
import { CLOCK, DATABASE, EVENT_BUS, LOGGER } from '../../../platform/tokens.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { redactionMarker } from '../domain/redaction-marker.ts';
import { rethrowMapped } from '../domain/integrity-violation.ts';
import { timelineTables } from '../infrastructure/tables.ts';
import { lockEntry, redactEntry } from '../infrastructure/timeline-store.ts';
import { entryEvent } from './entry-event.ts';
import { EntryPresenter } from './entry-page.ts';

const pathSchema = strictObjects(zRedactTimelineEntryPath);

/** An entry after a change with the version it has now: the `ETag` of the answer. */
export interface ChangedEntry {
  readonly entry: TimelineEntry;
  readonly version: number;
}

@Injectable()
export class RedactEntryService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #orders: WorkOrderDirectory;
  readonly #register: DeletionRegister;
  readonly #presenter: EntryPresenter;
  readonly #logger: Logger;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(DELETION_REGISTER) register: DeletionRegister,
    @Inject(EntryPresenter) presenter: EntryPresenter,
    @Inject(LOGGER) logger: Logger,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#orders = orders;
    this.#register = register;
    this.#presenter = presenter;
    this.#logger = logger;
  }

  /**
   * @param rawParams the path parameters as parsed by the framework
   * @param rawIfMatch the `If-Match` header as received (`undefined` when absent)
   */
  async redact(principal: Principal, rawParams: unknown, rawIfMatch: string | undefined, context: EventContext): Promise<ChangedEntry> {
    const { workOrderId, entryId } = parseInput(pathSchema, rawParams) as { workOrderId: string; entryId: string };
    const request = { ...context, sessionId: principal.sessionId };
    try {
      return await runInTransaction(this.#db, (tx) => this.#redact(tx, principal, workOrderId, entryId, rawIfMatch, request)).catch(
        rethrowMapped,
      );
    } catch (error) {
      if (!(error instanceof DeletionRegisterUnavailable)) throw error;
      await this.#recordFailure(principal, entryId, request);
      throw new ProblemException('deletion_register_unavailable');
    }
  }

  async #redact(
    tx: Kysely<Database>,
    principal: Principal,
    workOrderId: string,
    entryId: string,
    rawIfMatch: string | undefined,
    request: EventContext,
  ): Promise<ChangedEntry> {
    const order = await this.#orders.findVisible(tx, principal, workOrderId);
    if (order === undefined) throw new ProblemException('not_found');
    const tables = timelineTables(tx);
    const locked = await lockEntry(tables, order.id, entryId, 'any');
    if (locked === undefined) throw new ProblemException('not_found');
    if (locked.kind === 'event') throw new ProblemException('entry_is_event');
    const expectedVersion = parseIfMatch(rawIfMatch);
    if (locked.version !== expectedVersion) throw new ProblemException('version_conflict');
    if (locked.redacted_at !== null) throw new ProblemException('already_redacted');

    // before the change in the database; throws DeletionRegisterUnavailable, which rolls the transaction back
    await this.#register.record({
      operationCode: 'timeline_entry_redacted',
      subjectType: 'timeline_entry',
      subjectId: entryId,
      workOrderId: order.id,
      actorUserId: principal.userId,
    });

    const now = this.#clock.now();
    const row = await redactEntry(tables, order.id, entryId, expectedVersion, redactionMarker(now), principal.userId, now);
    if (row === undefined) throw new ProblemException('version_conflict');
    await this.#events.publish(tx, entryEvent('timeline_entry.redacted', principal, entryId, 'success'), request);
    return { entry: await this.#presenter.entry(tx, principal, order.id, row), version: row.version };
  }

  /** The audit record of a redaction that did not start (outcome `failed`): a transaction of its own, after the rollback; a failure here is logged. */
  async #recordFailure(principal: Principal, entryId: string, request: EventContext): Promise<void> {
    try {
      await runInTransaction(this.#db, (tx) =>
        this.#events.publish(tx, entryEvent('timeline_entry.redacted', principal, entryId, 'failed'), request),
      );
    } catch (error) {
      this.#logger.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'audit of a refused redaction was not written');
    }
  }
}

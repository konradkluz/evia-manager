/**
 * The push of mutations of the phone - `POST /api/v1/sync/mutations` (EVM-098; ADR-0008; offline-sync.md rules 1, 4, 5; SR-SYNC-01, SR-SYNC-03, SR-API-05,
 * SR-API-06, SR-AUTHZ-02, AB-09). The guard has decided before this runs: a session of the phone (Bearer), the role (Administrator or Editor, checked at
 * every request), the device not revoked nor to wipe, the version of the app; the controller has counted the request in the bucket of the DEVICE of the
 * session. Then, in this order:
 *   1. the envelope (`400`, nothing written - not even `pendingItems`);
 *   2. `pendingItems` of the device of the session, in a short transaction of its own (informative; whatever the results of the mutations);
 *   3. the mutations ONE BY ONE in the order of the request, EACH in its own transaction: a bad mutation is `rejected validation_failed` without a transaction;
 *      a good one goes through the idempotency port of the platform (key = the user, the device of the session and `mutationId`; the scope of the push; the
 *      hash of `{type, commandVersion, payload}`) and, when it is no repeat, through the operation:
 *        a. the target order under the CURRENT policy (`forbidden` for no access and for no such order alike, `target_unavailable` for a deleted one);
 *        b. the INSERT of the entry with the rules of the panel (`timeline`): `validation_failed`, or an existing identifier;
 *        c. for an existing identifier, the rule of `idempotency_expired` (asked only now, after a., so it cannot probe an identifier of an order without access);
 *        d. the audit event `sync.mutation_applied` (`timeline` writes `timeline_entry.created` too) - in the same transaction as the entry and the record.
 *      Every result but `applied` is a thrown {@link MutationVerdictSignal}: the transaction rolls back and no idempotency record is written.
 * Mapped to a result are EXACTLY: the signal, and the problems `idempotency_mismatch` / `idempotency_in_progress` of the port. Anything else (a failed write of
 * the audit trail, a database error, any other problem) escapes: `500` for the batch, the mutations committed before stay committed, and the phone retries the
 * batch safely (AC4). Nothing of a mutation - its identifier, its text, the user or the device - is logged; the metric has closed labels only.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput } from '../../../platform/http/validation.ts';
import { IDEMPOTENCY, IDEMPOTENCY_RETENTION_MS, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import type { Counter, MetricsRegistry } from '../../../platform/metrics/metrics.ts';
import type { SyncMutationAuditEvent } from '../../../platform/sync/sync-event.ts';
import { CLOCK, DATABASE, EVENT_BUS, METRICS } from '../../../platform/tokens.ts';
import { DEVICE_PENDING_ITEMS, type DevicePendingItems } from '../../identity/system-ports.ts';
import { MOBILE_ENTRY_COMMANDS, type MobileAuthor, type MobileEntryCommands } from '../../timeline/system-ports.ts';
import { WORK_ORDER_MUTATION_TARGET, type WorkOrderMutationTarget } from '../../work-orders/system-ports.ts';
import {
  decodeMutation,
  envelopeSchema,
  MutationVerdictSignal,
  SYNC_MUTATIONS_SCOPE,
  typeLabel,
  type CommandType,
  type EntryCommand,
  type MutationResult,
  type MutationVerdict,
  type RawMutation,
} from '../domain/mutations.ts';

export const SYNC_MUTATION_OUTCOMES_METRIC = 'sync_mutation_outcomes_total';

export interface PushResponse {
  readonly serverTime: string;
  readonly results: readonly MutationResult[];
}

/** The problems of the idempotency port that are a result of ONE mutation, not of the batch. */
const MAPPED_PROBLEMS = new Set(['idempotency_mismatch', 'idempotency_in_progress'] as const);
type MappedProblem = typeof MAPPED_PROBLEMS extends Set<infer Code> ? Code : never;
const isMappedProblem = (error: unknown): error is ProblemException & { code: MappedProblem } =>
  error instanceof ProblemException && (MAPPED_PROBLEMS as ReadonlySet<string>).has(error.code);

@Injectable()
export class PushMutationsService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;
  readonly #targets: WorkOrderMutationTarget;
  readonly #entries: MobileEntryCommands;
  readonly #pendingItems: DevicePendingItems;
  readonly #outcomes: Counter;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(WORK_ORDER_MUTATION_TARGET) targets: WorkOrderMutationTarget,
    @Inject(MOBILE_ENTRY_COMMANDS) entries: MobileEntryCommands,
    @Inject(DEVICE_PENDING_ITEMS) pendingItems: DevicePendingItems,
    @Inject(METRICS) metrics: MetricsRegistry,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
    this.#targets = targets;
    this.#entries = entries;
    this.#pendingItems = pendingItems;
    this.#outcomes = metrics.counter(SYNC_MUTATION_OUTCOMES_METRIC, ['type', 'outcome', 'code']);
  }

  /** @param deviceId the device of the SESSION (never of the request) */
  async push(principal: Principal, deviceId: string, rawBody: unknown, context: EventContext): Promise<PushResponse> {
    const envelope = parseInput(envelopeSchema, rawBody);
    const { pendingItems } = envelope;
    if (pendingItems !== undefined) await runInTransaction(this.#db, (tx) => this.#pendingItems.report(tx, deviceId, pendingItems));
    const author: MobileAuthor = { userId: principal.userId, deviceId };
    const results: MutationResult[] = [];
    for (const mutation of envelope.mutations) {
      const result = await this.#apply(principal, author, mutation, context);
      this.#count(mutation, result);
      results.push(result);
    }
    return { serverTime: this.#clock.now().toISOString(), results };
  }

  async #apply(principal: Principal, author: MobileAuthor, mutation: RawMutation, context: EventContext): Promise<MutationResult> {
    const { mutationId } = mutation;
    const decoded = decodeMutation(mutation, this.#clock.now());
    if (!decoded.ok) return { mutationId, outcome: 'rejected', code: 'validation_failed' };
    try {
      const outcome = await runInTransaction(this.#db, (tx) =>
        this.#idempotency.run(
          tx,
          { userId: author.userId, deviceId: author.deviceId, key: mutationId, scope: SYNC_MUTATIONS_SCOPE, bodyHash: decoded.hash },
          async () => {
            await this.#perform(tx, principal, author, decoded.type, decoded.command, context);
            return { value: undefined, result: { status: 201, code: 'applied', resourceId: decoded.command.id } };
          },
        ),
      );
      // a repeat answers what was applied, never the content and never the warnings of the first time
      if (outcome.replayed) return { mutationId, outcome: 'duplicate' };
      return decoded.capturedAtOutOfRange
        ? { mutationId, outcome: 'applied', warnings: ['captured_at_out_of_range'] }
        : { mutationId, outcome: 'applied' };
    } catch (error) {
      if (error instanceof MutationVerdictSignal) return { mutationId, ...error.verdict };
      if (isMappedProblem(error)) return { mutationId, outcome: 'rejected', code: error.code };
      throw error;
    }
  }

  /** Steps a.–d. of the description above, in the transaction of the mutation. @throws MutationVerdictSignal for every result but `applied` */
  async #perform(
    tx: Kysely<Database>,
    principal: Principal,
    author: MobileAuthor,
    type: CommandType,
    command: EntryCommand,
    context: EventContext,
  ): Promise<void> {
    const target = await this.#targets.stateOf(tx, principal, command.workOrderId);
    if (target !== 'available') throw verdict({ outcome: 'rejected', code: target });
    const created = await this.#entries.create(tx, author, command, context);
    if (created === 'invalid') throw verdict({ outcome: 'rejected', code: 'validation_failed' });
    if (created === 'id_conflict') {
      const createdBefore = new Date(this.#clock.now().getTime() - IDEMPOTENCY_RETENTION_MS);
      const own = await this.#entries.matchesOwnEntry(tx, {
        id: command.id,
        kind: command.kind,
        workOrderId: command.workOrderId,
        author,
        createdBefore,
      });
      throw verdict(own ? { outcome: 'duplicate', warnings: ['idempotency_expired'] } : { outcome: 'conflict', code: 'id_conflict' });
    }
    const event: SyncMutationAuditEvent = {
      type: 'sync.mutation_applied',
      actor: { type: 'user', userId: author.userId },
      outcome: 'success',
      objectType: 'timeline_entry',
      objectId: command.id,
      deviceId: author.deviceId,
      workOrderId: command.workOrderId,
      commandType: type,
    };
    await this.#events.publish(tx, event, context);
  }

  #count(mutation: RawMutation, result: MutationResult): void {
    this.#outcomes.increment({ type: typeLabel(mutation['type']), outcome: result.outcome, code: result.code ?? 'none' });
  }
}

const verdict = (value: MutationVerdict): MutationVerdictSignal => new MutationVerdictSignal(value);

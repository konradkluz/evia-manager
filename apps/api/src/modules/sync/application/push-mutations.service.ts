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
 * `CreateQuickWorkOrder` (EVM-099) takes the same road with its own steps (#performQuick), in this order, all in the ONE transaction of the mutation:
 *   a. the same identifier twice in the command: `conflict id_conflict` (decided already when the command is decoded, before any transaction);
 *   b. the identifier of the order: an own old order of this user AND device (created no later than the retention of the idempotency records) is `duplicate`
 *      with `idempotency_expired` and its number, any other existing order is `conflict id_conflict` - BEFORE any insert, so a retry after the record expired never
 *      reaches the conflict of the customer;
 *   c. the existing customer and site (`target_unavailable`: missing, deleted, anonymized and not visible alike) and the template (`template_unavailable`);
 *   d. the limit of new customers and sites of the DEVICE (20 in 24 hours, serialised per device by an advisory lock): `quota_exceeded`;
 *   e. the INSERT of the new customer, then of the new site (`id_conflict` for an existing identifier, also somebody else's or a deleted one);
 *   f. the order through the shared composer (the number from the counter as late as possible);
 *   g. the note as the first entry of the journal (the identifier is the server's: the phone sends none);
 *   h. the audit event `sync.mutation_applied` (the object is the order).
 * A result other than `applied` is a thrown signal: the rollback leaves no customer, no site, no order and the number unused. The limit is also written down
 * AFTER the rollback, in a short transaction of its own (the audit event, the security alert; once per device, kind and hour) and counted in a metric with a
 * closed `kind` label - the device is in the audit event of the same trace, never in the alert or in the metric.
 * Mapped to a result are EXACTLY: the signal, and the problems `idempotency_mismatch` / `idempotency_in_progress` of the port. Anything else (a failed write of
 * the audit trail, a database error, any other problem) escapes: `500` for the batch, the mutations committed before stay committed, and the phone retries the
 * batch safely (AC4). Nothing of a mutation - its identifier, its text, the user or the device - is logged; the metric has closed labels only.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { enqueueSecurityAlert } from '../../../platform/alerts/security-alerts.ts';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput } from '../../../platform/http/validation.ts';
import { IDEMPOTENCY, IDEMPOTENCY_RETENTION_MS, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import type { Counter, MetricsRegistry } from '../../../platform/metrics/metrics.ts';
import { uuidV7 } from '../../../platform/ids/uuid-v7.ts';
import type { SyncMutationAuditEvent, SyncQuotaAuditEvent } from '../../../platform/sync/sync-event.ts';
import { CLOCK, DATABASE, EVENT_BUS, METRICS } from '../../../platform/tokens.ts';
import { CUSTOMER_DIRECTORY, type CustomerDirectory } from '../../customers/index.ts';
import { CUSTOMER_QUICK_CREATION, type CustomerQuickCreation } from '../../customers/system-ports.ts';
import { DEVICE_PENDING_ITEMS, type DevicePendingItems } from '../../identity/system-ports.ts';
import { SITE_DIRECTORY, type SiteDirectory } from '../../sites/index.ts';
import { SITE_QUICK_CREATION, type SiteQuickCreation } from '../../sites/system-ports.ts';
import { MOBILE_ENTRY_COMMANDS, type MobileAuthor, type MobileEntryCommands } from '../../timeline/system-ports.ts';
import {
  WORK_ORDER_MUTATION_TARGET,
  WORK_ORDER_QUICK_CREATION,
  type WorkOrderMutationTarget,
  type WorkOrderQuickCreation,
} from '../../work-orders/system-ports.ts';
import {
  capped,
  decodeMutation,
  envelopeSchema,
  MutationVerdictSignal,
  QUICK_CREATE_LIMIT,
  QUICK_CREATE_WINDOW_MS,
  QuotaExceededSignal,
  SYNC_MUTATIONS_SCOPE,
  typeLabel,
  type EntryCommand,
  type MutationResult,
  type MutationVerdict,
  type QuickCommand,
  type RawMutation,
} from '../domain/mutations.ts';
import { lockDeviceQuota, markQuotaAlerted, purgeQuotaAlerts, snapshotWindowStart } from '../infrastructure/sync-queries.ts';

export const SYNC_MUTATION_OUTCOMES_METRIC = 'sync_mutation_outcomes_total';
/** The refusals by the limit of new customers and sites: the label `kind` is `customer` or `site` - a closed list, never a device (AB-08, SR-LOG-06). */
export const SYNC_QUOTA_EXCEEDED_METRIC = 'sync_quota_exceeded_total';

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
  readonly #quotaRefusals: Counter;
  readonly #customerDirectory: CustomerDirectory;
  readonly #siteDirectory: SiteDirectory;
  readonly #newCustomers: CustomerQuickCreation;
  readonly #newSites: SiteQuickCreation;
  readonly #quickOrders: WorkOrderQuickCreation;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(WORK_ORDER_MUTATION_TARGET) targets: WorkOrderMutationTarget,
    @Inject(MOBILE_ENTRY_COMMANDS) entries: MobileEntryCommands,
    @Inject(DEVICE_PENDING_ITEMS) pendingItems: DevicePendingItems,
    @Inject(METRICS) metrics: MetricsRegistry,
    @Inject(CUSTOMER_DIRECTORY) customerDirectory: CustomerDirectory,
    @Inject(SITE_DIRECTORY) siteDirectory: SiteDirectory,
    @Inject(CUSTOMER_QUICK_CREATION) newCustomers: CustomerQuickCreation,
    @Inject(SITE_QUICK_CREATION) newSites: SiteQuickCreation,
    @Inject(WORK_ORDER_QUICK_CREATION) quickOrders: WorkOrderQuickCreation,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
    this.#targets = targets;
    this.#entries = entries;
    this.#pendingItems = pendingItems;
    this.#outcomes = metrics.counter(SYNC_MUTATION_OUTCOMES_METRIC, ['type', 'outcome', 'code']);
    this.#quotaRefusals = metrics.counter(SYNC_QUOTA_EXCEEDED_METRIC, ['kind']);
    this.#customerDirectory = customerDirectory;
    this.#siteDirectory = siteDirectory;
    this.#newCustomers = newCustomers;
    this.#newSites = newSites;
    this.#quickOrders = quickOrders;
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
    if (!decoded.ok) {
      return decoded.errors === undefined
        ? { mutationId, outcome: 'rejected', code: 'validation_failed' }
        : { mutationId, outcome: 'rejected', code: 'validation_failed', errors: decoded.errors };
    }
    if (decoded.type === 'CreateQuickWorkOrder')
      return this.#applyQuick(principal, author, mutationId, decoded.quick, decoded.hash, context);
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

  /** Steps a.-d. of the description above, in the transaction of the mutation. @throws MutationVerdictSignal for every result but `applied` */
  async #perform(
    tx: Kysely<Database>,
    principal: Principal,
    author: MobileAuthor,
    type: 'CreateNote' | 'CreateComment',
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

  /** `CreateQuickWorkOrder` (EVM-099): the checks that need no database first, then the idempotency port and the steps b.-h. of the description above. */
  async #applyQuick(
    principal: Principal,
    author: MobileAuthor,
    mutationId: string,
    quick: QuickCommand,
    hash: string,
    context: EventContext,
  ): Promise<MutationResult> {
    if (quick.duplicateIds) return { mutationId, outcome: 'conflict', code: 'id_conflict' };
    const errors = this.#contentErrors(quick);
    if (errors.length > 0) return { mutationId, outcome: 'rejected', code: 'validation_failed', errors };
    try {
      const outcome = await runInTransaction(this.#db, async (tx) => {
        const run = await this.#idempotency.run(
          tx,
          { userId: author.userId, deviceId: author.deviceId, key: mutationId, scope: SYNC_MUTATIONS_SCOPE, bodyHash: hash },
          async () => {
            const number = await this.#performQuick(tx, principal, author, quick, context);
            return { value: number, result: { status: 201, code: 'applied', resourceId: quick.workOrderId } };
          },
        );
        // a repeat answers the number of the order the first time created: the key belongs to this user and device, so no read policy applies (the order may be deleted since)
        if (!run.replayed) return { replayed: false, number: run.value };
        const number = run.result.resourceId === null ? undefined : await this.#quickOrders.numberOf(tx, run.result.resourceId);
        return { replayed: true, number };
      });
      const withNumber = outcome.number === undefined ? {} : { workOrderNumber: outcome.number };
      return { mutationId, outcome: outcome.replayed ? 'duplicate' : 'applied', ...withNumber };
    } catch (error) {
      if (error instanceof QuotaExceededSignal) {
        await this.#recordQuotaExceeded(author, error.kind, context);
        return { mutationId, ...error.verdict };
      }
      if (error instanceof MutationVerdictSignal) return { mutationId, ...error.verdict };
      if (isMappedProblem(error)) return { mutationId, outcome: 'rejected', code: error.code };
      throw error;
    }
  }

  /** The rules of the content of the new customer and the new site (the rules of `customers` and `sites`, without a write): pointers and codes, never values. */
  #contentErrors(quick: QuickCommand): ReturnType<typeof capped> {
    return capped([
      ...(quick.newCustomer === undefined ? [] : this.#newCustomers.check(quick.newCustomer)),
      ...(quick.newSite === undefined ? [] : this.#newSites.check(quick.newSite)),
    ]);
  }

  /** Steps b.-h. of the description above, in the transaction of the mutation. @returns the number of the order @throws MutationVerdictSignal for every result but `applied` */
  async #performQuick(
    tx: Kysely<Database>,
    principal: Principal,
    author: MobileAuthor,
    quick: QuickCommand,
    context: EventContext,
  ): Promise<string> {
    const now = this.#clock.now();
    const probe = await this.#quickOrders.probe(tx, quick.workOrderId, author, new Date(now.getTime() - IDEMPOTENCY_RETENTION_MS));
    if (probe.kind === 'own') {
      throw verdict({ outcome: 'duplicate', warnings: ['idempotency_expired'], workOrderNumber: probe.number });
    }
    if (probe.kind === 'conflict') throw verdict({ outcome: 'conflict', code: 'id_conflict' });

    if (quick.customerId !== undefined && (await this.#customerDirectory.findVisible(tx, principal, quick.customerId)) === undefined) {
      throw verdict({ outcome: 'rejected', code: 'target_unavailable' });
    }
    if (quick.siteId !== undefined && (await this.#siteDirectory.findVisible(tx, principal, quick.siteId)) === undefined) {
      throw verdict({ outcome: 'rejected', code: 'target_unavailable' });
    }
    if (!(await this.#quickOrders.templateAvailable(tx, quick.templateId)))
      throw verdict({ outcome: 'rejected', code: 'template_unavailable' });

    await this.#checkQuota(tx, author.deviceId, quick, now);

    if (quick.newCustomer !== undefined) {
      const created = await this.#newCustomers.create(tx, principal, author.deviceId, quick.newCustomer, context);
      if (created === 'invalid') throw verdict({ outcome: 'rejected', code: 'validation_failed' });
      if (created === 'id_conflict') throw verdict({ outcome: 'conflict', code: 'id_conflict' });
    }
    if (quick.newSite !== undefined) {
      const created = await this.#newSites.create(tx, principal, author.deviceId, quick.newSite, context);
      if (created === 'invalid') throw verdict({ outcome: 'rejected', code: 'validation_failed' });
      if (created === 'id_conflict') throw verdict({ outcome: 'conflict', code: 'id_conflict' });
    }

    const order = await this.#quickOrders.create(
      tx,
      principal,
      author.deviceId,
      {
        id: quick.workOrderId,
        templateId: quick.templateId,
        title: quick.title,
        customerId: quick.customerId ?? quick.newCustomer?.id ?? '',
        siteId: quick.siteId ?? quick.newSite?.id ?? '',
      },
      context,
    );
    if (!order.ok)
      throw verdict(
        order.reason === 'id_conflict' ? { outcome: 'conflict', code: 'id_conflict' } : { outcome: 'rejected', code: order.reason },
      );

    if (quick.note !== null) {
      const note = await this.#entries.create(
        tx,
        author,
        {
          id: uuidV7(now.getTime()),
          kind: 'note',
          workOrderId: quick.workOrderId,
          noteCategory: 'other',
          body: quick.note,
          procedureStageId: undefined,
          capturedAt: null,
        },
        context,
      );
      if (note === 'invalid') {
        throw verdict({ outcome: 'rejected', code: 'validation_failed', errors: [{ pointer: '/note', code: 'invalid_format' }] });
      }
      if (note === 'id_conflict') throw verdict({ outcome: 'conflict', code: 'id_conflict' });
    }

    const event: SyncMutationAuditEvent = {
      type: 'sync.mutation_applied',
      actor: { type: 'user', userId: author.userId },
      outcome: 'success',
      objectType: 'work_order',
      objectId: quick.workOrderId,
      deviceId: author.deviceId,
      workOrderId: quick.workOrderId,
      commandType: 'CreateQuickWorkOrder',
    };
    await this.#events.publish(tx, event, context);
    return order.number;
  }

  /**
   * The limit of new customers and new sites of the device (20 each in a rolling 24 hours of the time of the SERVER): taken under an advisory lock of the device, so
   * two batches that run at once cannot both read 19. Only a command that creates a customer or a site is counted, and only the kind it creates.
   */
  async #checkQuota(tx: Kysely<Database>, deviceId: string, quick: QuickCommand, now: Date): Promise<void> {
    if (quick.newCustomer === undefined && quick.newSite === undefined) return;
    await lockDeviceQuota(tx, deviceId);
    const since = new Date(now.getTime() - QUICK_CREATE_WINDOW_MS);
    if (quick.newCustomer !== undefined && (await this.#newCustomers.countCreatedBy(tx, deviceId, since)) >= QUICK_CREATE_LIMIT) {
      throw new QuotaExceededSignal('customer');
    }
    if (quick.newSite !== undefined && (await this.#newSites.countCreatedBy(tx, deviceId, since)) >= QUICK_CREATE_LIMIT) {
      throw new QuotaExceededSignal('site');
    }
  }

  /**
   * The refusal by the limit, written AFTER the rollback of the mutation in a short transaction of its own: the metric every time, the alert and the audit event
   * once per device, kind and hour (without the mark a stolen phone could write thousands of events a minute).
   */
  async #recordQuotaExceeded(author: MobileAuthor, kind: 'customer' | 'site', context: EventContext): Promise<void> {
    this.#quotaRefusals.increment({ kind });
    const now = this.#clock.now();
    const windowStart = snapshotWindowStart(now);
    await runInTransaction(this.#db, async (tx) => {
      await purgeQuotaAlerts(tx, author.deviceId, windowStart);
      if (!(await markQuotaAlerted(tx, author.deviceId, kind, windowStart))) return;
      await enqueueSecurityAlert(tx, { code: 'sync_quick_create_quota_exceeded', occurredAt: now, traceId: context.traceId });
      const event: SyncQuotaAuditEvent = {
        type: 'sync.quota_exceeded',
        actor: { type: 'user', userId: author.userId },
        outcome: 'denied',
        objectType: 'device',
        objectId: author.deviceId,
        deviceId: author.deviceId,
        quotaKind: kind,
      };
      await this.#events.publish(tx, event, context);
    });
  }

  #count(mutation: RawMutation, result: MutationResult): void {
    this.#outcomes.increment({ type: typeLabel(mutation['type']), outcome: result.outcome, code: result.code ?? 'none' });
  }
}

const verdict = (value: MutationVerdict): MutationVerdictSignal => new MutationVerdictSignal(value);

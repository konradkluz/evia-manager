/**
 * The status command of a payment milestone — "Wystaw fakturę…", "Odnotuj wpłatę…", "Anuluj transzę…" (EVM-054 AC1–AC3, AC5–AC8;
 * decisions Q2, Q3a, Q3b, Q3c, Q3e; SR-API-05, SR-API-06, SR-API-07, SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05, SR-AUTHZ-10, SR-INPUT-01,
 * SR-INPUT-02, SR-LOG-02, SR-LOG-03, ASVS V2.3.1, V2.3.3, CWE-362, CWE-639, CWE-841). The guard has decided before this runs: a
 * signed-in Administrator or Editor on the web channel with a valid CSRF token — Read-only gets 403 and an anonymous caller 401 without
 * reaching the headers or the body.
 *
 * Order: the path and the `Idempotency-Key` (`400`) before the database is asked. Then ONE transaction, and every decision in it is
 * taken on rows LOCKED until it ends, never on an earlier read:
 *   1. the ORDER is locked through the facade of `work-orders` (`FOR NO KEY UPDATE` — it conflicts with the `FOR UPDATE` of a
 *      transition of the order, so a milestone invoiced in parallel with the cancellation of its order is serialised with it, AC6):
 *      missing or soft deleted is `404 not_found`, the same for every role;
 *   2. the MILESTONE is locked with `id AND work_order_id AND deleted_at IS NULL` in ONE condition — another order's, a missing and a
 *      deleted milestone are the same `404 not_found`, before `If-Match` and the body;
 *   3. `If-Match` (`428` / `400`) and the body against the schema of the contract (strict: `status`, `version`, `name` … are
 *      `read_only_field`, a stranger `unknown_field`): pointers and codes, never values;
 *   4. the idempotency port (when there is a key): a repeat of the same key, milestone and body returns the stored result BEFORE the
 *      checks below; the key is bound to the ORDER and the MILESTONE (elsewhere — `422 idempotency_mismatch`); the record keeps a hash
 *      of the body only (no invoice number, no reason);
 *   5. a closed order (settled or cancelled, PO-8) is `409 work_order_closed` — before the table, so the answer does not depend on
 *      the status of the milestone;
 *   6. the row of the table for (the status NOW, `to`): none is `409 invalid_state_transition` — unless the version is stale, which is
 *      `412`; a correction (Q2) is `403 forbidden` for EVERY role, the Administrator with a step-up included, before the version;
 *   7. the version (`412 version_conflict`, no current value in the answer);
 *   8. the fields of the move (`400`, the due date computed HERE from the day of the invoice and the days of the plan with the
 *      injected clock in `Europe/Warsaw`); a day of payment after today is `422 transition_condition_not_met` (`/paidOn`, `in_future`);
 *   9. the update (`version + 1`) through the one point of write — no row there after a successful lock is a defect (`500`), never a
 *      silent `200`; the event for the audit trail (`payment_milestone.invoiced|paid|cancelled`: the actor, the amount before and
 *      after, the codes of the status — never the name, the number or the reason) and the event for the journal of the order (the two
 *      codes); the idempotency record. An error anywhere rolls the whole command back; a repeat returns the milestone as it is NOW.
 * The reason of a cancellation is written to its column only: never to an answer, an event, a log or an error.
 */
import {
  zPaymentMilestone,
  zPaymentMilestoneTransition,
  zTransitionPaymentMilestoneHeaders,
  zTransitionPaymentMilestonePath,
} from '@evia/contracts/zod';
import type { PaymentMilestone } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { businessDate } from '../../../platform/clock/business-date.ts';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { parseIfMatch } from '../../../platform/http/if-match.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, readOnlyKeys, strictObjects } from '../../../platform/http/validation.ts';
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';
import { IDEMPOTENCY, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { findMilestoneTransition, mayTake, moveFields, type MilestoneTransitionCommand } from '../domain/milestone-transitions.ts';
import type { PaymentMilestoneEvent, PaymentMilestoneStatusChangedEvent } from '../events.ts';
import { lockMilestone, type MilestoneRow } from '../infrastructure/milestone-reader.ts';
import { updateMilestone } from '../infrastructure/milestone-store.ts';
import { paymentTables } from '../infrastructure/tables.ts';
import { currentMilestone, HIDDEN_MILESTONE_COLUMNS } from './milestone-answer.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the order and the milestone. */
export const TRANSITION_MILESTONE_SCOPE = 'POST /api/v1/work-orders/{workOrderId}/payment-milestones/{milestoneId}/transitions';

/**
 * The body of a transition says nothing of the milestone (`{"to":"paid"}` is the same for every milestone), so a scope of the route
 * alone would let the key of one milestone replay the payment of another (ASVS V2.3.1, SR-API-05, CWE-639, CWE-841).
 */
export const transitionMilestoneScope = (workOrderId: string, milestoneId: string): string =>
  TRANSITION_MILESTONE_SCOPE.replace('{workOrderId}', workOrderId).replace('{milestoneId}', milestoneId);

const AUDIT_ACTION = {
  invoice: 'payment_milestone.invoiced',
  pay: 'payment_milestone.paid',
  cancel: 'payment_milestone.cancelled',
} as const;

const pathSchema = strictObjects(zTransitionPaymentMilestonePath);
const commandBody = strictObjects(zPaymentMilestoneTransition);
const idempotencyKeySchema = zTransitionPaymentMilestoneHeaders.shape['Idempotency-Key'];
/** The fields of the server that a command names in vain: the keys of the milestone the command lacks and the hidden columns. */
const SERVER_FIELDS: ReadonlySet<string> = new Set([
  ...readOnlyKeys(zPaymentMilestone, zPaymentMilestoneTransition),
  ...HIDDEN_MILESTONE_COLUMNS,
]);

export interface TransitionedMilestone {
  readonly milestone: PaymentMilestone;
  /** True when the answer repeats an earlier command (same key, milestone and body): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

@Injectable()
export class TransitionMilestoneService {
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
   */
  async transition(
    principal: Principal,
    rawParams: unknown,
    rawIfMatch: string | undefined,
    rawBody: unknown,
    rawKey: string | undefined,
    context: EventContext,
  ): Promise<TransitionedMilestone> {
    const { workOrderId, milestoneId } = parseInput(pathSchema, rawParams) as { workOrderId: string; milestoneId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.lockVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');
      const locked = await lockMilestone(paymentTables(tx), order.id, milestoneId);
      if (locked === undefined) throw new ProblemException('not_found');
      const expectedVersion = parseIfMatch(rawIfMatch);
      const command = parseInput(commandBody, rawBody, SERVER_FIELDS) as MilestoneTransitionCommand;

      const perform = async () => {
        if (order.closed) throw new ProblemException('work_order_closed');
        await this.#perform(tx, principal, { workOrderId: order.id, locked }, expectedVersion, command, request);
        return { value: undefined, result: { status: 200, code: 'transitioned', resourceId: milestoneId } };
      };
      const replayed =
        key === undefined
          ? (await perform(), false)
          : (
              await this.#idempotency.run(
                tx,
                {
                  userId: principal.userId,
                  deviceId: null,
                  key,
                  scope: transitionMilestoneScope(order.id, milestoneId),
                  bodyHash: requestHash(command),
                },
                perform,
              )
            ).replayed;
      return { milestone: await currentMilestone(tx, this.#clock, principal, order, milestoneId), replayed };
    });
  }

  /** Steps 6–9 of the order described above, on the locked rows. */
  async #perform(
    tx: Kysely<Database>,
    principal: Principal,
    target: { readonly workOrderId: string; readonly locked: MilestoneRow },
    expectedVersion: number,
    command: MilestoneTransitionCommand,
    request: EventContext,
  ): Promise<void> {
    const { locked } = target;
    const stale = locked.version !== expectedVersion;
    const rule = findMilestoneTransition(locked.status, command.to);
    if (rule === undefined) throw new ProblemException(stale ? 'version_conflict' : 'invalid_state_transition');
    if (rule.move === 'correction' || !mayTake(rule, principal.role)) throw new ProblemException('forbidden');
    if (stale) throw new ProblemException('version_conflict');
    const fields = moveFields(rule.move, command, locked, businessDate(this.#clock.now()));
    if (!fields.ok)
      throw new ProblemException(fields.status === 422 ? 'transition_condition_not_met' : 'validation_failed', { errors: fields.errors });

    const version = await updateMilestone(
      paymentTables(tx),
      { workOrderId: target.workOrderId, milestoneId: locked.id, expectedVersion, status: locked.status },
      fields.update,
      principal.userId,
      this.#clock.now(),
    );
    if (version === undefined) throw new ProblemException('internal_error');
    const actor = { type: 'user', userId: principal.userId } as const;
    const audited: PaymentMilestoneEvent = {
      type: AUDIT_ACTION[rule.move],
      actor,
      outcome: 'success',
      objectType: 'payment_milestone',
      objectId: locked.id,
      workOrderId: target.workOrderId,
      amountBeforeMinor: locked.amountMinor,
      amountAfterMinor: fields.update.amountMinor ?? locked.amountMinor,
      fromCode: rule.from,
      toCode: rule.to,
    };
    await this.#events.publish(tx, audited, request);
    const journal: PaymentMilestoneStatusChangedEvent = {
      type: 'payment_milestone.status_changed',
      actor,
      outcome: 'success',
      objectType: 'payment_milestone',
      objectId: locked.id,
      workOrderId: target.workOrderId,
      fromStatus: rule.from,
      toStatus: rule.to,
    };
    await this.#events.publish(tx, journal, request);
  }
}

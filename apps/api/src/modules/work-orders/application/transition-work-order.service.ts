/**
 * The status command of a work order (EVM-030 AC1–AC5, AC7; SR-API-05, SR-API-06, SR-API-07, SR-AUTHZ-04, SR-AUTHZ-05, SR-AUTHZ-10,
 * SR-SESS-08, SR-LOG-02, SR-LOG-03, SR-DATA-01). The guard has decided before this runs: a signed-in Administrator or Editor on the
 * web channel with a valid CSRF token — Read-only gets 403 and an anonymous caller 401 without reaching the body.
 *
 * ONE transaction, and every decision in it is taken on the order LOCKED with `SELECT … FOR UPDATE` (the read policy is in that query),
 * never on an earlier read (TOCTOU, ASVS V2.3.3). No effect — the update, the effects of the participants, the audit record, the
 * idempotency record — happens before every check has passed; an error anywhere rolls the whole command back. The order:
 *   1. the order is locked: missing or soft deleted is `404 not_found`, the same for every role (it comes before the body, so a
 *      caller learns nothing from a malformed request about an order that is not theirs);
 *   2. `If-Match` (`428` / `400`) and the body (the schema of the contract, strict: a field of the server is `read_only_field`);
 *   3. the idempotency port (when there is a key): a repeat of the same key, order and body returns the stored result BEFORE the
 *      version is compared — a retry whose `If-Match` is already stale is not a conflict, it is the same command. The key is bound to
 *      the ORDER (the scope holds its id): the same key and body on another order is `422 idempotency_mismatch`, not a replay;
 *   4. the row of the table of transitions for (the status NOW, `to`): none is `409 invalid_state_transition` — unless the version
 *      is stale, which is `412` (the client has to read the order again, and of two identical commands that race, the loser is told so);
 *   5. the role (`403 forbidden`) and then, for a restoration, the step-up (`403 step_up_required`; one implementation of freshness,
 *      the clock of the application). This is the object policy of the use case — it depends on the status the order is in, which
 *      the guard cannot know. The order is the guard's: a role that may not use the row never learns the row is protected;
 *   6. the version (`412 version_conflict`);
 *   7. the fields the row decides (the reason, the day of completion; `400`, a pointer and a code, never a value);
 *   8. the conditions of the participants (`422 transition_condition_not_met`, `/to` and a code);
 *   9. the update, the effects of the participants, the event for the audit trail (a cancellation or a restoration), the idempotency record.
 * The reason is free text that may name a person: it goes into the column of the order and nowhere else — not into a log, an event, an
 * answer, an error or the idempotency record (only the hash of the body).
 */
import { zTransitionWorkOrderPath, zTransitionWorkOrderRequest, zTransitionWorkOrderHeaders, zWorkOrderDetails } from '@evia/contracts/zod';
import type { WorkOrderDetails } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { parseIfMatch } from '../../../platform/http/if-match.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, readOnlyKeys, strictObjects } from '../../../platform/http/validation.ts';
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';
import { IDEMPOTENCY, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { stepUpFresh } from '../../identity/index.ts';
import { businessDate } from '../domain/business-date.ts';
import { normalizeTransitionFields, type TransitionBody } from '../domain/transition-input.ts';
import { applyTransition, findTransition, mayUse, type TransitionState } from '../domain/work-order-transitions.ts';
import type { WorkOrderEvent } from '../events.ts';
import { workOrderTables } from '../infrastructure/tables.ts';
import { lockWorkOrderForTransition, updateWorkOrderStatus, type LockedWorkOrderRow } from '../infrastructure/work-order-store.ts';
import { WorkOrderTransitionRegistry, type TransitionContext } from '../transition-participant.ts';
import { ReadWorkOrderService } from './read-work-order.service.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the order (see {@link transitionScope}). */
export const TRANSITION_WORK_ORDER_SCOPE = 'POST /api/v1/work-orders/{workOrderId}/transitions';

/**
 * What an idempotency key is bound to besides the user: the method, the route and THE ORDER. The body of a transition says nothing
 * of the order (`{"to":"accepted"}` is the same for every order), so a scope of the route alone would let the key of one order
 * replay "done" for another one that was never changed (ASVS V2.3.1, CWE-841).
 */
export const transitionScope = (workOrderId: string): string => TRANSITION_WORK_ORDER_SCOPE.replace('{workOrderId}', workOrderId);

const pathSchema = strictObjects(zTransitionWorkOrderPath);
const transitionBody = strictObjects(zTransitionWorkOrderRequest);
/** The fields of the server that a command names in vain: the keys of the order that the command lacks (derived from the contract). */
const SERVER_FIELDS = readOnlyKeys(zWorkOrderDetails, zTransitionWorkOrderRequest);
const idempotencyKeySchema = zTransitionWorkOrderHeaders.shape['Idempotency-Key'];

export interface TransitionedWorkOrder {
  readonly workOrder: WorkOrderDetails;
  /** True when the answer repeats an earlier command (same key, order and body): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

@Injectable()
export class TransitionWorkOrderService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;
  readonly #participants: WorkOrderTransitionRegistry;
  readonly #reads: ReadWorkOrderService;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(WorkOrderTransitionRegistry) participants: WorkOrderTransitionRegistry,
    @Inject(ReadWorkOrderService) reads: ReadWorkOrderService,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
    this.#participants = participants;
    this.#reads = reads;
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
  ): Promise<TransitionedWorkOrder> {
    const { workOrderId } = parseInput(pathSchema, rawParams) as { workOrderId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const request = { ...context, sessionId: principal.sessionId };

    return this.#db.transaction().execute(async (tx) => {
      const locked = await lockWorkOrderForTransition(workOrderTables(tx), principal, workOrderId);
      if (locked === undefined) throw new ProblemException('not_found');
      const expectedVersion = parseIfMatch(rawIfMatch);
      const body = parseInput(transitionBody, rawBody, SERVER_FIELDS) as TransitionBody;

      const perform = async () => {
        await this.#perform(tx, principal, locked, expectedVersion, body, request);
        return { value: undefined, result: { status: 200, code: 'transitioned', resourceId: workOrderId } };
      };
      if (key === undefined) {
        await perform();
        return { workOrder: await this.#reads.detailsOf(tx, principal, workOrderId), replayed: false };
      }
      const outcome = await this.#idempotency.run(
        tx,
        { userId: principal.userId, deviceId: null, key, scope: transitionScope(workOrderId), bodyHash: requestHash(body) },
        perform,
      );
      return { workOrder: await this.#reads.detailsOf(tx, principal, workOrderId), replayed: outcome.replayed };
    });
  }

  /** Steps 4–9 of the order described above, on the locked row. */
  async #perform(
    tx: Kysely<Database>,
    principal: Principal,
    locked: LockedWorkOrderRow,
    expectedVersion: number,
    body: TransitionBody,
    request: EventContext,
  ): Promise<void> {
    const now = this.#clock.now();
    const state: TransitionState = {
      status: locked.status,
      resumeStatus: locked.resume_status,
      closedAt: locked.closed_at,
      completedOn: locked.completed_on,
    };
    const stale = locked.version !== expectedVersion;

    const transition = findTransition(state, body.to);
    if (transition === undefined) throw new ProblemException(stale ? 'version_conflict' : 'invalid_state_transition');
    if (!mayUse(transition, principal.role)) throw new ProblemException('forbidden');
    if (transition.rule.stepUp && !stepUpFresh(principal.passkeyAuthenticatedAt, now)) throw new ProblemException('step_up_required');
    if (stale) throw new ProblemException('version_conflict');

    const fields = normalizeTransitionFields(body, transition, businessDate(now));
    if (!fields.ok) throw new ProblemException('validation_failed', { errors: fields.errors });

    const participantContext: TransitionContext = { workOrderId: locked.id, from: state.status, to: transition.to, principal, now };
    const unmet = await this.#participants.unmetConditions(tx, participantContext);
    if (unmet.length > 0) {
      throw new ProblemException('transition_condition_not_met', { errors: unmet.map((code) => ({ pointer: '/to', code })) });
    }

    const next = applyTransition(state, transition, fields.fields, now);
    const version = await updateWorkOrderStatus(
      workOrderTables(tx),
      locked.id,
      expectedVersion,
      {
        status: next.state.status,
        resumeStatus: next.state.resumeStatus,
        statusReason: next.statusReason,
        closedAt: next.state.closedAt,
        completedOn: next.state.completedOn,
      },
      principal.userId,
      now,
    );
    if (version === undefined) throw new ProblemException('internal_error');
    await this.#participants.applyAll(tx, participantContext);

    if (transition.rule.audit !== undefined) {
      const event: WorkOrderEvent = {
        type: transition.rule.audit,
        actor: { type: 'user', userId: principal.userId },
        outcome: 'success',
        objectType: 'work_order',
        objectId: locked.id,
      };
      await this.#events.publish(tx, event, request);
    }
  }
}

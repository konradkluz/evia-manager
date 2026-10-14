/**
 * The change of a milestone without a change of its status — "Zmień kwotę" of a `planned` milestone (EVM-053 AC3), "Popraw dane
 * faktury…" of an `invoiced` one and "Popraw datę wpłaty…" of a `paid` one (EVM-054 AC4; decisions Q3a, Q3b, Q3d, Q3e; SR-API-05,
 * SR-API-06, SR-API-07, SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05, SR-AUTHZ-10, SR-INPUT-01, SR-INPUT-02, SR-LOG-03, ASVS V2.3.3, CWE-639,
 * CWE-915). The guard has decided before this runs: a signed-in Administrator or Editor on the web channel with a valid CSRF token —
 * Read-only gets 403 and an anonymous caller 401 without reaching the headers or the body.
 *
 * Order (api-guidelines.md → payments; the review of the architect for EVM-054): the path and the `Idempotency-Key` (`400`) BEFORE
 * the database is asked. Then ONE transaction, and every decision in it is taken on rows LOCKED until it ends — the order first, then
 * the milestone (the one order of locks of the module), never on an earlier read:
 *   1. the ORDER is locked through the facade of `work-orders` (`FOR NO KEY UPDATE`, the read policy in that query): missing or soft
 *      deleted is `404 not_found`, the same for every role;
 *   2. the MILESTONE is locked with `id AND work_order_id AND deleted_at IS NULL` in ONE condition: a milestone of another order, one
 *      that does not exist and one of a deleted order are the same `404 not_found`. Both come before `If-Match` and the body;
 *   3. `If-Match` (`428` / `400`) and the body against the schema of the contract (strict: a field of the server — `status`, `name`,
 *      `version`, `allowedTransitions` … — is `read_only_field`, a stranger `unknown_field`; an empty body, an invoice number that is
 *      not plain text, a day outside 2000–2100 — `400`): pointers and codes, never values;
 *   4. the idempotency port (when there is a key): a repeat of the same key, milestone and body returns the stored result BEFORE the
 *      checks below. The key is bound to the ORDER and the MILESTONE: the same key and body elsewhere is `422 idempotency_mismatch`;
 *   5. a closed order (settled or cancelled, PO-8) is `409 work_order_closed`;
 *   6. an amount of an `invoiced` or `paid` milestone is a correction of the Administrator with a step-up (EVM-057 AC3, AC5, AC6; P2;
 *      SR-AUTHZ-10, SR-SESS-08): every other role is `403 forbidden`, the Administrator without an authentication with a passkey in the
 *      last 15 minutes `403 step_up_required` (the role first; `stepUpFresh` of `identity` with the injected clock); an amount of a
 *      `cancelled` milestone is `403 forbidden` for every caller — also together with other fields, and before the 409 below. A `403`
 *      rolls back and leaves no idempotency record, so a retry with the same key after the step-up performs the correction;
 *   7. a field that does not belong to the status (the invoice only in `invoiced`, the day of the payment only in `paid`) is
 *      `409 invalid_state_transition` (Q3d);
 *   8. the version (`412 version_conflict`, no current value in the answer);
 *   9. the rules on the merged state (`400`): the due date not before the day of the invoice (`before_invoiced_on`), the day of a
 *      payment not after today in `Europe/Warsaw` (`in_future`);
 *  10. a change without effect (every value equal to the stored one): `200` with the milestone as it is, no new version and no event;
 *      otherwise the update (`version + 1`) through the one point of write — no row there after a successful lock is a defect
 *      (`500`), never a silent `200` — the event for the audit trail (`payment_milestone.amount_changed` with the amount before and
 *      after — `payment_milestone.amount_corrected` for an invoiced or paid milestone — and, when other fields changed too,
 *      `payment_milestone.details_changed` without any value: a patch of both leaves both events), the idempotency record (a hash of
 *      the body only).
 * An error rolls everything back. A repeat returns the milestone as it is NOW.
 */
import {
  zPaymentMilestone,
  zPaymentMilestonePatch,
  zUpdatePaymentMilestoneHeaders,
  zUpdatePaymentMilestonePath,
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
import { stepUpFresh } from '../../identity/index.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import {
  changedDetails,
  mergedIssues,
  normalizeDetailsPatch,
  statusDecision,
  type DetailsPatch,
  type DetailsPatchInput,
} from '../domain/milestone-details.ts';
import { correctionAccess } from '../domain/milestone-transitions.ts';
import type { PaymentMilestoneEvent } from '../events.ts';
import { lockMilestone, type MilestoneRow } from '../infrastructure/milestone-reader.ts';
import { updateMilestone } from '../infrastructure/milestone-store.ts';
import { paymentTables } from '../infrastructure/tables.ts';
import { currentMilestone, HIDDEN_MILESTONE_COLUMNS } from './milestone-answer.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the milestone (see {@link updateMilestoneScope}). */
export const UPDATE_MILESTONE_SCOPE = 'PATCH /api/v1/work-orders/{workOrderId}/payment-milestones/{milestoneId}';

/**
 * What an idempotency key is bound to besides the user: the method, the route, THE ORDER and THE MILESTONE. A patch such as
 * `{"amount":{…}}` says nothing of the milestone, so a scope of the route alone would let the key of one milestone "replay" the change
 * for another one that was never changed (ASVS V2.3.1, SR-API-05, CWE-639, CWE-841).
 */
export const updateMilestoneScope = (workOrderId: string, milestoneId: string): string =>
  UPDATE_MILESTONE_SCOPE.replace('{workOrderId}', workOrderId).replace('{milestoneId}', milestoneId);

const pathSchema = strictObjects(zUpdatePaymentMilestonePath);
const patchBody = strictObjects(zPaymentMilestonePatch);
const idempotencyKeySchema = zUpdatePaymentMilestoneHeaders.shape['Idempotency-Key'];
/** The fields of the server that a patch names in vain: the keys of the milestone the patch lacks and the columns no answer carries. */
const SERVER_FIELDS: ReadonlySet<string> = new Set([
  ...readOnlyKeys(zPaymentMilestone, zPaymentMilestonePatch),
  ...HIDDEN_MILESTONE_COLUMNS,
]);

export interface UpdatedMilestone {
  readonly milestone: PaymentMilestone;
  /** True when the answer repeats an earlier change (same key, milestone and body): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

@Injectable()
export class UpdateMilestoneService {
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
  async update(
    principal: Principal,
    rawParams: unknown,
    rawIfMatch: string | undefined,
    rawBody: unknown,
    rawKey: string | undefined,
    context: EventContext,
  ): Promise<UpdatedMilestone> {
    const { workOrderId, milestoneId } = parseInput(pathSchema, rawParams) as { workOrderId: string; milestoneId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.lockVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');
      const locked = await lockMilestone(paymentTables(tx), order.id, milestoneId);
      if (locked === undefined) throw new ProblemException('not_found');
      const expectedVersion = parseIfMatch(rawIfMatch);
      const input = parseInput(patchBody, rawBody, SERVER_FIELDS) as DetailsPatchInput;
      const normalized = normalizeDetailsPatch(input);
      if (!normalized.ok) throw new ProblemException('validation_failed', { errors: normalized.errors });

      const perform = async () => {
        if (order.closed) throw new ProblemException('work_order_closed');
        await this.#change(tx, principal, { workOrderId: order.id, locked }, expectedVersion, normalized.patch, request);
        return { value: undefined, result: { status: 200, code: 'updated', resourceId: milestoneId } };
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
                  scope: updateMilestoneScope(order.id, milestoneId),
                  bodyHash: requestHash(input),
                },
                perform,
              )
            ).replayed;
      return { milestone: await currentMilestone(tx, this.#clock, principal, order, milestoneId), replayed };
    });
  }

  /** Steps 6–10 of the order described above, on the locked rows. */
  async #change(
    tx: Kysely<Database>,
    principal: Principal,
    target: { readonly workOrderId: string; readonly locked: MilestoneRow },
    expectedVersion: number,
    patch: DetailsPatch,
    request: EventContext,
  ): Promise<void> {
    const { locked } = target;
    const now = this.#clock.now();
    const correction = correctionAccess(principal.role, stepUpFresh(principal.passkeyAuthenticatedAt, now));
    const decision = statusDecision(locked.status, patch, correction);
    if (decision !== 'ok') throw new ProblemException(decision);
    if (locked.version !== expectedVersion) throw new ProblemException('version_conflict');
    const issues = mergedIssues(locked, patch, businessDate(now));
    if (issues.length > 0) throw new ProblemException('validation_failed', { errors: issues });
    const change = changedDetails(locked, patch);
    if (Object.keys(change).length === 0) return;

    const version = await updateMilestone(
      paymentTables(tx),
      { workOrderId: target.workOrderId, milestoneId: locked.id, expectedVersion, status: locked.status },
      change,
      principal.userId,
      now,
    );
    if (version === undefined) throw new ProblemException('internal_error');
    const base = {
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      objectType: 'payment_milestone',
      objectId: locked.id,
      workOrderId: target.workOrderId,
      fromCode: null,
      toCode: null,
    } as const;
    const { amountMinor, ...otherFields } = change;
    // One patch may change the amount AND other fields (a correction of an invoiced or paid milestone): both leave a trace (T7, SR-LOG-03).
    if (amountMinor !== undefined) {
      const type = locked.status === 'planned' ? 'payment_milestone.amount_changed' : 'payment_milestone.amount_corrected';
      const amountEvent: PaymentMilestoneEvent = { ...base, type, amountBeforeMinor: locked.amountMinor, amountAfterMinor: amountMinor };
      await this.#events.publish(tx, amountEvent, request);
    }
    if (Object.keys(otherFields).length > 0) {
      const detailsEvent: PaymentMilestoneEvent = {
        ...base,
        type: 'payment_milestone.details_changed',
        amountBeforeMinor: null,
        amountAfterMinor: null,
      };
      await this.#events.publish(tx, detailsEvent, request);
    }
  }
}

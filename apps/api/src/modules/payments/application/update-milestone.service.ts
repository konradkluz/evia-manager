/**
 * "Zmień kwotę" — the new amount of a `planned` milestone (EVM-053 AC3, AC5, AC6, AC7; SR-API-05, SR-API-06, SR-API-07, SR-AUTHZ-02,
 * SR-AUTHZ-04, SR-AUTHZ-05, SR-AUTHZ-10, SR-INPUT-01, SR-LOG-03, ASVS V2.3.3, CWE-639, CWE-915). The guard has decided before this
 * runs: a signed-in Administrator or Editor on the web channel with a valid CSRF token — Read-only gets 403 and an anonymous caller 401
 * without reaching the headers or the body.
 *
 * Order: the path and the `Idempotency-Key` (`400`) BEFORE the database is asked. Then ONE transaction, and every decision in it is
 * taken on rows LOCKED until it ends — the order first, then the milestone (the one order of locks of the module), never on an earlier read:
 *   1. the ORDER is locked through the facade of `work-orders` (`FOR NO KEY UPDATE`, the read policy in that query): missing or soft
 *      deleted is `404 not_found`, the same for every role;
 *   2. the MILESTONE is locked with `id AND work_order_id AND deleted_at IS NULL` in ONE condition: a milestone of another order, one
 *      that does not exist and one of a deleted order are the same `404 not_found`. Both come before `If-Match` and the body;
 *   3. `If-Match` (`428` / `400`) and the body against the schema of the contract (strict: any field of the milestone but `amount` —
 *      `status`, `name`, `sharePercent`, `version` … — is `read_only_field`, a stranger `unknown_field`; a fraction of a grosz, zero, a
 *      negative amount or another currency is `400`): pointers and codes, never values;
 *   4. the idempotency port (when there is a key): a repeat of the same key, milestone and body returns the stored result BEFORE the
 *      checks below. The key is bound to the ORDER and the MILESTONE: the same key and body elsewhere is `422 idempotency_mismatch`;
 *   5. a closed order (settled or cancelled, PO-8) is `409 work_order_closed`;
 *   6. the version (`412 version_conflict`, no current value in the answer): a client with stale data reads the milestone again and
 *      learns its true status — only on the current version does
 *   7. a status other than `planned` give `403 forbidden` (the amount of an invoiced or paid milestone is a correction of the
 *      Administrator with a step-up, EVM-057 — SR-AUTHZ-10);
 *   8. the amount equal to the current one is a change without effect (api-guidelines.md): `200` with the milestone as it is, no
 *      new version and no event; otherwise the update (`version + 1`) through the one point of write, the event
 *      `payment_milestone.amount_changed` for the audit trail (the actor, the milestone, the amount before and after — never the
 *      name), the idempotency record. An error rolls everything back.
 * A repeat returns the milestone as it is NOW.
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
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { mayChangeAmount } from '../domain/milestone-rules.ts';
import type { Money } from '../domain/money.ts';
import type { PaymentMilestoneEvent } from '../events.ts';
import { findMilestone, lockMilestone, type MilestoneRow } from '../infrastructure/milestone-reader.ts';
import { updateMilestoneAmount } from '../infrastructure/milestone-store.ts';
import { paymentTables } from '../infrastructure/tables.ts';
import { toPaymentMilestone } from './milestone-representation.ts';

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
/** The fields of the server that a patch names in vain: the keys of the milestone the patch lacks (`id` and `name` included) and the columns no answer carries. */
const SERVER_FIELDS: ReadonlySet<string> = new Set([
  ...readOnlyKeys(zPaymentMilestone, zPaymentMilestonePatch),
  'workOrderId',
  'sourceTemplateId',
  'currency',
  'amountMinor',
  'notes',
  'createdAt',
  'createdBy',
  'updatedAt',
  'updatedBy',
  'deletedAt',
  'deletedBy',
]);

interface PatchInput {
  readonly amount: Money;
}

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
      const tables = paymentTables(tx);
      const locked = await lockMilestone(tables, order.id, milestoneId);
      if (locked === undefined) throw new ProblemException('not_found');
      const expectedVersion = parseIfMatch(rawIfMatch);
      const body = parseInput(patchBody, rawBody, SERVER_FIELDS) as PatchInput;

      const perform = async () => {
        if (order.closed) throw new ProblemException('work_order_closed');
        await this.#change(tx, principal, { workOrderId: order.id, locked }, expectedVersion, body.amount, request);
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
                  bodyHash: requestHash(body),
                },
                perform,
              )
            ).replayed;
      const row = await findMilestone(tables, order.id, milestoneId);
      if (row === undefined) throw new ProblemException('not_found');
      return { milestone: toPaymentMilestone(row, businessDate(this.#clock.now())), replayed };
    });
  }

  /** Steps 6–8 of the order described above, on the locked rows; the same amount again is a change without effect (no version, no event). */
  async #change(
    tx: Kysely<Database>,
    principal: Principal,
    target: { readonly workOrderId: string; readonly locked: MilestoneRow },
    expectedVersion: number,
    amount: Money,
    request: EventContext,
  ): Promise<void> {
    const { locked } = target;
    if (locked.version !== expectedVersion) throw new ProblemException('version_conflict');
    if (!mayChangeAmount(locked.status)) throw new ProblemException('forbidden');
    if (locked.amountMinor === amount.amountMinor) return;

    const version = await updateMilestoneAmount(
      paymentTables(tx),
      { workOrderId: target.workOrderId, milestoneId: locked.id, expectedVersion },
      amount.amountMinor,
      principal.userId,
      this.#clock.now(),
    );
    if (version === undefined) throw new ProblemException('internal_error');
    const event: PaymentMilestoneEvent = {
      type: 'payment_milestone.amount_changed',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      objectType: 'payment_milestone',
      objectId: locked.id,
      workOrderId: target.workOrderId,
      amountBeforeMinor: locked.amountMinor,
      amountAfterMinor: amount.amountMinor,
    };
    await this.#events.publish(tx, event, request);
  }
}

/**
 * "Dodaj transzę" — a milestone added by hand at the end of the list (EVM-053 AC4, AC5, AC6, AC7; SR-API-05, SR-API-06, SR-AUTHZ-02,
 * SR-AUTHZ-04, SR-AUTHZ-05, SR-INPUT-01, SR-INPUT-05, SR-LOG-03, ASVS V2.3.1, V2.3.3, CWE-639, CWE-915). The guard has decided before
 * this runs: a signed-in Administrator or Editor on the web channel with a valid CSRF token — Read-only gets 403 and an anonymous
 * caller 401 without reaching the headers, the body or the table of idempotency records.
 *
 * ONE transaction on the order LOCKED with `SELECT … FOR NO KEY UPDATE` through the facade of `work-orders` (the read policy is in
 * that query) — the same lock the status command of the order takes, so an addition and a settlement are serialised (AC6). The order:
 *   1. the path (`400`);
 *   2. the order is locked: missing or soft deleted is `404 not_found`, the same for every role, BEFORE the headers and the body;
 *   3. the `Idempotency-Key` (required, UUIDv7) and the body against the strict schema of the contract (a field of the server —
 *      `status`, `sharePercent`, `code`, `position`, `version` … — is `read_only_field`, a stranger `unknown_field`) and the rules of
 *      the name (NFC, trimmed, 1–120 code points, no control character): `400`, pointers and codes, never values;
 *   4. the idempotency port: a repeat of the same key, order and body returns the stored result BEFORE the checks below. The key is
 *      bound to the ORDER: the same key and body on another order is `422 idempotency_mismatch`;
 *   5. a closed order (settled or cancelled, PO-8) is `409 work_order_closed`;
 *   6. the limit: 20 live milestones, the cancelled ones included (`422 limit_exceeded`, a pointer and a code);
 *   7. the INSERT at the end (`max(position) + 1`, read under the lock; an existing `id` — also of a milestone of ANOTHER order — is
 *      `409 id_conflict`, nothing is overwritten), the event `payment_milestone.created` for the audit trail (the actor, the milestone,
 *      the amount when one is given — never the name), the idempotency record. An error anywhere rolls the whole command back.
 * The answer is the milestone as it is NOW, read with the order of the URL in the condition.
 */
import {
  zCreatePaymentMilestoneHeaders,
  zCreatePaymentMilestonePath,
  zPaymentMilestone,
  zPaymentMilestoneCreate,
} from '@evia/contracts/zod';
import type { PaymentMilestone } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { businessDate } from '../../../platform/clock/business-date.ts';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, readOnlyKeys, strictObjects } from '../../../platform/http/validation.ts';
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';
import { IDEMPOTENCY, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory, type WorkOrderRef } from '../../work-orders/index.ts';
import { MAX_MILESTONES_PER_ORDER, normalizeMilestoneName } from '../domain/milestone-rules.ts';
import type { Money } from '../domain/money.ts';
import type { PaymentMilestoneEvent } from '../events.ts';
import { findMilestone, milestoneSlots } from '../infrastructure/milestone-reader.ts';
import { insertMilestone } from '../infrastructure/milestone-store.ts';
import { paymentTables } from '../infrastructure/tables.ts';
import { toPaymentMilestone } from './milestone-representation.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the order (see {@link createMilestoneScope}). */
export const CREATE_MILESTONE_SCOPE = 'POST /api/v1/work-orders/{workOrderId}/payment-milestones';

/**
 * What an idempotency key is bound to besides the user: the method, the route and THE ORDER. The body of an addition says nothing of
 * the order, so a scope of the route alone would let the key and the body of one order replay the result of ANOTHER order (ASVS
 * V2.3.1, SR-API-05, AB-09, CWE-639, CWE-841).
 */
export const createMilestoneScope = (workOrderId: string): string => CREATE_MILESTONE_SCOPE.replace('{workOrderId}', workOrderId);

const pathSchema = strictObjects(zCreatePaymentMilestonePath);
/**
 * The name is measured by the rules of the domain (`milestone-rules.ts`) in code points AFTER normalisation, so the schema here only
 * bounds the string: `maxLength` of the contract counts UTF-16 units and would refuse a short name of astral characters.
 */
const createBody = strictObjects(zPaymentMilestoneCreate.extend({ name: z.string().max(1000) }));
const idempotencyKeySchema = zCreatePaymentMilestoneHeaders.shape['Idempotency-Key'];
/** The fields of the server that a request names in vain: the keys of the milestone the request lacks, and the columns no answer carries. */
const SERVER_FIELDS: ReadonlySet<string> = new Set([
  ...readOnlyKeys(zPaymentMilestone, zPaymentMilestoneCreate),
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

interface CreateInput {
  readonly id: string;
  readonly name: string;
  readonly amount?: Money | undefined;
}

export interface CreatedMilestone {
  readonly workOrderId: string;
  readonly milestone: PaymentMilestone;
  /** True when the answer repeats an earlier addition (same key, order and body): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

@Injectable()
export class CreateMilestoneService {
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
   * @param rawKey the `Idempotency-Key` header as received (`undefined` when absent)
   */
  async create(
    principal: Principal,
    rawParams: unknown,
    rawBody: unknown,
    rawKey: string | undefined,
    context: EventContext,
  ): Promise<CreatedMilestone> {
    const { workOrderId } = parseInput(pathSchema, rawParams) as { workOrderId: string };
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.lockVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');
      const key = keyOf(rawKey);
      const input = parseCreateInput(rawBody);

      const perform = async () => {
        await this.#add(tx, principal, order, input, request);
        return { value: undefined, result: { status: 201, code: 'created', resourceId: input.id } };
      };
      const { replayed } = await this.#idempotency.run(
        tx,
        { userId: principal.userId, deviceId: null, key, scope: createMilestoneScope(order.id), bodyHash: requestHash(input) },
        perform,
      );
      // read again with the order of the URL in the condition — a repeat never names a milestone of another order
      const row = await findMilestone(paymentTables(tx), order.id, input.id);
      if (row === undefined) throw new ProblemException('not_found');
      return {
        workOrderId: order.id,
        milestone: toPaymentMilestone(row, businessDate(this.#clock.now()), { role: principal.role, orderClosed: order.closed }),
        replayed,
      };
    });
  }

  /** Steps 5–7 of the order described above, in the transaction of the command. */
  async #add(tx: Kysely<Database>, principal: Principal, order: WorkOrderRef, input: CreateInput, request: EventContext): Promise<void> {
    if (order.closed) throw new ProblemException('work_order_closed');
    const tables = paymentTables(tx);
    const slots = await milestoneSlots(tables, order.id);
    if (slots.count >= MAX_MILESTONES_PER_ORDER) {
      throw new ProblemException('limit_exceeded', { errors: [{ pointer: '', code: 'too_many_payment_milestones' }] });
    }
    const amountMinor = input.amount?.amountMinor ?? null;
    const inserted = await insertMilestone(
      tables,
      { id: input.id, workOrderId: order.id, name: input.name, position: slots.lastPosition + 1, amountMinor },
      principal.userId,
      this.#clock.now(),
    );
    if (inserted === undefined) throw new ProblemException('id_conflict');
    const event: PaymentMilestoneEvent = {
      type: 'payment_milestone.created',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      objectType: 'payment_milestone',
      objectId: input.id,
      workOrderId: order.id,
      amountBeforeMinor: null,
      amountAfterMinor: amountMinor,
      fromCode: null,
      toCode: null,
    };
    await this.#events.publish(tx, event, request);
  }
}

/** @throws ProblemException `validation_failed` — the header is required and is a UUIDv7 (`/headers/Idempotency-Key`) */
function keyOf(rawKey: string | undefined): string {
  const pointer = '/headers/Idempotency-Key';
  if (rawKey === undefined) throw new ProblemException('validation_failed', { errors: [{ pointer, code: 'required' }] });
  const parsed = idempotencyKeySchema.safeParse(rawKey);
  if (!parsed.success) throw new ProblemException('validation_failed', { errors: [{ pointer, code: 'invalid_format' }] });
  return parsed.data;
}

/** The body against the schema of the contract, then the rules of the name (the normalised name is what is stored and hashed). */
function parseCreateInput(rawBody: unknown): CreateInput {
  const body = parseInput(createBody, rawBody, SERVER_FIELDS) as CreateInput;
  const name = normalizeMilestoneName(body.name);
  if (!name.ok) throw new ProblemException('validation_failed', { errors: [{ pointer: '/name', code: name.code }] });
  return { id: body.id, name: name.value, ...(body.amount === undefined ? {} : { amount: body.amount }) };
}

/**
 * THE ONE POINT OF WRITE of the payment milestones (EVM-053; P4, ADR-0017): every `INSERT` and `UPDATE` of `payments.payment_milestones`
 * — the copy of the plan at the creation of an order, the milestone added by hand, the new amount, the effect of the cancellation of
 * an order — is a function of this file and of no other (a review checks it with a search). EVM-056 hooks the events of the read model
 * here. Every value reaches the database as a bound parameter; the anchor `work_order_id` is in the condition of every update
 * (SR-AUTHZ-02, CWE-639). The amount is a `bigint`: what the driver returns as text becomes a number through
 * {@link amountFromDatabase} only.
 */
import type { PlannedMilestone } from '../domain/composition-plan.ts';
import { CURRENCY } from '../domain/money.ts';
import type { PaymentsDb } from './tables.ts';

/** A `bigint` of the driver (text) as a number of grosze — a value that is not a safe integer is an error, never a rounded number. */
export function amountFromDatabase(value: string | number | null): number | null {
  if (value === null) return null;
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new RangeError('an amount of the database is not a safe integer');
  return amount;
}

/** The milestones copied from the plan of the template into a new order (at least one: the caller has nothing to do for an empty plan). */
export async function insertPlannedMilestones(
  db: PaymentsDb,
  workOrderId: string,
  milestones: readonly PlannedMilestone[],
  actorUserId: string,
  now: Date,
): Promise<void> {
  await db
    .insertInto('payments.payment_milestones')
    .values(
      milestones.map((milestone) => ({
        work_order_id: workOrderId,
        code: milestone.code,
        name: milestone.name,
        position: milestone.position,
        share_percent: milestone.sharePercent,
        payment_term_days: milestone.paymentTermDays,
        amount_minor: null,
        currency: null,
        source_template_id: milestone.sourceTemplateId,
        created_at: now,
        created_by: actorUserId,
        updated_at: now,
        updated_by: actorUserId,
        deleted_at: null,
        deleted_by: null,
      })),
    )
    .execute();
}

export interface NewMilestone {
  readonly id: string;
  readonly workOrderId: string;
  readonly name: string;
  readonly position: number;
  readonly amountMinor: number | null;
}

/**
 * A milestone added by hand (EVM-053 AC4): `INSERT` only — an `id` that exists (a milestone of ANOTHER order or a deleted one included)
 * inserts nothing and the answer is `undefined` (the caller answers `409 id_conflict`; nothing is compared, nothing is overwritten).
 */
export async function insertMilestone(
  db: PaymentsDb,
  milestone: NewMilestone,
  actorUserId: string,
  now: Date,
): Promise<string | undefined> {
  const row = await db
    .insertInto('payments.payment_milestones')
    .values({
      id: milestone.id,
      work_order_id: milestone.workOrderId,
      code: null,
      name: milestone.name,
      position: milestone.position,
      share_percent: null,
      payment_term_days: null,
      amount_minor: milestone.amountMinor,
      currency: milestone.amountMinor === null ? null : CURRENCY,
      source_template_id: null,
      created_at: now,
      created_by: actorUserId,
      updated_at: now,
      updated_by: actorUserId,
      deleted_at: null,
      deleted_by: null,
    })
    .onConflict((conflict) => conflict.column('id').doNothing())
    .returning('id')
    .executeTakeFirst();
  return row?.id;
}

/**
 * The new amount of a milestone of THIS order at the version the caller holds the lock of (`version + 1`). The status is in the
 * condition as well: a row that is not `planned` any more is not changed (the caller decided on the locked row; this is the last line).
 * @returns the new version, or `undefined` when no row matched
 */
export async function updateMilestoneAmount(
  db: PaymentsDb,
  target: { readonly workOrderId: string; readonly milestoneId: string; readonly expectedVersion: number },
  amountMinor: number,
  actorUserId: string,
  now: Date,
): Promise<number | undefined> {
  const row = await db
    .updateTable('payments.payment_milestones')
    .set((eb) => ({
      amount_minor: amountMinor,
      currency: CURRENCY,
      version: eb('version', '+', 1),
      updated_at: now,
      updated_by: actorUserId,
    }))
    .where('id', '=', target.milestoneId)
    .where('work_order_id', '=', target.workOrderId)
    .where('version', '=', target.expectedVersion)
    .where('status', '=', 'planned')
    .where('deleted_at', 'is', null)
    .returning('version')
    .executeTakeFirst();
  return row?.version;
}

export interface CancelledMilestone {
  readonly id: string;
  readonly amountMinor: number | null;
}

/**
 * The effect of the cancellation of an order (EVM-053 AC6; domain-model.md → "Zlecenie"): every live `planned` milestone of THIS order
 * becomes `cancelled` (`version + 1`, the actor of the command). The caller holds the lock of the order, so the rows are locked after it
 * (order → milestone, as every path of the module — no deadlock). The answer names the milestones and their amounts for the audit trail.
 */
export async function cancelPlannedMilestones(
  db: PaymentsDb,
  workOrderId: string,
  actorUserId: string,
  now: Date,
): Promise<CancelledMilestone[]> {
  const rows = await db
    .updateTable('payments.payment_milestones')
    .set((eb) => ({ status: 'cancelled', version: eb('version', '+', 1), updated_at: now, updated_by: actorUserId }))
    .where('work_order_id', '=', workOrderId)
    .where('status', '=', 'planned')
    .where('deleted_at', 'is', null)
    .returning(['id', 'position', 'amount_minor'])
    .execute();
  return rows.sort((a, b) => a.position - b.position).map((row) => ({ id: row.id, amountMinor: amountFromDatabase(row.amount_minor) }));
}

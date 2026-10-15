/**
 * THE ONE POINT OF WRITE of the payment milestones (EVM-053; P4, ADR-0017): every `INSERT` and `UPDATE` of `payments.payment_milestones`
 * — the copy of the plan at the creation of an order, the milestone added by hand, the change of the amount, of the invoice and of
 * the payment, the move of a transition (EVM-054), the effect of the cancellation of an order, a correction, the soft delete and the
 * renumbering after it (EVM-057) — is a function of this file and of no
 * other (a review checks it with a search). EVM-056 hooks the events of the read model
 * here. Every value reaches the database as a bound parameter; the anchor `work_order_id` is in the condition of every update
 * (SR-AUTHZ-02, CWE-639). The amount is a `bigint`: what the driver returns as text becomes a number through
 * {@link amountFromDatabase} only.
 */
import type { PlannedMilestone } from '../domain/composition-plan.ts';
import { CURRENCY, type PaymentMilestoneStatus } from '../domain/money.ts';
import type { PaymentMilestonesTable, PaymentsDb } from './tables.ts';
import type { Updateable } from 'kysely';

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

/** The milestone a write is for: THIS order, the version and the status the caller decided on (under the lock). */
export interface MilestoneWriteTarget {
  readonly workOrderId: string;
  readonly milestoneId: string;
  readonly expectedVersion: number;
  readonly status: PaymentMilestoneStatus;
}

/** The changes of a PATCH (EVM-053 AC3, EVM-054 AC4): only the columns named; the amount with its currency. */
export interface MilestoneDetailsChange {
  readonly amountMinor?: number;
  readonly invoiceNumber?: string;
  readonly invoicedOn?: string;
  readonly dueDate?: string;
  readonly paidOn?: string;
}

/**
 * The columns of a move (EVM-054 AC1–AC3) and of a correction (EVM-057): the status and what the move writes; absent (`undefined`)
 * keeps the column, `null` clears it (a correction clears the invoice, the day of a payment or the reason).
 */
export interface MilestoneMoveChange {
  readonly status: PaymentMilestoneStatus;
  readonly amountMinor?: number;
  readonly invoiceNumber?: string | null;
  readonly invoicedOn?: string | null;
  readonly dueDate?: string | null;
  readonly paidOn?: string | null;
  readonly statusReason?: string | null;
}

const columnsOf = (change: MilestoneMoveChange | MilestoneDetailsChange): Updateable<PaymentMilestonesTable> => ({
  ...('status' in change ? { status: change.status } : {}),
  ...(change.amountMinor === undefined ? {} : { amount_minor: change.amountMinor, currency: CURRENCY }),
  ...(change.invoiceNumber === undefined ? {} : { invoice_number: change.invoiceNumber }),
  ...(change.invoicedOn === undefined ? {} : { invoiced_on: change.invoicedOn }),
  ...(change.dueDate === undefined ? {} : { due_date: change.dueDate }),
  ...(change.paidOn === undefined ? {} : { paid_on: change.paidOn }),
  ...('statusReason' in change && change.statusReason !== undefined ? { status_reason: change.statusReason } : {}),
});

/**
 * A change of a milestone of THIS order at the version and in the status the caller holds the lock of (`version + 1`) — the change of
 * the amount, of the invoice and of the payment (a PATCH) and the move of a transition alike. The condition is `id AND work_order_id
 * AND version AND status AND deleted_at IS NULL`: a row that changed meanwhile is not written (the caller decided on the locked row;
 * this is the last line, and the caller treats no row as a defect, never as a success).
 * @returns the new version, or `undefined` when no row matched
 */
export async function updateMilestone(
  db: PaymentsDb,
  target: MilestoneWriteTarget,
  change: MilestoneMoveChange | MilestoneDetailsChange,
  actorUserId: string,
  now: Date,
): Promise<number | undefined> {
  const row = await db
    .updateTable('payments.payment_milestones')
    .set((eb) => ({ ...columnsOf(change), version: eb('version', '+', 1), updated_at: now, updated_by: actorUserId }))
    .where('id', '=', target.milestoneId)
    .where('work_order_id', '=', target.workOrderId)
    .where('version', '=', target.expectedVersion)
    .where('status', '=', target.status)
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

/**
 * The soft delete of a milestone of THIS order at the version the caller holds the lock of (EVM-057 AC4): `deleted_at`, `deleted_by`,
 * `version + 1`. The condition is `id AND work_order_id AND version AND deleted_at IS NULL` — the last line under the decision of the
 * caller, who treats no row as a defect.
 * @returns the new version, or `undefined` when no row matched
 */
export async function softDeleteMilestone(
  db: PaymentsDb,
  target: Omit<MilestoneWriteTarget, 'status'>,
  actorUserId: string,
  now: Date,
): Promise<number | undefined> {
  const row = await db
    .updateTable('payments.payment_milestones')
    .set((eb) => ({ deleted_at: now, deleted_by: actorUserId, version: eb('version', '+', 1), updated_at: now, updated_by: actorUserId }))
    .where('id', '=', target.milestoneId)
    .where('work_order_id', '=', target.workOrderId)
    .where('version', '=', target.expectedVersion)
    .where('deleted_at', 'is', null)
    .returning('version')
    .executeTakeFirst();
  return row?.version;
}

/**
 * Numbers the LIVE milestones of THIS order 1…n again after a deletion (EVM-057; the pattern of `renumberScopeItems`), so the next
 * "Dodaj transzę" (`position` = the largest + 1) stays within the CHECK 1…20. The unique index on the position is partial and not
 * deferrable, so the milestones are moved one by one in ascending order — each into the place the previous one left, never onto a
 * taken one (one `UPDATE position - 1` would collide). The version is NOT raised: the position is a place in the list, not the
 * content of the milestone, and a stale tag of a neighbour would be a false `412`. The caller holds the lock of the order.
 */
export async function compactPositions(db: PaymentsDb, workOrderId: string): Promise<void> {
  const rows = await db
    .selectFrom('payments.payment_milestones')
    .select(['id', 'position'])
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', 'is', null)
    .orderBy('position')
    .execute();
  for (const [index, row] of rows.entries()) {
    if (row.position === index + 1) continue;
    await db
      .updateTable('payments.payment_milestones')
      .set({ position: index + 1 })
      .where('id', '=', row.id)
      .where('work_order_id', '=', workOrderId)
      .execute();
  }
}

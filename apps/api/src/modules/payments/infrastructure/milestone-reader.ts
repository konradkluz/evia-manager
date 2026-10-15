/**
 * Reads of the payment milestones (EVM-053). Every query names its columns (no `select *`: a column outside the contract — the notes,
 * the authors, the source — cannot leak into an answer, SR-DATA-03) and has the anchor `work_order_id` in its condition: a milestone is
 * never found by its own identifier alone (SR-AUTHZ-02, CWE-639). The order itself is resolved before, through the facade of
 * `work-orders` and its read policy. The amount comes back through `amountFromDatabase` (a safe integer, never a float).
 */
import { sql } from 'kysely';
import { MAX_MILESTONES_PER_ORDER, SETTLED_STATUSES } from '../domain/milestone-rules.ts';
import type { PaymentMilestoneStatus } from '../domain/money.ts';
import { amountFromDatabase } from './milestone-store.ts';
import type { PaymentsDb } from './tables.ts';

export interface MilestoneRow {
  readonly id: string;
  readonly code: string | null;
  readonly name: string;
  readonly position: number;
  readonly sharePercent: number | null;
  readonly paymentTermDays: number | null;
  readonly amountMinor: number | null;
  readonly status: PaymentMilestoneStatus;
  readonly invoiceNumber: string | null;
  /** `YYYY-MM-DD` */
  readonly invoicedOn: string | null;
  /** `YYYY-MM-DD` */
  readonly dueDate: string | null;
  /** `YYYY-MM-DD` */
  readonly paidOn: string | null;
  readonly version: number;
}

const columns = [
  'id',
  'code',
  'name',
  'position',
  'share_percent',
  'payment_term_days',
  'amount_minor',
  'status',
  'invoice_number',
  sql<string | null>`to_char(invoiced_on, 'YYYY-MM-DD')`.as('invoiced_on'),
  sql<string | null>`to_char(due_date, 'YYYY-MM-DD')`.as('due_date'),
  sql<string | null>`to_char(paid_on, 'YYYY-MM-DD')`.as('paid_on'),
  'version',
] as const;

interface RawRow {
  readonly id: string;
  readonly code: string | null;
  readonly name: string;
  readonly position: number;
  readonly share_percent: number | null;
  readonly payment_term_days: number | null;
  readonly amount_minor: string | null;
  readonly status: PaymentMilestoneStatus;
  readonly invoice_number: string | null;
  readonly invoiced_on: string | null;
  readonly due_date: string | null;
  readonly paid_on: string | null;
  readonly version: number;
}

const toRow = (row: RawRow): MilestoneRow => ({
  id: row.id,
  code: row.code,
  name: row.name,
  position: row.position,
  sharePercent: row.share_percent,
  paymentTermDays: row.payment_term_days,
  amountMinor: amountFromDatabase(row.amount_minor),
  status: row.status,
  invoiceNumber: row.invoice_number,
  invoicedOn: row.invoiced_on,
  dueDate: row.due_date,
  paidOn: row.paid_on,
  version: row.version,
});

/** The live milestones of THIS order in the order of `position` — ONE query, bounded by the limit of milestones (AC2). */
export async function listMilestones(db: PaymentsDb, workOrderId: string): Promise<MilestoneRow[]> {
  const rows = await db
    .selectFrom('payments.payment_milestones')
    .select(columns)
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', 'is', null)
    .orderBy('position')
    .limit(MAX_MILESTONES_PER_ORDER)
    .execute();
  return rows.map(toRow);
}

/**
 * The milestone of THIS order, LOCKED until the transaction ends (`SELECT … FOR UPDATE`): `id AND work_order_id AND deleted_at IS NULL`
 * in ONE condition — a milestone of another order, a deleted one and one that does not exist are the same `undefined` (AC7, IDOR).
 * The caller holds the lock of the order already (order → milestone, the one order of locks of the module).
 */
export async function lockMilestone(db: PaymentsDb, workOrderId: string, milestoneId: string): Promise<MilestoneRow | undefined> {
  const row = await db
    .selectFrom('payments.payment_milestones')
    .select(columns)
    .where('id', '=', milestoneId)
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', 'is', null)
    .forUpdate()
    .executeTakeFirst();
  return row === undefined ? undefined : toRow(row);
}

/** The milestone of THIS order as it is NOW (the answer of a change and of a repeat), or `undefined`. */
export async function findMilestone(db: PaymentsDb, workOrderId: string, milestoneId: string): Promise<MilestoneRow | undefined> {
  const row = await db
    .selectFrom('payments.payment_milestones')
    .select(columns)
    .where('id', '=', milestoneId)
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  return row === undefined ? undefined : toRow(row);
}

/** How many live milestones the order has (the cancelled ones included) and the last position — read under the lock of the order. */
export async function milestoneSlots(
  db: PaymentsDb,
  workOrderId: string,
): Promise<{ readonly count: number; readonly lastPosition: number }> {
  const row = await db
    .selectFrom('payments.payment_milestones')
    .select((eb) => [eb.fn.countAll<string>().as('count'), sql<number | null>`max(position)`.as('last')])
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', 'is', null)
    .executeTakeFirstOrThrow();
  return { count: Number(row.count), lastPosition: row.last ?? 0 };
}

/** Whether a live milestone of the order still waits for money (neither `paid` nor `cancelled`) — the condition of a settlement. */
export async function hasUnsettledMilestone(db: PaymentsDb, workOrderId: string): Promise<boolean> {
  const row = await db
    .selectFrom('payments.payment_milestones')
    .select('id')
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', 'is', null)
    .where('status', 'not in', SETTLED_STATUSES)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

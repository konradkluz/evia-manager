/**
 * Synthetic payment milestones written straight into the database (EVM-053) — a TEST helper: it lives outside `src`, so it is not in
 * the production image and no route reaches it; it refuses to run when `NODE_ENV=production` (SR-INFRA-08). Everything is synthetic.
 * The tests of the totals, of the block of a change of the amount, of the conditions of a transition and of the corrections (EVM-054)
 * write the statuses `invoiced` and `paid` here with the data the CHECKs of 0028 ask for (invoice, day, due date, day of payment).
 */
import type { Kysely } from 'kysely';
import type { PaymentMilestoneStatus } from '../../src/modules/payments/domain/money.ts';
import { paymentTables } from '../../src/modules/payments/infrastructure/tables.ts';
import type { Database } from '../../src/platform/database/database.ts';
import { assertSyntheticDataAllowed } from './work-order-fixtures.ts';

export interface MilestoneSpec {
  readonly name?: string;
  readonly status?: PaymentMilestoneStatus;
  readonly amountMinor?: number | null;
  /** `YYYY-MM-DD` */
  readonly dueDate?: string;
  readonly invoiceNumber?: string;
  readonly paymentTermDays?: number | null;
  readonly deletedAt?: Date;
}

const AT = new Date('2026-10-13T08:00:00.000Z');

/** Inserts milestones of an order at positions 1, 2, 3 … (after `startAt`); returns the identifiers in the order given. */
export async function insertMilestones(
  db: Kysely<Database>,
  workOrderId: string,
  specs: readonly MilestoneSpec[],
  startAt = 0,
): Promise<string[]> {
  assertSyntheticDataAllowed();
  const ids: string[] = [];
  for (const [index, spec] of specs.entries()) {
    const status = spec.status ?? 'planned';
    const amountMinor =
      spec.amountMinor === undefined ? (status === 'planned' || status === 'cancelled' ? null : 100_000) : spec.amountMinor;
    const row = await paymentTables(db)
      .insertInto('payments.payment_milestones')
      .values({
        work_order_id: workOrderId,
        code: null,
        name: spec.name ?? `Transza ${startAt + index + 1}`,
        position: startAt + index + 1,
        share_percent: null,
        payment_term_days: spec.paymentTermDays ?? null,
        amount_minor: amountMinor,
        currency: amountMinor === null ? null : 'PLN',
        status,
        invoice_number: spec.invoiceNumber ?? (status === 'invoiced' || status === 'paid' ? `FV/${startAt + index + 1}/2026` : null),
        invoiced_on: status === 'invoiced' || status === 'paid' ? '2026-10-01' : null,
        due_date: spec.dueDate ?? (status === 'invoiced' || status === 'paid' ? '2026-10-08' : null),
        paid_on: status === 'paid' ? '2026-10-05' : null,
        source_template_id: null,
        created_at: AT,
        created_by: null,
        updated_at: AT,
        updated_by: null,
        deleted_at: spec.deletedAt ?? null,
        deleted_by: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    ids.push(row.id);
  }
  return ids;
}

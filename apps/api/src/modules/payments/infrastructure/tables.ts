/**
 * Kysely types of the table the `payments` module owns (EVM-053). `platform` does not know module tables: the module narrows a handle
 * with `db.$extendTables<PaymentTables>()`. The application role has SELECT, INSERT and UPDATE (no DELETE: soft delete only). The
 * amount is a `bigint`: the driver returns it as TEXT (there is no global parser of `int8`), so every read goes through
 * `amountFromDatabase` (`milestone-store.ts`) — a number, checked to be a safe integer, never a float. Dates (`date`) are read
 * through `to_char` (the driver would turn a `date` into a local midnight).
 */
import type { ColumnType, Generated, Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { PaymentMilestoneStatus } from '../domain/money.ts';

export interface PaymentMilestonesTable {
  id: Generated<string>;
  /** The anchor (D10): every read and write of a milestone has it in its condition. */
  work_order_id: string;
  code: string | null;
  name: string;
  position: number;
  share_percent: number | null;
  payment_term_days: number | null;
  amount_minor: ColumnType<string | null, number | null, number | null>;
  currency: 'PLN' | null;
  status: Generated<PaymentMilestoneStatus>;
  invoice_number: Generated<string | null>;
  invoiced_on: Generated<string | null>;
  due_date: Generated<string | null>;
  paid_on: Generated<string | null>;
  source_template_id: string | null;
  created_at: Date;
  created_by: string | null;
  updated_at: Date;
  updated_by: string | null;
  version: Generated<number>;
  deleted_at: Date | null;
  deleted_by: string | null;
}

export type PaymentTables = { 'payments.payment_milestones': PaymentMilestonesTable };

export type PaymentsDb = Kysely<PaymentTables>;

export const paymentTables = (db: Kysely<Database>): PaymentsDb => db.$extendTables<PaymentTables>();

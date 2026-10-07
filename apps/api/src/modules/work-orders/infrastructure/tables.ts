/**
 * Kysely types of the tables the `work-orders` module owns (EVM-017). `platform` does not know module tables: the module
 * narrows a handle with `db.$extendTables<WorkOrderTables>()`. The application role has SELECT, INSERT and UPDATE (no DELETE:
 * soft delete only). Times are written by the application with millisecond precision (no `now()` defaults) — the cursor of
 * the list carries a time as ISO 8601 with milliseconds, so a finer value in the column would break the keyset comparison.
 */
import type { Generated, Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { WorkOrderStatus } from '../domain/work-order-list-query.ts';

export interface WorkOrdersTable {
  id: Generated<string>;
  number: string;
  title: string;
  status: WorkOrderStatus;
  created_at: Date;
  created_by: string | null;
  updated_at: Date;
  updated_by: string | null;
  version: Generated<number>;
  deleted_at: Date | null;
  deleted_by: string | null;
}

export interface WorkOrderAssignmentsTable {
  id: Generated<string>;
  work_order_id: string;
  user_id: string;
  role: 'coordinator' | 'technician';
  created_at: Date;
  created_by: string | null;
  updated_at: Date;
  updated_by: string | null;
  version: Generated<number>;
  deleted_at: Date | null;
  deleted_by: string | null;
}

export type WorkOrderTables = {
  'work_orders.work_orders': WorkOrdersTable;
  'work_orders.work_order_assignments': WorkOrderAssignmentsTable;
};

export type WorkOrdersDb = Kysely<WorkOrderTables>;

export const workOrderTables = (db: Kysely<Database>): WorkOrdersDb => db.$extendTables<WorkOrderTables>();

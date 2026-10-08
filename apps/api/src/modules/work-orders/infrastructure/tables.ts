/**
 * Kysely types of the tables the `work-orders` module owns (EVM-017, EVM-022). `platform` does not know module tables: the module
 * narrows a handle with `db.$extendTables<WorkOrderTables>()`. The application role has SELECT, INSERT and UPDATE (no DELETE:
 * soft delete only). Times are written by the application with millisecond precision (no `now()` defaults) — the cursor of
 * the list carries a time as ISO 8601 with milliseconds, so a finer value in the column would break the keyset comparison.
 */
import type { ColumnType, Generated, Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { WorkOrderStatus } from '../domain/work-order-list-query.ts';

export interface WorkOrdersTable {
  id: Generated<string>;
  number: string;
  title: string;
  status: WorkOrderStatus;
  customer_id: Generated<string | null>;
  site_id: Generated<string | null>;
  source_template_id: Generated<string | null>;
  /** `date`: written as `YYYY-MM-DD` and read through `to_char` (the driver would turn a `date` into a local midnight). */
  planned_date: Generated<string | null>;
  description: Generated<string | null>;
  /** The active status to return to after a hold; set on a hold or a cancellation from an active status (EVM-030). */
  resume_status: Generated<WorkOrderStatus | null>;
  /** Free text — may name a person: never audited, logged or returned (EVM-030; the journal of the order is EVM-038). */
  status_reason: Generated<string | null>;
  status_changed_at: Generated<Date | null>;
  closed_at: Generated<Date | null>;
  /** `date`: written as `YYYY-MM-DD` and read through `to_char`, like `planned_date`. */
  completed_on: Generated<string | null>;
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

export interface ScopeItemsTable {
  id: Generated<string>;
  work_order_id: string;
  source_catalog_item_id: string | null;
  position: number;
  code: string;
  name: string;
  parameter_set_code: string | null;
  parameters: ColumnType<Record<string, string | number | boolean>, string, string>;
  quantity: number;
  created_at: Date;
  created_by: string | null;
  updated_at: Date;
  updated_by: string | null;
  version: Generated<number>;
  deleted_at: Date | null;
  deleted_by: string | null;
}

export interface NumberCountersTable {
  year: number;
  last_value: number;
}

export type WorkOrderTables = {
  'work_orders.work_orders': WorkOrdersTable;
  'work_orders.work_order_assignments': WorkOrderAssignmentsTable;
  'work_orders.scope_items': ScopeItemsTable;
  'work_orders.number_counters': NumberCountersTable;
};

export type WorkOrdersDb = Kysely<WorkOrderTables>;

export const workOrderTables = (db: Kysely<Database>): WorkOrdersDb => db.$extendTables<WorkOrderTables>();

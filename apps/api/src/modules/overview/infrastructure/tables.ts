/**
 * Kysely types of the tables the `overview` module owns (EVM-034; ADR-0017): the read model of the list of work orders. The list of
 * columns is CLOSED (W1) — keys, codes, dates and counters; no title, name, amount or free text; of payments only counters and a date (EVM-056).
 * Dates (`date`) are read as `YYYY-MM-DD` through `to_char` and written as such (the driver would turn a `date` into a local midnight).
 * `platform` does not know module tables: the module narrows a handle with `db.$extendTables<OverviewTables>()`.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';

export interface WorkOrderSummariesTable {
  work_order_id: string;
  number: string;
  status: string;
  created_at: Date;
  /** The authorisation column (W2). */
  deleted_at: Date | null;
  coordinator_user_id: string | null;
  customer_id: string | null;
  site_id: string | null;
  site_type: string | null;
  source_template_id: string | null;
  waiting_count: number;
  /** Written as `YYYY-MM-DD`, read through `to_char`. */
  longest_waiting_since: string | null;
  longest_waiting_on: 'customer' | 'party' | null;
  longest_waiting_party_id: string | null;
  /** Written as `YYYY-MM-DD`, read through `to_char`. */
  next_due_date: string | null;
  /** The signals of payments (EVM-056): counters and a date, never an amount (W1). */
  invoiced_count: number;
  paid_count: number;
  /** Written as `YYYY-MM-DD`, read through `to_char`. */
  earliest_invoiced_due_date: string | null;
  recomputed_at: Date;
}

export interface WorkOrderWaitsTable {
  stage_id: string;
  work_order_id: string;
  waiting_on: 'customer' | 'party';
  party_id: string | null;
  party_kind: string | null;
  /** Written as `YYYY-MM-DD`, read through `to_char`. */
  waiting_since: string;
}

export type OverviewTables = {
  'overview.work_order_summaries': WorkOrderSummariesTable;
  'overview.work_order_waits': WorkOrderWaitsTable;
};

export type OverviewDb = Kysely<OverviewTables>;

export const overviewTables = (db: Kysely<Database>): OverviewDb => db.$extendTables<OverviewTables>();

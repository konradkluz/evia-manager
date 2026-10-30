/**
 * Kysely type of the table the `audit` module owns. The application role has INSERT and SELECT on it and nothing else
 * (0003), so the module has no way to change or delete an event — and no function that tries to.
 */
import type { ColumnType, Generated, Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';

export interface AuditEventsTable {
  id: Generated<string>;
  occurred_at: Date;
  actor_type: 'user' | 'system' | 'anonymous';
  actor_user_id: string | null;
  session_id: string | null;
  /** `cidr`: the driver returns text such as `192.0.2.0/24` or `2001:db8:abcd::/48`. */
  ip_prefix: ColumnType<string | null, string | null, never>;
  origin: 'web' | 'cli';
  action: string;
  outcome: 'success' | 'denied' | 'failed';
  reason_code: string | null;
  object_type: string;
  object_id: string | null;
  trace_id: string;
  /** `bigint` (EVM-053, the exception for payments): written as a number, returned by the driver as TEXT — read through `amountOf`. */
  amount_before_minor: ColumnType<string | null, number | null, never>;
  amount_after_minor: ColumnType<string | null, number | null, never>;
  currency: 'PLN' | null;
  /** The codes of the status before and after (EVM-054; 0029): both or neither. */
  from_code: string | null;
  to_code: string | null;
  /** The counts of the entities by type of a full download of a phone (EVM-096; 0053): all three or none. */
  work_order_count: number | null;
  customer_count: number | null;
  site_count: number | null;
  /** The number of entities of a served snapshot of one order (EVM-097; 0054): null for every other event. */
  entity_count: number | null;
}

export type AuditTables = { 'audit.events': AuditEventsTable };

export type AuditDb = Kysely<AuditTables>;

export const auditTables = (db: Kysely<Database>): AuditDb => db.$extendTables<AuditTables>();

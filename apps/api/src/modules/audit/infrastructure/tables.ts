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
}

export type AuditTables = { 'audit.events': AuditEventsTable };

export type AuditDb = Kysely<AuditTables>;

export const auditTables = (db: Kysely<Database>): AuditDb => db.$extendTables<AuditTables>();
